const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
{
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Company",
        required: true
    },

    conversationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Conversation",
        required: true
    },

    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    text: {
        type: String,
        default: ""
    },

    messageType: {
        type: String,
        enum: ["message", "system"],
        default: "message"
    },

    systemEvent: {
        type: {
            type: String,
            default: ""
        },
        actor: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        mode: {
            type: String,
            default: ""
        }
    },

    replyTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Message",
        default: null
    },

    reactions: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        emoji: {
            type: String,
            required: true,
            maxlength: 16
        }
    }],

    expiresAt: {
        type: Date,
        default: null,
        index: {expireAfterSeconds: 0}
    },

    file: {
        type: String,
        default: ""
    },

    fileType: {
            type: String,
            default: ""
        },

    deletedFor: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    }],

    deletedForEveryone: {
        type: Boolean,
        default: false
    },

    isForwarded: {
        type: Boolean,
        default: false
    },

    originalMessage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Message",
        default: null
    },

    seenBy: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    }]
},
{ timestamps: true }
);

module.exports = mongoose.model(
    "Message",
    messageSchema
);
