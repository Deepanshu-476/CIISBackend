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



   // SEND MESSAGE
socket.on(
    "chat:send-message",
    async (data) => {

        console.log(
            "📩 SOCKET MESSAGE:",
            data
        );

        console.log(
            "📤 SENDING TO ROOM:",
            `user:${data.receiverId}`
        );

        io.to(
            `user:${data.receiverId}`
        ).emit(
            "chat:receive-message",
            data
        );

        io.to(
            `user:${data.receiverId}`
        ).emit(
            "chat:unread-update",
            {
                senderId: socket.userId,
                count: 1
            }
        );

        console.log(
            "✅ MESSAGE EMITTED"
        );
    }
);


    // TYPING
    socket.on(
        "chat:typing",
        (data) => {

            socket.to(
                `user:${data.receiverId}`
            ).emit(
                "chat:typing",
                {
                    senderId: socket.userId
                }
            );
        }
    );



    // STOP TYPING
    socket.on(
        "chat:stop-typing",
        (data) => {

            socket.to(
                `user:${data.receiverId}`
            ).emit(
                "chat:stop-typing",
                {
                    senderId: socket.userId
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