const activeCalls = new Map();
const CALL_RING_TIMEOUT_MS = 45 * 1000;

const getPublicUser = (user) => ({
    _id: user?._id?.toString(),
    id: user?._id?.toString(),
    name: user?.name || user?.email || "User",
    email: user?.email,
    avatar: user?.avatar || user?.profileImage || user?.image,
});

const normalizeCallerUser = (socket, data = {}) => {
    const socketUser = getPublicUser(socket.user);
    const clientUser = data.callerUser && typeof data.callerUser === "object"
        ? getPublicUser(data.callerUser)
        : {};

    return {
        ...socketUser,
        ...clientUser,
        _id: socket.userId,
        id: socket.userId,
        name: clientUser.name || socketUser.name || "User",
    };
};

const emitToUser = (io, userId, eventName, payload) => {
    if (!userId) return;
    io.to(`user:${userId}`).emit(eventName, payload);
};

const getUserId = (value) => {
    if (!value) return "";
    if (typeof value !== "object") return value.toString();

    const rawId = value._id || value.id || value.userId || value.user?._id || value.user?.id;
    if (!rawId) return "";

    return typeof rawId === "object" ? getUserId(rawId) : rawId.toString();
};

const isUserOnline = (io, userId) => {
    const normalizedUserId = getUserId(userId);
    if (!normalizedUserId) return false;
    const room = io.sockets.adapter.rooms.get(`user:${normalizedUserId}`);
    return Boolean(room && room.size > 0);
};

const getParticipantIds = (data = {}) => {
    const ids = Array.isArray(data.participantIds) ? data.participantIds : [data.toUserId];
    return [...new Set(ids.map(getUserId).filter(Boolean))];
};

const getCallRoom = (callId) => activeCalls.get(callId?.toString());

const emitCallUnavailable = (socket, payload = {}, reason = "User is not available for call") => {
    socket.emit("call:unavailable", {
        callId: payload.callId,
        toUserId: payload.toUserId,
        reason,
    });
};

const emitToJoinedParticipants = (io, room, eventName, payload, exceptUserId) => {
    if (!room) return;
    room.participants.forEach((participant, userId) => {
        if (userId === exceptUserId || participant.status !== "joined") return;
        emitToUser(io, userId, eventName, payload);
    });
};

const emitToCallParticipants = (io, room, eventName, payload, exceptUserId) => {
    if (!room) return;
    room.participants.forEach((participant, userId) => {
        if (userId === exceptUserId || !["joined", "invited"].includes(participant.status)) return;
        emitToUser(io, userId, eventName, payload);
    });
};

const maybeCloseRoom = (callId) => {
    const room = getCallRoom(callId);
    if (!room) return;

    const hasActiveParticipant = Array.from(room.participants.values()).some(
        participant => participant.status === "joined" || participant.status === "invited"
    );

    if (!hasActiveParticipant) {
        if (room.ringTimeout) {
            clearTimeout(room.ringTimeout);
        }
        activeCalls.delete(callId?.toString());
    }
};

const closeCallRoom = (callId) => {
    const room = getCallRoom(callId);
    if (!room) return;
    if (room.ringTimeout) {
        clearTimeout(room.ringTimeout);
    }
    activeCalls.delete(callId?.toString());
};

