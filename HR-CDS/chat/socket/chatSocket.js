const Conversation = require("../models/Conversation");
const Message = require("../models/Message");

const onlineUsers = new Map();

const addOnlineUser = (userId, socketId) => {
    const key = userId.toString();
    const sockets = onlineUsers.get(key) || new Set();
    sockets.add(socketId);
    onlineUsers.set(key, sockets);
};

const removeOnlineUser = (userId, socketId) => {
    const key = userId.toString();
    const sockets = onlineUsers.get(key);
    if (!sockets) return;
    sockets.delete(socketId);
    if (sockets.size === 0) {
        onlineUsers.delete(key);
    }
};

const emitOnlineUsers = (io, companyId) => {
    io.to(`company:${companyId}`).emit(
        "chat:online-users",
        Array.from(onlineUsers.keys())
    );
};

const getCompanyOnlineUsers = (io, companyId) => {
    const companyRoom = io.sockets.adapter.rooms.get(`company:${companyId}`);
    if (!companyRoom) return [];

    const userIds = new Set();
    companyRoom.forEach(socketId => {
        const connectedSocket = io.sockets.sockets.get(socketId);
        if (connectedSocket?.userId) {
            userIds.add(connectedSocket.userId.toString());
        }
    });

    return Array.from(userIds);
};

const getUnreadCount = (conversationId, userId, companyId) => Message.countDocuments({
    conversationId,
    companyId,
    sender: {$ne: userId},
    seenBy: {$ne: userId},
    deletedFor: {$ne: userId},
    deletedForEveryone: false,
});

const emitUnreadCounts = async (io, conversation, senderId) => {
    if (!conversation) return;

    await Promise.all((conversation.members || []).map(async member => {
        const memberId = member.toString();
        const count = await getUnreadCount(conversation._id, memberId, conversation.companyId);
        io.to(`user:${memberId}`).emit("chat:unread-update", {
            senderId,
            conversationId: conversation._id,
            count,
        });
    }));
};

const chatSocket = (io, socket) => {

    console.log(
        "💬 Chat Connected:",
        socket.user.name
    );

    // USER ROOM
    socket.join(`user:${socket.userId}`);
    console.log(
    "✅ JOINED ROOM:",
    `user:${socket.userId}`
);

    // COMPANY ROOM
    socket.join(`company:${socket.companyId}`);

    // STORE ONLINE USER
    addOnlineUser(socket.userId, socket.id);
    console.log(
    "🟢 ONLINE USERS:",
        Array.from(onlineUsers.keys())
);

    // SEND ONLINE USERS
    emitOnlineUsers(io, socket.companyId);

    socket.on("chat:get-online-users", (callback) => {
        const users = getCompanyOnlineUsers(io, socket.companyId);
        if (typeof callback === "function") {
            callback(users);
        } else {
            socket.emit("chat:online-users", users);
        }
    });



// JOIN A CONVERSATION ROOM
    socket.on(
        "chat:join-conversation",
        async (data) => {
            if (!data || !data.conversationId) {
                return;
            }

            const conversation = await Conversation.findOne({
                _id: data.conversationId,
                companyId: socket.companyId,
                members: socket.userId
            });

            if (!conversation) {
                return;
            }

            socket.join(`conversation:${data.conversationId}`);
            console.log(
                "✅ JOINED CONVERSATION ROOM:",
                `conversation:${data.conversationId}`
            );
        }
    );

    socket.on(
        "chat:leave-conversation",
        (data) => {
            if (!data || !data.conversationId) {
                return;
            }

            socket.leave(`conversation:${data.conversationId}`);
            console.log(
                "⛔ LEFT CONVERSATION ROOM:",
                `conversation:${data.conversationId}`
            );
        }
    );

    socket.on(
        "chat:join-conversations",
        (data) => {
            if (!data || !Array.isArray(data.conversationIds)) {
                return;
            }

            data.conversationIds.forEach((conversationId) => {
                socket.join(`conversation:${conversationId}`);
            });
        }
    );

    // SEND MESSAGE
socket.on(
    "chat:send-message",
    async (data) => {

        console.log(
            "📩 SOCKET MESSAGE:",
            data
        );

        const room = data.conversationId
            ? `conversation:${data.conversationId}`
            : `user:${data.receiverId}`;

        console.log(
            "📤 SENDING TO ROOM:",
            room
        );

        if (data?._id) {
            io.to(room).emit(
                "chat:receive-message",
                data
            );
        }

        if (data.conversationId) {
            const conversation = await Conversation.findOne({
                _id: data.conversationId,
                companyId: socket.companyId,
                members: socket.userId
            });
            await emitUnreadCounts(io, conversation, socket.userId);
        } else if (data.receiverId) {
            socket.to(`user:${data.receiverId}`).emit(
                "chat:unread-update",
                {
                    senderId: socket.userId
                }
            );
        }

        console.log(
            "✅ MESSAGE EMITTED"
        );
    }
);


    // TYPING
    socket.on(
        "chat:typing",
        (data) => {
            const room = data.conversationId
                ? `conversation:${data.conversationId}`
                : `user:${data.receiverId}`;

            socket.to(room).emit(
                "chat:typing",
                {
                    senderId: socket.userId,
                    conversationId: data.conversationId
                }
            );
        }
    );



    // STOP TYPING
    socket.on(
        "chat:stop-typing",
        (data) => {
            const room = data.conversationId
                ? `conversation:${data.conversationId}`
                : `user:${data.receiverId}`;

            socket.to(room).emit(
                "chat:stop-typing",
                {
                    senderId: socket.userId,
                    conversationId: data.conversationId
                }
            );
        }
    );

    // MARK MESSAGE SEEN
socket.on(
    "chat:seen",
    async (data) => {
        if (!data?.messageId) return;

        const message = await Message.findOne({
            _id: data.messageId,
            companyId: socket.companyId
        });

        if (!message) return;

        const conversation = await Conversation.findOne({
            _id: message.conversationId,
            companyId: socket.companyId,
            members: socket.userId
        });

        if (!conversation) return;

        message.seenBy.addToSet(socket.userId);
        await message.save();
        await emitUnreadCounts(io, conversation, socket.userId);

        io.to(
            `user:${message.sender}`
        ).emit(
            "chat:message-seen",
            {
                messageId: data.messageId,
                conversationId: conversation._id,
                seenBy: socket.userId
            }
        );
    }
);

    socket.on(
        "chat:delete-for-me",
        (data) => {
            if (!data?.messageId) return;
            io.to(`user:${socket.userId}`).emit(
                "chat:message-deleted-for-me",
                {
                    messageId: data.messageId,
                    conversationId: data.conversationId
                }
            );
        }
    );

    socket.on(
        "chat:delete-for-everyone",
        (data) => {
            if (!data?.messageId || !data?.conversationId) return;
            io.to(`conversation:${data.conversationId}`).emit(
                "chat:message-deleted-for-everyone",
                {
                    messageId: data.messageId,
                    conversationId: data.conversationId
                }
            );
        }
    );

    socket.on(
        "chat:forward-message",
        (data) => {
            if (!data?.message) return;
            const room = data.message.conversationId
                ? `conversation:${data.message.conversationId}`
                : null;

            if (room) {
                io.to(room).emit("chat:message-forwarded", data.message);
            }
        }
    );


    // DISCONNECT
    socket.on("disconnect", () => {

        console.log(
            "❌ Chat Disconnect"
        );

        removeOnlineUser(socket.userId, socket.id);

        emitOnlineUsers(io, socket.companyId);
    });
};

module.exports = chatSocket;
