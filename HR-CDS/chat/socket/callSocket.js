const User = require("../../../models/User");
const {sendPushToUsers} = require("../../utils/firebasePushService");
const callHistory = require("../utils/callHistory");
const { isUserOnline } = require("../../socket/presence");
const callStore = require("./callStore");

const ringTimers = new Map();
const socketDisconnectTimers = new Map();
const CALL_RING_TIMEOUT_MS = 45 * 1000;
const CALL_DISCONNECT_GRACE_MS = 15 * 1000;

const clearLocalRingTimer = (callId) => {
    const key = String(callId);
    const timer = ringTimers.get(key);
    if (timer) {
        clearTimeout(timer);
        ringTimers.delete(key);
    }
};

const getPublicUser = (user) => {
    if (!user) return null;
    const rawId = user._id || user.id;
    const name = user.name || user.fullName ||
        (user.firstName ? `${user.firstName} ${user.lastName || ''}`.trim() : "") ||
        user.email || "User";
    const avatar = user.avatar || user.profileImage || user.image || "";
    return {
        _id: rawId?.toString(),
        id: rawId?.toString(),
        name,
        email: user.email,
        avatar,
        profileImage: avatar,
    };
};

const normalizeCallerUser = (socket, data = {}) => {
    const socketUser = getPublicUser(socket.user) || {};
    const clientUser = data.callerUser && typeof data.callerUser === "object"
        ? getPublicUser(data.callerUser) || {}
        : {};

    const finalId = socket.userId || clientUser._id || clientUser.id || "";
    const finalName = (clientUser.name && clientUser.name !== "User")
        ? clientUser.name
        : (socketUser.name && socketUser.name !== "User" ? socketUser.name : (clientUser.name || socketUser.name || "User"));
    const finalAvatar = clientUser.avatar || clientUser.profileImage || socketUser.avatar || socketUser.profileImage || "";

    return {
        ...socketUser,
        ...clientUser,
        _id: finalId,
        id: finalId,
        name: finalName,
        avatar: finalAvatar,
        profileImage: finalAvatar,
    };
};

const emitToUser = (io, userId, eventName, payload) => {
    if (!userId) return;
    io.to(`user:${userId}`).emit(eventName, payload);
};

const emitToParticipant = (io, room, userId, event, payload) => {
    if (!userId) return;
    const p = room?.participants?.[userId];
    if (p?.socketId) {
        io.to(p.socketId).emit(event, payload); // works across servers with the adapter
    } else {
        io.to(`user:${userId}`).emit(event, payload); // before accept / old clients
    }
};

const getUserId = (value) => {
    if (!value) return "";
    if (typeof value !== "object") return value.toString();

    const rawId = value._id || value.id || value.userId || value.user?._id || value.user?.id;
    if (!rawId) return "";

    return typeof rawId === "object" ? getUserId(rawId) : rawId.toString();
};

// A signed-in device can be woken by push even when it has no live socket.
const isUserAvailableForCall = async (_io, userId, companyId) => {
    if (!getUserId(userId) || !companyId) return false;
    try {
        return Boolean(await User.findOne({
            _id: getUserId(userId), company: companyId, isActive: {$ne: false},
        }).select("_id").lean());
    } catch (_) { return false; }
};

const incomingPayload = (room, userId) => ({
    callId: room.callId,
    conversationId: room.conversationId,
    fromUserId: room.hostUserId,
    fromUser: room.participants?.[room.hostUserId]?.user,
    participantIds: Object.keys(room.participants || {}),
    title: room.title,
    isGroupCall: room.isGroupCall,
    callType: room.callType,
    expiresAt: room.participants?.[userId]?.expiresAt || room.expiresAt,
});

const clearCallPush = (userIds, callId) => {
    if (!userIds || !userIds.length) return;
    sendPushToUsers({userIds, data: {type: "call:cancelled", callId}}).catch(() => {});
};

const getParticipantIds = (data = {}) => {
    const ids = Array.isArray(data.participantIds) ? data.participantIds : [data.toUserId];
    return [...new Set(ids.map(getUserId).filter(Boolean))];
};

const emitCallUnavailable = (socket, payload = {}, reason = "User is not available for call") => {
    socket.emit("call:unavailable", {
        callId: payload.callId,
        toUserId: payload.toUserId,
        reason,
    });
};

const emitToJoinedParticipants = (io, room, eventName, payload, exceptUserId) => {
    if (!room || !room.participants) return;
    Object.entries(room.participants).forEach(([userId, participant]) => {
        if (userId === exceptUserId || participant.status !== "joined") return;
        emitToParticipant(io, room, userId, eventName, payload);
    });
};

