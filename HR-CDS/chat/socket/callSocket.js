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

const callSocket = (io, socket) => {
    socket.on("call:invite", (data = {}) => {
        const toUserId = data.toUserId?.toString();
        const callType = data.callType === "video" ? "video" : "audio";

        if (!toUserId || toUserId === socket.userId) {
            return;
        }

        emitToUser(io, toUserId, "call:incoming", {
            callId: data.callId,
            fromUserId: socket.userId,
            fromUser: getPublicUser(socket.user),
            callType,
        });
    });

    socket.on("call:accept", (data = {}) => {
        emitToUser(io, data.toUserId?.toString(), "call:accepted", {
            callId: data.callId,
            fromUserId: socket.userId,
            fromUser: getPublicUser(socket.user),
            callType: data.callType === "video" ? "video" : "audio",
        });
    });

    socket.on("call:reject", (data = {}) => {
        emitToUser(io, data.toUserId?.toString(), "call:rejected", {
            callId: data.callId,
            fromUserId: socket.userId,
        });
    });

    socket.on("call:offer", (data = {}) => {
        emitToUser(io, data.toUserId?.toString(), "call:offer", {
            callId: data.callId,
            fromUserId: socket.userId,
            offer: data.offer,
        });
    });

    socket.on("call:answer", (data = {}) => {
        emitToUser(io, data.toUserId?.toString(), "call:answer", {
            callId: data.callId,
            fromUserId: socket.userId,
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
        emitToUser(io, data.toUserId?.toString(), "call:ended", {
            callId: data.callId,
            fromUserId: socket.userId,
        });
    });
};

module.exports = callSocket;
