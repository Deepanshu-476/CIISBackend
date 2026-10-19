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

    // Filled for systemEvent.type === "call" so the thread can show call time and duration.
    call: {
        callId: { type: String, default: "" },
        callType: { type: String, default: "" },
        status: { type: String, default: "" },
        durationSeconds: { type: Number, default: 0 },
        caller: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
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

    fileName: { type: String, default: "" },
    fileSize: { type: Number, default: 0 },
    // Voice note length in seconds, sent by the recorder so players can show it before download.
    duration: { type: Number, default: 0, min: 0 },

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
    }],

    deliveredTo: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    }]
},
{ timestamps: true }
);

messageSchema.index({ companyId: 1, conversationId: 1, createdAt: -1 });
messageSchema.index({ companyId: 1, conversationId: 1, sender: 1, createdAt: -1 });
messageSchema.index({ companyId: 1, conversationId: 1, deletedForEveryone: 1, createdAt: -1 });
messageSchema.index({ companyId: 1, sender: 1, createdAt: -1 });

module.exports = mongoose.model(
    "Message",
    messageSchema
);
