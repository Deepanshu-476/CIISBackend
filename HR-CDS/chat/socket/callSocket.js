const User = require("../../../models/User");

const {sendPushToUsers} = require("../../utils/firebasePushService");

const callHistory = require("../utils/callHistory");

const { isUserOnline } = require("../../socket/presence");

const callStore = require("./callStore");

const ringTimers = new Map();

const socketDisconnectTimers = new Map();

const CALL_RING_TIMEOUT_MS = Number(process.env.CALL_RING_TIMEOUT_MS) || 45 * 1000;

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

    answeredAt: room.answeredAt || null,

});

// FCM data payloads are limited to 4KB on Android. A base64 profile photo in fromUser made every

// call:incoming push fail with messaging/invalid-argument, so a backgrounded phone never rang.

const pushSafeUser = (user = {}) => {

    const avatar = typeof user.avatar === "string" && !user.avatar.startsWith("data:") && user.avatar.length <= 500

        ? user.avatar

        : "";

    return { _id: user._id, id: user.id || user._id, name: user.name, avatar, profileImage: avatar };

};

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

const getIo = (ioInstance) => ioInstance || (typeof io !== "undefined" ? io : (global.io || null));

const closeCallRoom = async (callId, ioInstance = null) => {

    const room = await callStore.get(callId);

    if (!room) return;

    clearLocalRingTimer(callId);

    if (!room.finishedAt) {

        room.finishedAt = Date.now();

        callHistory.recordCallFinished(room);

    }

    await callStore.remove(callId);

    if (room.conversationId) {

        const socketIo = getIo(ioInstance);

        socketIo?.to(`conversation:${room.conversationId}`).emit("call:ongoing-status", {

            conversationId: room.conversationId,

            active: false,

            callId: room.callId,

        });

    }

};

const maybeCloseRoom = async (callId, ioInstance = null) => {

    const room = await callStore.get(callId);

    if (!room) return;

    const hasActiveParticipant = Object.values(room.participants || {}).some(

        participant => participant.status === "joined" || participant.status === "invited"

    );

    if (!hasActiveParticipant) {

        await closeCallRoom(callId, ioInstance);

    }

};

// ---- Group call roster -------------------------------------------------------------------

// Everyone in the call sees who was added (and by whom), who is ringing, who joined, who did not

// answer, who left, and who was removed (and by whom).

const invitedTimers = new Map();

const rosterOf = (room) => Object.entries(room?.participants || {}).map(([userId, participant]) => ({

    userId,

    status: participant.status,

    user: participant.user || participant.invitedUser || { _id: userId, name: "Participant" },

    addedBy: participant.addedBy || null,

    addedByName: participant.addedByName || "",

    removedBy: participant.removedBy || null,

    removedByName: participant.removedByName || "",

    expiresAt: participant.status === "invited" ? (participant.expiresAt || room.expiresAt) : null,

}));

const broadcastRoster = (io, room) => {

    if (!room?.callId) return;

    emitToJoinedParticipants(io, room, "call:roster", {

        callId: room.callId,

        hostUserId: room.hostUserId,

        participants: rosterOf(room),

    });

};

const emitCallNotice = (io, room, notice) => {

    if (!room?.callId) return;

    emitToJoinedParticipants(io, room, "call:notice", { callId: room.callId, at: Date.now(), ...notice });

};

const nameOf = (room, userId) => {

    const participant = room?.participants?.[userId];

    return participant?.user?.name || participant?.invitedUser?.name || "Someone";

};

// Names for people who are only ringing, so the roster can show them before they join.

const lookupInvitedUsers = async (ids) => {

    if (!ids.length) return {};

    try {

        const users = await User.find({ _id: { $in: ids } }).select("name email avatar profileImage image").lean();

        return users.reduce((acc, user) => {

            acc[String(user._id)] = pushSafeUser(getPublicUser(user) || {});

            return acc;

        }, {});

    } catch (_) { return {}; }

};

// When one invitee's ringing runs out, mark only them as "missed" (the call itself goes on).

