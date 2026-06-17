const activeCalls = new Map();

const getPublicUser = (user) => ({
    _id: user?._id?.toString(),
    id: user?._id?.toString(),
    name: user?.name || user?.email || "User",
    email: user?.email,
    avatar: user?.avatar || user?.profileImage || user?.image,
});

const emitToUser = (io, userId, eventName, payload) => {
    if (!userId) return;
    io.to(`user:${userId}`).emit(eventName, payload);
};

const isUserOnline = (io, userId) => {
    if (!userId) return false;
    const room = io.sockets.adapter.rooms.get(`user:${userId}`);
    return Boolean(room && room.size > 0);
};

const getParticipantIds = (data = {}) => {
    const ids = Array.isArray(data.participantIds) ? data.participantIds : [data.toUserId];
    return [...new Set(ids.map(id => id?.toString()).filter(Boolean))];
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
        activeCalls.delete(callId?.toString());
    }
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
        const callerUser = getPublicUser(socket.user);
        const room = {
            callId,
            callType,
            hostUserId: socket.userId,
            title: data.title || "",
            participants: new Map(),
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
                activeCalls.delete(callId);
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
