const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const { getCompanyOnlineUsers } = require("../../socket/presence");
const { getUnreadCount } = require("../utils/unreadCount");

const emitUnreadCounts = async (io, conversation, senderId) => {
    if (!conversation) return;

    await Promise.all((conversation.members || []).map(async member => {
        const memberId = member.toString();
        const count = await getUnreadCount(conversation._id, memberId, conversation.companyId, conversation.readState || []);
        io.to(`user:${memberId}`).emit("chat:unread-update", {
            senderId,
            conversationId: conversation._id,
            count,
        });
    }));
};

const chatSocket = (io, socket) => {
    socket.data.userId = String(socket.userId);
    socket.use(require("./projectChatPacketGuard")(socket));

    void 0;

    
    socket.join(`user:${socket.userId}`);
    void 0;

    
    socket.join(`company:${socket.companyId}`);

    
    socket.on("chat:get-online-users", async (callback) => {
        const users = await getCompanyOnlineUsers(io, socket.companyId);
        if (typeof callback === "function") {
            callback(users);
        } else {
            socket.emit("chat:online-users", users);
        }
    });




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
            void 0;
        }
    );

    socket.on(
        "chat:leave-conversation",
        (data) => {
            if (!data || !data.conversationId) {
                return;
            }

            socket.leave(`conversation:${data.conversationId}`);
            void 0;
        }
    );

    socket.on(
        "chat:join-conversations",
        async (data) => {
            if (!data || !Array.isArray(data.conversationIds) || !data.conversationIds.length) {
                return;
            }

            const validConversations = await Conversation.find({
                _id: { $in: data.conversationIds },
                companyId: socket.companyId,
                members: socket.userId
            }).select('_id');

            validConversations.forEach((conv) => {
                socket.join(`conversation:${conv._id}`);
            });
        }
    );

    
socket.on(
    "chat:send-message",
    async (data) => {

        void 0;

        const room = data.conversationId
            ? `conversation:${data.conversationId}`
            : `user:${data.receiverId}`;

        void 0;

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
            const deliveredTo = conversation
                ? getCompanyOnlineUsers(io, socket.companyId)
                    .filter(userId => userId !== socket.userId.toString())
                    .filter(userId => (conversation.members || []).map(member => member.toString()).includes(userId))
                : [];
            if (data?._id && deliveredTo.length) {
                await Message.updateOne(
                    {_id: data._id, companyId: socket.companyId},
                    {$addToSet: {deliveredTo: {$each: deliveredTo}}}
                );
                io.to(`user:${socket.userId}`).emit("chat:message-delivered", {
                    messageId: data._id,
                    conversationId: data.conversationId,
                    deliveredTo,
                });
            }
            await emitUnreadCounts(io, conversation, socket.userId);
        } else if (data.receiverId) {
            socket.to(`user:${data.receiverId}`).emit(
                "chat:unread-update",
                {
                    senderId: socket.userId
                }
            );
        }

        void 0;
    }
);


    
    socket.on(
        "chat:typing",
        (data) => {
            if (data?.conversationId && !socket.rooms.has(`conversation:${data.conversationId}`)) {
                return;
            }
            const room = data?.conversationId
                ? `conversation:${data.conversationId}`
                : (data?.receiverId ? `user:${data.receiverId}` : null);

            if (!room) return;

            socket.to(room).emit(
                "chat:typing",
                {
                    senderId: socket.userId,
                    conversationId: data.conversationId
                }
            );
        }
    );



    
    socket.on(
        "chat:stop-typing",
        (data) => {
            if (data?.conversationId && !socket.rooms.has(`conversation:${data.conversationId}`)) {
                return;
            }
            const room = data?.conversationId
                ? `conversation:${data.conversationId}`
                : (data?.receiverId ? `user:${data.receiverId}` : null);

            if (!room) return;

            socket.to(room).emit(
                "chat:stop-typing",
                {
                    senderId: socket.userId,
                    conversationId: data.conversationId
                }
            );
        }
    );

    
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

        message.deliveredTo.addToSet(socket.userId);
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
            if (!socket.rooms.has(`conversation:${data.conversationId}`)) return;
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
};

module.exports = chatSocket;