const scheduleInviteTimeout = (io, callId, userId, expiresAt) => {

    const key = `${callId}:${userId}`;

    clearTimeout(invitedTimers.get(key));

    const delay = Math.max(1000, Number(expiresAt || 0) - Date.now() + 500);

    invitedTimers.set(key, setTimeout(async () => {

        invitedTimers.delete(key);

        await callStore.withCallLock(callId, async () => {

            const room = await callStore.get(callId);

            const participant = room?.participants?.[userId];

            if (!room || participant?.status !== "invited") return;

            room.participants[userId] = { ...participant, status: "missed" };

            await callStore.save(room);

            clearCallPush([userId], callId);

            io.to(`user:${userId}`).emit("call:missed", { callId, fromUserId: room.hostUserId, reason: "No answer" });

            broadcastRoster(io, room);

            emitCallNotice(io, room, { type: "missed", targetUserId: userId, text: `${nameOf(room, userId)} didn't answer` });

            await maybeCloseRoom(callId, io);

        });

    }, delay));

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

            const invitedUsers = await lookupInvitedUsers(targetParticipantIds);

            targetParticipantIds.forEach(userId => {

                room.participants[userId] = {

                    status: "invited",

                    expiresAt: room.expiresAt,

                    user: null,

                    invitedUser: invitedUsers[userId] || null,

                    addedBy: socket.userId,

                    addedByName: callerUser.name || "",

                    socketId: null,

                };

            });

            await callStore.save(room);

            if (room.conversationId) {

                io.to(`conversation:${room.conversationId}`).emit("call:ongoing-status", {

                    conversationId: room.conversationId,

                    active: true,

                    callId: room.callId,

                    callType: room.callType,

                    title: room.title,

                    isGroupCall: room.isGroupCall,

                    startedAt: room.startedAt,

                    participantsCount: 1,

                });

            }

            if (isGroupCall) {

                targetParticipantIds.forEach(userId => scheduleInviteTimeout(io, callId, userId, room.expiresAt));

            }

            broadcastRoster(io, room);

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

                await closeCallRoom(callId, io);

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

                        fromUser: pushSafeUser(callerUser),

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

            if (room.conversationId) {

                const joinedCount = Object.values(room.participants || {}).filter(p => p.status === "joined").length;

                io.to(`conversation:${room.conversationId}`).emit("call:ongoing-status", {

                    conversationId: room.conversationId,

                    active: true,

                    callId: room.callId,

                    callType: room.callType,

                    title: room.title,

                    isGroupCall: room.isGroupCall,

                    startedAt: room.startedAt,

                    participantsCount: joinedCount,

                });

            }

            // Only the answering socket gets call:joined

            io.to(socket.id).emit("call:joined", {

                callId,

                callType: room.callType,

                participants: existingJoinedParticipants,

                title: room.title,

                isGroupCall: Boolean(room.isGroupCall),

                answeredAt: room.answeredAt,

            });

            // Notify already-joined participants

            emitToJoinedParticipants(io, room, "call:participant-joined", {

                callId,

                fromUserId: socket.userId,

                fromUser: participantUser,

                callType: room.callType,

                answeredAt: room.answeredAt,

            }, socket.userId);

            clearTimeout(invitedTimers.get(`${callId}:${socket.userId}`));

            broadcastRoster(io, room);

            if (room.isGroupCall) {

                emitCallNotice(io, room, { type: "joined", targetUserId: socket.userId, text: `${participantUser?.name || "Someone"} joined the call` });

            }

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

            // People who missed, declined, left or were removed can be added again.

            const requestedIds = getParticipantIds(data)

                .filter(userId => userId !== socket.userId && !["joined", "invited"].includes(room.participants[userId]?.status));

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

            const invitedUsers = await lookupInvitedUsers(targetParticipantIds);

            const inviteExpiresAt = Date.now() + CALL_RING_TIMEOUT_MS;

            targetParticipantIds.forEach(userId => {

                room.participants[userId] = {

                    status: "invited",

                    expiresAt: inviteExpiresAt,

                    user: null,

                    invitedUser: invitedUsers[userId] || room.participants[userId]?.user || null,

                    addedBy: socket.userId,

                    addedByName: inviterUser.name || "",

                    socketId: null,

                };

            });

            await callStore.save(room);

            targetParticipantIds.forEach(userId => scheduleInviteTimeout(io, callId, userId, inviteExpiresAt));

            broadcastRoster(io, room);

            emitCallNotice(io, room, {

                type: "added",

                byUserId: socket.userId,

                targetUserIds: targetParticipantIds,

                text: `${inviterUser.name || "Someone"} added ${targetParticipantIds.map(id => invitedUsers[id]?.name || "a participant").join(", ")}`,

            });

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

                        fromUser: pushSafeUser(inviterUser),

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

            clearTimeout(invitedTimers.get(`${callId}:${socket.userId}`));

            broadcastRoster(io, room);

            if (room.isGroupCall) {

                emitCallNotice(io, room, { type: "declined", targetUserId: socket.userId, text: `${getPublicUser(socket.user)?.name || "Someone"} declined the call` });

            }

            if (data.toUserId) {

                emitToParticipant(io, room, data.toUserId?.toString(), "call:rejected", {

                    callId,

                    fromUserId: socket.userId,

                });

            }

            await maybeCloseRoom(callId, io);

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

            // In a 1-to-1 call, either user ending the call terminates it for both

            if (!room.isGroupCall) {

                emitToCallParticipants(io, room, "call:ended", {

                    callId,

                    fromUserId: socket.userId,

                }, socket.userId);

                await closeCallRoom(callId, io);

                return;

            }

            // In a group call, broadcast participant-left and drop from other peers' screens immediately

            emitToJoinedParticipants(io, room, "call:participant-left", {

                callId,

                userId: socket.userId,

                fromUserId: socket.userId,

                user: getPublicUser(socket.user),

            }, socket.userId);

            emitToJoinedParticipants(io, room, "call:ended", {

                callId,

                fromUserId: socket.userId,

            }, socket.userId);

            broadcastRoster(io, room);

            emitCallNotice(io, room, {

                type: "left",

                targetUserId: socket.userId,

                text: `${getPublicUser(socket.user)?.name || "Someone"} left the call`

            });

            const remainingJoined = Object.values(room.participants || {}).filter(p => p.status === "joined");

            if (remainingJoined.length === 0) {

                emitToCallParticipants(io, room, "call:ended", {
                    callId,
                    fromUserId: socket.userId,
                }, socket.userId);
                await closeCallRoom(callId, io);

            } else if (room.conversationId) {

                io.to(`conversation:${room.conversationId}`).emit("call:ongoing-status", {

                    conversationId: room.conversationId,

                    active: true,

                    callId: room.callId,

                    callType: room.callType,

                    title: room.title,

                    isGroupCall: room.isGroupCall,

                    startedAt: room.startedAt,

                    participantsCount: remainingJoined.length,

                });

            }

        });

    });

    // Anyone in a call can end another participant's call (or stop someone's ringing); everyone

    // left in the call is told who removed whom.

    socket.on("call:remove-participant", async (data = {}) => {

        const callId = data.callId?.toString();

        const targetUserId = getUserId(data.userId || data.targetUserId);

        if (!callId || !targetUserId || targetUserId === socket.userId) return;

        await callStore.withCallLock(callId, async () => {

            const room = await callStore.get(callId);

            const me = room?.participants?.[socket.userId];

            const target = room?.participants?.[targetUserId];

            if (!room || me?.status !== "joined" || !target || !["joined", "invited"].includes(target.status)) return;

            const remover = getPublicUser(socket.user) || {};

            const targetName = nameOf(room, targetUserId);

            clearTimeout(invitedTimers.get(`${callId}:${targetUserId}`));

            room.participants[targetUserId] = {

                ...target,

                status: "removed",

                removedBy: socket.userId,

                removedByName: remover.name || "",

            };

            await callStore.save(room);

            clearCallPush([targetUserId], callId);

            // The removed person's devices end the call (ringing ones stop ringing).

            io.to(`user:${targetUserId}`).emit("call:removed", {

                callId, byUserId: socket.userId, byUser: pushSafeUser(remover), reason: `${remover.name || "Someone"} removed you from the call`,

            });

            if (target.status === "invited") {

                io.to(`user:${targetUserId}`).emit("call:missed", { callId, fromUserId: socket.userId, reason: "Removed" });

            }

            // Everyone else drops the removed person's connection.

            emitToJoinedParticipants(io, room, "call:ended", {

                callId, fromUserId: targetUserId, status: "removed",

            }, targetUserId);

            broadcastRoster(io, room);

            emitCallNotice(io, room, {

                type: "removed",

                byUserId: socket.userId,

                targetUserId,

                text: `${remover.name || "Someone"} ended ${targetName}'s call`,

            });

            await maybeCloseRoom(callId, io);

        });

    });

    socket.on("call:get-roster", async (data = {}, callback) => {

        const room = await callStore.get(data.callId?.toString());

        const payload = room?.participants?.[socket.userId]

            ? { callId: room.callId, hostUserId: room.hostUserId, participants: rosterOf(room) }

            : null;

        if (typeof callback === "function") callback(payload);

        else if (payload) socket.emit("call:roster", payload);

    });

    socket.on("call:get-ongoing", async (data = {}, callback) => {

        if (typeof callback !== "function") return;

        const conversationId = data.conversationId?.toString();

        if (!conversationId) {

            return callback({ active: false });

        }

        const allRooms = await callStore.listAll();

        const activeRoom = allRooms.find(r => 

            String(r.conversationId) === conversationId &&

            !r.finishedAt &&

            Object.values(r.participants || {}).some(p => p.status === "joined")

        );

        if (!activeRoom) {

            return callback({ active: false });

        }

        const joinedCount = Object.values(activeRoom.participants || {}).filter(p => p.status === "joined").length;

        return callback({

            active: true,

            callId: activeRoom.callId,

            callType: activeRoom.callType,

            title: activeRoom.title,

            isGroupCall: Boolean(activeRoom.isGroupCall),

            startedAt: activeRoom.startedAt,

            answeredAt: activeRoom.answeredAt,

            participantsCount: joinedCount,

            conversationId: activeRoom.conversationId,

        });

    });

    socket.on("call:rejoin", async (data = {}, callback) => {

        const callId = data.callId?.toString();

        if (!callId) {

            if (typeof callback === "function") callback({ success: false, message: "Invalid call ID" });

            return;

        }

        await callStore.withCallLock(callId, async () => {

            const room = await callStore.get(callId);

            if (!room || room.finishedAt) {

                if (typeof callback === "function") callback({ success: false, message: "Call has ended" });

                return;

            }

            if (socket.companyId && room.companyId && String(socket.companyId) !== String(room.companyId)) {
                if (typeof callback === "function") callback({ success: false, message: "Unauthorized" });
                return;
            }

            const existingP = room.participants?.[socket.userId];
            if (existingP?.status === "removed") {
                if (typeof callback === "function") callback({ success: false, message: "You were removed from this call" });
                return;
            }

            if (!room.isGroupCall && !existingP) {
                if (typeof callback === "function") callback({ success: false, message: "Unauthorized" });
                return;
            }

            const participantUser = getPublicUser(socket.user);

            const existingJoinedParticipants = Object.entries(room.participants || {})

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

            const payload = {

                callId,

                callType: room.callType,

                participants: existingJoinedParticipants,

                title: room.title,

                isGroupCall: Boolean(room.isGroupCall),

                answeredAt: room.answeredAt,

                conversationId: room.conversationId,

            };

            if (typeof callback === "function") {

                callback({ success: true, ...payload });

            }

            io.to(socket.id).emit("call:joined", payload);

            emitToJoinedParticipants(io, room, "call:participant-joined", {

                callId,

                fromUserId: socket.userId,

                fromUser: participantUser,

                callType: room.callType,

                answeredAt: room.answeredAt,

            }, socket.userId);

            broadcastRoster(io, room);

            if (room.isGroupCall) {

                emitCallNotice(io, room, {

                    type: "joined",

                    targetUserId: socket.userId,

                    text: `${participantUser.name || "Someone"} rejoined the call`,

                });

            }

            if (room.conversationId) {

                io.to(`conversation:${room.conversationId}`).emit("call:ongoing-status", {

                    conversationId: room.conversationId,

                    active: true,

                    callId: room.callId,

                    callType: room.callType,

                    title: room.title,

                    isGroupCall: room.isGroupCall,

                    startedAt: room.startedAt,

                    participantsCount: existingJoinedParticipants.length + 1,

                });

            }

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

                            if (!latestRoom.isGroupCall) {
                                emitToCallParticipants(io, latestRoom, "call:ended", {
                                    callId: latestRoom.callId,
                                    fromUserId: socket.userId,
                                    reason: "Disconnected",
                                }, socket.userId);
                                await closeCallRoom(latestRoom.callId, io);
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
                                emitToJoinedParticipants(io, latestRoom, "call:participant-left", {
                                    callId: latestRoom.callId,
                                    fromUserId: socket.userId,
                                }, socket.userId);

                                broadcastRoster(io, latestRoom);

                                if (latestRoom.isGroupCall) {

                                    emitCallNotice(io, latestRoom, { type: "left", targetUserId: socket.userId, text: `${getPublicUser(socket.user)?.name || "Someone"} disconnected` });

                                }

                                await maybeCloseRoom(latestRoom.callId, io);

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