const callSocket = (io, socket) => {
    socket.on("call:check-availability", (data = {}, callback) => {
        const participantIds = getParticipantIds(data).filter(userId => userId !== socket.userId);
        const unavailableIds = participantIds.filter(userId => !isUserOnline(io, userId));
        const onlineCount = participantIds.length - unavailableIds.length;
        const available = onlineCount > 0;

        if (typeof callback === "function") {
            callback({
                success: available,
                available,
                unavailableIds,
                reason: available ? "" : "Users are offline",
            });
        }
    });

    socket.on("call:invite", (data = {}) => {
        const participantIds = getParticipantIds(data).filter(userId => userId !== socket.userId);
        const callType = data.callType === "video" ? "video" : "audio";

        if (participantIds.length === 0) {
            emitCallUnavailable(socket, data, "Invalid call receiver");
            return;
        }

        const onlineParticipantIds = participantIds.filter(userId => isUserOnline(io, userId));
        if (onlineParticipantIds.length === 0) {
            emitCallUnavailable(socket, data, "Users are offline");
            return;
        }

        const callId = data.callId?.toString();
        const callerUser = normalizeCallerUser(socket, data);
        const room = {
            callId,
            callType,
            hostUserId: socket.userId,
            title: data.title || "",
            participants: new Map(),
            ringTimeout: null,
        };

        room.participants.set(socket.userId, {
            status: "joined",
            user: callerUser,
        });

        onlineParticipantIds.forEach(userId => {
            room.participants.set(userId, {
                status: "invited",
                user: null,
            });
        });

        activeCalls.set(callId, room);

        room.ringTimeout = setTimeout(() => {
            const latestRoom = getCallRoom(callId);
            if (!latestRoom) return;
            const hasAcceptedParticipant = Array.from(latestRoom.participants.entries())
                .some(([userId, participant]) => userId !== latestRoom.hostUserId && participant.status === "joined");
            if (hasAcceptedParticipant) return;

            emitToCallParticipants(io, latestRoom, "call:missed", {
                callId,
                fromUserId: latestRoom.hostUserId,
                reason: "No answer",
            });
            activeCalls.delete(callId);
        }, CALL_RING_TIMEOUT_MS);

        onlineParticipantIds.forEach(userId => {
            emitToUser(io, userId, "call:incoming", {
                callId,
                fromUserId: socket.userId,
                fromUser: callerUser,
                participantIds: [socket.userId, ...onlineParticipantIds],
                title: data.title,
                callType,
            });
        });

        socket.emit("call:ringing", {
            callId,
            toUserIds: onlineParticipantIds,
            unavailableIds: participantIds.filter(userId => !onlineParticipantIds.includes(userId)),
            callType,
        });
    });

    socket.on("call:accept", (data = {}) => {
        const callId = data.callId?.toString();
        const room = getCallRoom(callId);

        if (!room) {
            emitCallUnavailable(socket, data, "Call is no longer active");
            return;
        }

        const participantUser = getPublicUser(socket.user);
        const existingJoinedParticipants = Array.from(room.participants.entries())
            .filter(([userId, participant]) => userId !== socket.userId && participant.status === "joined")
            .map(([userId, participant]) => ({
                userId,
                user: participant.user,
            }));

        room.participants.set(socket.userId, {
            status: "joined",
            user: participantUser,
        });

        if (room.ringTimeout) {
            clearTimeout(room.ringTimeout);
            room.ringTimeout = null;
        }

        emitToUser(io, socket.userId, "call:joined", {
            callId,
            callType: room.callType,
            participants: existingJoinedParticipants,
            title: room.title,
        });

        emitToJoinedParticipants(io, room, "call:participant-joined", {
            callId,
            fromUserId: socket.userId,
            fromUser: participantUser,
            callType: room.callType,
        }, socket.userId);
    });

    socket.on("call:reject", (data = {}) => {
        const callId = data.callId?.toString();
        const room = getCallRoom(callId);

        if (room?.participants.has(socket.userId)) {
            room.participants.set(socket.userId, {
                ...room.participants.get(socket.userId),
                status: "rejected",
                user: getPublicUser(socket.user),
            });
        }

        emitToJoinedParticipants(io, room, "call:rejected", {
            callId,
            fromUserId: socket.userId,
        }, socket.userId);

        if (data.toUserId) {
            emitToUser(io, data.toUserId?.toString(), "call:rejected", {
                callId,
                fromUserId: socket.userId,
            });
        }

        maybeCloseRoom(callId);
    });

    socket.on("call:offer", (data = {}) => {
        emitToUser(io, data.toUserId?.toString(), "call:offer", {
            callId: data.callId,
            fromUserId: socket.userId,
            fromUser: getPublicUser(socket.user),
            offer: data.offer,
        });
    });

    socket.on("call:answer", (data = {}) => {
        emitToUser(io, data.toUserId?.toString(), "call:answer", {
            callId: data.callId,
            fromUserId: socket.userId,
            fromUser: getPublicUser(socket.user),
            answer: data.answer,
        });
    });

    socket.on("call:ice-candidate", (data = {}) => {
        emitToUser(io, data.toUserId?.toString(), "call:ice-candidate", {
            callId: data.callId,
            fromUserId: socket.userId,
            candidate: data.candidate,
        });
    });

    socket.on("call:end", (data = {}) => {
        const callId = data.callId?.toString();
        const room = getCallRoom(callId);

        if (room?.participants.has(socket.userId)) {
            room.participants.set(socket.userId, {
                ...room.participants.get(socket.userId),
                status: "ended",
                user: getPublicUser(socket.user),
            });
        }

        if (room) {
            if (room.hostUserId === socket.userId) {
                emitToCallParticipants(io, room, "call:ended", {
                    callId,
                    fromUserId: socket.userId,
                }, socket.userId);
                closeCallRoom(callId);
                return;
            }
            emitToJoinedParticipants(io, room, "call:ended", {
                callId,
                fromUserId: socket.userId,
            }, socket.userId);
            maybeCloseRoom(callId);
            return;
        }

        emitToUser(io, data.toUserId?.toString(), "call:ended", {
            callId,
            fromUserId: socket.userId,
        });
    });

    socket.on("disconnect", () => {
        activeCalls.forEach((room, callId) => {
            if (!room.participants.has(socket.userId)) return;

            room.participants.set(socket.userId, {
                ...room.participants.get(socket.userId),
                status: "ended",
                user: getPublicUser(socket.user),
            });

            emitToJoinedParticipants(io, room, "call:ended", {
                callId,
                fromUserId: socket.userId,
            }, socket.userId);
            maybeCloseRoom(callId);
        });
    });
};

module.exports = callSocket;