const emitToCallParticipants = (io, room, eventName, payload, exceptUserId) => {
    if (!room || !room.participants) return;
    if (["call:ended", "call:missed"].includes(eventName)) {
        clearCallPush(Object.keys(room.participants).filter(id => id !== exceptUserId), room.callId);
    }
    Object.entries(room.participants).forEach(([userId, participant]) => {
        if (userId === exceptUserId || !["joined", "invited"].includes(participant.status)) return;
        emitToParticipant(io, room, userId, eventName, payload);
    });
};

const closeCallRoom = async (callId) => {
    const room = await callStore.get(callId);
    if (!room) return;
    clearLocalRingTimer(callId);
    if (!room.finishedAt) {
        room.finishedAt = Date.now();
        callHistory.recordCallFinished(room);
    }
    await callStore.remove(callId);
};

const maybeCloseRoom = async (callId) => {
    const room = await callStore.get(callId);
    if (!room) return;

    const hasActiveParticipant = Object.values(room.participants || {}).some(
        participant => participant.status === "joined" || participant.status === "invited"
    );

    if (!hasActiveParticipant) {
        await closeCallRoom(callId);
    }
};

const callSocket = (io, socket) => {
    const reconnectTimer = socketDisconnectTimers.get(socket.id);
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        socketDisconnectTimers.delete(socket.id);
    }

    socket.on("call:check-availability", async (data = {}, callback) => {
        const participantIds = getParticipantIds(data).filter(userId => userId !== socket.userId);
        const availabilityChecks = await Promise.all(
            participantIds.map(async id => ({
                id,
                available: await isUserAvailableForCall(io, id, socket.companyId),
            }))
        );
        const availableIds = availabilityChecks.filter(item => item.available).map(item => item.id);
        const unavailableIds = participantIds.filter(id => !availableIds.includes(id));
        const available = availableIds.length > 0;

        if (typeof callback === "function") {
            callback({
                success: available,
                available,
                availableIds,
                unavailableIds,
                reason: available ? "" : "Call recipient is unavailable",
            });
        }
    });

    socket.on("call:invite", async (data = {}) => {
        const participantIds = getParticipantIds(data).filter(userId => userId !== socket.userId);
        const callType = data.callType === "video" ? "video" : "audio";

        if (participantIds.length === 0) {
            emitCallUnavailable(socket, data, "Invalid call receiver");
            return;
        }

        const availabilityChecks = await Promise.all(
            participantIds.map(async id => ({
                id,
                available: await isUserAvailableForCall(io, id, socket.companyId),
            }))
        );
        const targetParticipantIds = availabilityChecks.filter(item => item.available).map(item => item.id);

        if (targetParticipantIds.length === 0) {
            emitCallUnavailable(socket, data, "Call recipient is unavailable");
            return;
        }

        const callId = data.callId?.toString();
        if (!callId) {
            emitCallUnavailable(socket, data, "Invalid or duplicate call");
            return;
        }

        await callStore.withCallLock(callId, async () => {
            const existingRoom = await callStore.get(callId);
            if (existingRoom) {
                emitCallUnavailable(socket, data, "Invalid or duplicate call");
                return;
            }

            const callerUser = normalizeCallerUser(socket, data);
            const isGroupCall = Boolean(data.isGroupCall || participantIds.length > 1);
            const callTitle = isGroupCall
                ? (data.groupTitle || data.title || "Channel call")
                : (callerUser.name || "User");

            const room = {
                callId,
                callType,
                companyId: socket.companyId,
                conversationId: data.conversationId,
                startedAt: Date.now(),
                answeredAt: null,
                expiresAt: Date.now() + CALL_RING_TIMEOUT_MS,
                hostUserId: socket.userId,
                title: callTitle,
                isGroupCall,
                participants: {},
            };

            // Host gets their current socketId
            room.participants[socket.userId] = {
                status: "joined",
                user: callerUser,
                socketId: socket.id,
            };

            // Invited participants have socketId = null until they accept
            targetParticipantIds.forEach(userId => {
                room.participants[userId] = {
                    status: "invited",
                    expiresAt: room.expiresAt,
                    user: null,
                    socketId: null,
                };
            });

            await callStore.save(room);
            callHistory.recordCallStarted(room);

            // Ring timeout stored in server local ringTimers
            const ringTimer = setTimeout(async () => {
                ringTimers.delete(callId);
                const latestRoom = await callStore.get(callId);
                if (!latestRoom) return;
                const hasAcceptedParticipant = Object.entries(latestRoom.participants || {})
                    .some(([userId, participant]) => userId !== latestRoom.hostUserId && participant.status === "joined");
                if (hasAcceptedParticipant) return;

                emitToCallParticipants(io, latestRoom, "call:missed", {
                    callId,
                    fromUserId: latestRoom.hostUserId,
                    reason: "No answer",
                });
                await closeCallRoom(callId);
            }, CALL_RING_TIMEOUT_MS);
            ringTimers.set(callId, ringTimer);

            // Every device of the invited user gets call:incoming
            targetParticipantIds.forEach(userId => {
                io.to(`user:${userId}`).emit("call:incoming", {
                    callId,
                    fromUserId: socket.userId,
                    fromUser: callerUser,
                    callerUser,
                    participantIds: [socket.userId, ...targetParticipantIds],
                    title: callTitle,
                    isGroupCall,
                    callType,
                    conversationId: room.conversationId,
                    expiresAt: room.expiresAt,
                });
            });

            // Trigger push notifications to wake devices if in background/locked
            try {
                sendPushToUsers({
                    userIds: targetParticipantIds,
                    title: `Incoming ${callType === "video" ? "Video" : "Voice"} Call`,
                    body: `${callerUser.name || "A team member"} is calling you...`,
                    data: {
                        type: "call:incoming",
                        callId,
                        callType,
                        fromUserId: socket.userId,
                        title: callTitle,
                        fromUser: callerUser,
                        conversationId: data.conversationId,
                        participantIds: [socket.userId, ...targetParticipantIds],
                        isGroupCall,
                        expiresAt: room.expiresAt,
                    },
                }).catch(() => {});
            } catch (_) {}

            socket.emit("call:ringing", {
                callId,
                toUserIds: targetParticipantIds,
                unavailableIds: participantIds.filter(userId => !targetParticipantIds.includes(userId)),
                callType,
            });
        });
    });

    // Restore an invitation after the notification wakes a cold-started app.
    socket.on("call:sync-incoming", async (data = {}, callback) => {
        if (typeof callback !== "function") return;
        const allRooms = await callStore.listAll();
        const room = data.callId
            ? await callStore.get(data.callId)
            : allRooms.find(item => item.participants?.[socket.userId]?.status === "invited");
        const participant = room?.participants?.[socket.userId];
        callback(room && participant?.status === "invited" && (participant.expiresAt || room.expiresAt) > Date.now()
            ? {success: true, call: incomingPayload(room, socket.userId)}
            : {success: false, reason: "Call is no longer ringing"});
    });

    socket.on("call:accept", async (data = {}) => {
        const callId = data.callId?.toString();
        if (!callId) {
            emitCallUnavailable(socket, data, "Call is no longer active");
            return;
        }

        await callStore.withCallLock(callId, async () => {
            const room = await callStore.get(callId);
            const me = room?.participants?.[socket.userId];
            if (!room || me?.status !== "invited" || (me.expiresAt || room.expiresAt) <= Date.now()) {
                emitCallUnavailable(socket, data, "Call is no longer active");
                return;
            }

            // Atomic claim check: first device wins
            if (!(await callStore.claimAnswer(callId, socket.userId, socket.id))) {
                socket.emit("call:answered-elsewhere", { callId });
                return;
            }

            clearLocalRingTimer(callId);
            clearCallPush([socket.userId], callId);

            // Tell this user's other devices (socket.to excludes current socket; reaches across servers)
            socket.to(`user:${socket.userId}`).emit("call:answered-elsewhere", { callId });

            const participantUser = getPublicUser(socket.user);
            const existingJoinedParticipants = Object.entries(room.participants)
                .filter(([userId, participant]) => userId !== socket.userId && participant.status === "joined")
                .map(([userId, participant]) => ({
                    userId,
                    user: participant.user,
                }));

            room.participants[socket.userId] = {
                status: "joined",
                user: participantUser,
                socketId: socket.id,
            };

            if (!room.answeredAt) room.answeredAt = Date.now();
            await callStore.save(room);
            callHistory.recordCallAnswered(callId, socket.userId, new Date());

            // Only the answering socket gets call:joined
            io.to(socket.id).emit("call:joined", {
                callId,
                callType: room.callType,
                participants: existingJoinedParticipants,
                title: room.title,
                isGroupCall: Boolean(room.isGroupCall),
            });

            // Notify already-joined participants
            emitToJoinedParticipants(io, room, "call:participant-joined", {
                callId,
                fromUserId: socket.userId,
                fromUser: participantUser,
                callType: room.callType,
            }, socket.userId);
        });
    });

    socket.on("call:add-participants", async (data = {}) => {
        const callId = data.callId?.toString();
        if (!callId) return;

        await callStore.withCallLock(callId, async () => {
            const room = await callStore.get(callId);
            if (!room || !room.participants?.[socket.userId]) {
                emitCallUnavailable(socket, data, "Call is no longer active");
                return;
            }

            const requestedIds = getParticipantIds(data)
                .filter(userId => userId !== socket.userId && !room.participants[userId]);

            if (requestedIds.length === 0) {
                socket.emit("call:ringing", {
                    callId,
                    toUserIds: [],
                    unavailableIds: [],
                    callType: room.callType,
                });
                return;
            }

            const availabilityChecks = await Promise.all(
                requestedIds.map(async id => ({
                    id,
                    available: await isUserAvailableForCall(io, id, socket.companyId),
                }))
            );
            const targetParticipantIds = availabilityChecks.filter(item => item.available).map(item => item.id);
            const unavailableIds = requestedIds.filter(userId => !targetParticipantIds.includes(userId));

            if (targetParticipantIds.length === 0) {
                emitCallUnavailable(socket, data, "Selected call recipients are unavailable");
                return;
            }

            const inviterUser = normalizeCallerUser(socket, data);
            const joinedIds = Object.entries(room.participants)
                .filter(([, participant]) => participant.status === "joined")
                .map(([userId]) => userId);
            const callTitle = data.title || room.title || "Channel call";

            room.isGroupCall = true;
            room.title = callTitle;
            callHistory.recordParticipantsAdded(callId, targetParticipantIds);

            targetParticipantIds.forEach(userId => {
                room.participants[userId] = {
                    status: "invited",
                    expiresAt: Date.now() + CALL_RING_TIMEOUT_MS,
                    user: null,
                    socketId: null,
                };
            });

            await callStore.save(room);

            targetParticipantIds.forEach(userId => {
                io.to(`user:${userId}`).emit("call:incoming", {
                    callId,
                    fromUserId: socket.userId,
                    fromUser: inviterUser,
                    callerUser: inviterUser,
                    participantIds: [...joinedIds, ...targetParticipantIds],
                    title: callTitle,
                    isGroupCall: true,
                    callType: room.callType,
                    conversationId: room.conversationId,
                    expiresAt: Date.now() + CALL_RING_TIMEOUT_MS,
                });
            });

            try {
                sendPushToUsers({
                    userIds: targetParticipantIds,
                    title: `Incoming ${room.callType === "video" ? "Video" : "Voice"} Call`,
                    body: `${inviterUser.name || "A team member"} added you to a call...`,
                    data: {
                        type: "call:incoming",
                        callId,
                        callType: room.callType,
                        fromUserId: socket.userId,
                        title: callTitle,
                        fromUser: inviterUser,
                        conversationId: room.conversationId,
                        participantIds: [...joinedIds, ...targetParticipantIds],
                        isGroupCall: true,
                        expiresAt: Date.now() + CALL_RING_TIMEOUT_MS,
                    },
                }).catch(() => {});
            } catch (_) {}

            socket.emit("call:ringing", {
                callId,
                toUserIds: targetParticipantIds,
                unavailableIds,
                callType: room.callType,
            });
        });
    });

    socket.on("call:reject", async (data = {}) => {
        const callId = data.callId?.toString();
        if (!callId) return;

        await callStore.withCallLock(callId, async () => {
            const room = await callStore.get(callId);
            if (!room?.participants?.[socket.userId]) return;

            const myParticipant = room.participants[socket.userId];
            // If joined with another socket, ignore stale device rejection
            if (myParticipant.status === "joined" && myParticipant.socketId && myParticipant.socketId !== socket.id) {
                return;
            }

            clearCallPush([socket.userId], callId);

            // If declined while still invited, decline on user's other devices as well
            if (myParticipant.status === "invited") {
                socket.to(`user:${socket.userId}`).emit("call:rejected", {
                    callId,
                    fromUserId: socket.userId,
                });
            }

            room.participants[socket.userId] = {
                ...myParticipant,
                status: "rejected",
                user: getPublicUser(socket.user),
            };
            await callStore.save(room);

            emitToJoinedParticipants(io, room, "call:rejected", {
                callId,
                fromUserId: socket.userId,
            }, socket.userId);

            if (data.toUserId) {
                emitToParticipant(io, room, data.toUserId?.toString(), "call:rejected", {
                    callId,
                    fromUserId: socket.userId,
                });
            }

            await maybeCloseRoom(callId);
        });
    });

    socket.on("call:rebind", async (data = {}) => {
        const callId = data.callId?.toString();
        if (!callId) return;

        await callStore.withCallLock(callId, async () => {
            const room = await callStore.get(callId);
            const p = room?.participants?.[socket.userId];
            if (room && p?.status === "joined") {
                p.socketId = socket.id;
                await callStore.save(room);
            }
        });
    });

    socket.on("call:offer", async (data = {}) => {
        const room = await callStore.get(data.callId?.toString());
        emitToParticipant(io, room, data.toUserId?.toString(), "call:offer", {
            callId: data.callId,
            fromUserId: socket.userId,
            fromUser: getPublicUser(socket.user),
            offer: data.offer,
        });
    });

    socket.on("call:answer", async (data = {}) => {
        const room = await callStore.get(data.callId?.toString());
        emitToParticipant(io, room, data.toUserId?.toString(), "call:answer", {
            callId: data.callId,
            fromUserId: socket.userId,
            fromUser: getPublicUser(socket.user),
            answer: data.answer,
        });
    });

    socket.on("call:ice-candidate", async (data = {}) => {
        const room = await callStore.get(data.callId?.toString());
        emitToParticipant(io, room, data.toUserId?.toString(), "call:ice-candidate", {
            callId: data.callId,
            fromUserId: socket.userId,
            candidate: data.candidate,
        });
    });

    socket.on("call:end", async (data = {}) => {
        const callId = data.callId?.toString();
        if (!callId) return;

        await callStore.withCallLock(callId, async () => {
            const room = await callStore.get(callId);
            if (!room?.participants?.[socket.userId]) return;

            const myParticipant = room.participants[socket.userId];
            // If joined with another socket, ignore stale device end
            if (myParticipant.status === "joined" && myParticipant.socketId && myParticipant.socketId !== socket.id) {
                return;
            }

            clearCallPush([socket.userId], callId);
            room.participants[socket.userId] = {
                ...myParticipant,
                status: "ended",
                user: getPublicUser(socket.user),
            };
            await callStore.save(room);

            if (room.hostUserId === socket.userId) {
                emitToCallParticipants(io, room, "call:ended", {
                    callId,
                    fromUserId: socket.userId,
                }, socket.userId);
                await closeCallRoom(callId);
                return;
            }

            emitToJoinedParticipants(io, room, "call:ended", {
                callId,
                fromUserId: socket.userId,
            }, socket.userId);
            await maybeCloseRoom(callId);
        });
    });

    socket.on("disconnect", () => {
        if (!socket.userId) return;

        const timer = setTimeout(async () => {
            socketDisconnectTimers.delete(socket.id);
            const allRooms = await callStore.listAll();
            for (const room of allRooms) {
                const p = room.participants?.[socket.userId];
                if (p?.status === "joined" && p.socketId === socket.id) {
                    await callStore.withCallLock(room.callId, async () => {
                        const latestRoom = await callStore.get(room.callId);
                        const latestP = latestRoom?.participants?.[socket.userId];
                        if (latestP?.status === "joined" && latestP.socketId === socket.id) {
                            if (latestRoom.hostUserId === socket.userId) {
                                emitToCallParticipants(io, latestRoom, "call:ended", {
                                    callId: latestRoom.callId,
                                    fromUserId: socket.userId,
                                    reason: "Disconnected",
                                }, socket.userId);
                                await closeCallRoom(latestRoom.callId);
                            } else {
                                latestRoom.participants[socket.userId] = {
                                    ...latestP,
                                    status: "ended",
                                    user: getPublicUser(socket.user),
                                };
                                await callStore.save(latestRoom);
                                emitToJoinedParticipants(io, latestRoom, "call:ended", {
                                    callId: latestRoom.callId,
                                    fromUserId: socket.userId,
                                    status: "ended",
                                    reason: "Disconnected",
                                }, socket.userId);
                                await maybeCloseRoom(latestRoom.callId);
                            }
                        }
                    });
                }
            }
        }, CALL_DISCONNECT_GRACE_MS);

        socketDisconnectTimers.set(socket.id, timer);
    });
};

module.exports = callSocket;
