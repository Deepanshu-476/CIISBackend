const onlineUsers = new Map();

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
    onlineUsers.set(
        socket.userId,
        socket.id
    );
    console.log(
    "🟢 ONLINE USERS:",
    Array.from(onlineUsers.keys())
);

    // SEND ONLINE USERS
    io.to(`company:${socket.companyId}`).emit(
        "chat:online-users",
        Array.from(onlineUsers.keys())
    );



// JOIN A CONVERSATION ROOM
    socket.on(
        "chat:join-conversation",
        (data) => {
            if (!data || !data.conversationId) {
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

        io.to(room).emit(
            "chat:receive-message",
            data
        );

        if (data.conversationId) {
            socket.to(room).emit(
                "chat:unread-update",
                {
                    senderId: socket.userId,
                    conversationId: data.conversationId
                }
            );
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

        io.to(
            `user:${data.senderId}`
        ).emit(
            "chat:message-seen",
            {
                messageId:
                    data.messageId
            }
        );
    }
);


    // DISCONNECT
    socket.on("disconnect", () => {

        console.log(
            "❌ Chat Disconnect"
        );

        onlineUsers.delete(
            socket.userId
        );

        io.to(
            `company:${socket.companyId}`
        ).emit(
            "chat:online-users",
            Array.from(
                onlineUsers.keys()
            )
        );
    });
};

module.exports = chatSocket;