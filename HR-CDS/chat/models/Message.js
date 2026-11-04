const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
{
    eventKey: String,
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
        client: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
        project: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
        task: mongoose.Schema.Types.ObjectId,
        mentionedUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
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



    
    mentions: [{
        _id: false,
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        label: { type: String, required: true },
        start: { type: Number, required: true },
        end: { type: Number, required: true }
    }],

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
    // Display-only copy (webp) of a photo that browsers cannot show or that is very
    // large. `file` always stays the original upload, used for download/save/share.
    previewFile: { type: String, default: "" },
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
    }],

    // When each member received / read the message, for "Message info". seenBy and
    // deliveredTo stay the source of the tick marks; messages from before these fields
    // existed simply have no times. Not sent with messages (one entry per member would
    // bloat every group message); only the message-info endpoint selects them.
    deliveryReceipts: {
      select: false,
      type: [{
        _id: false,
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        at: { type: Date, required: true }
      }]
    },

    readReceipts: {
      select: false,
      type: [{
        _id: false,
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        at: { type: Date, required: true }
      }]
    }
},
{ timestamps: true }
);

messageSchema.index({ companyId: 1, conversationId: 1, createdAt: -1 });
messageSchema.index({ companyId: 1, conversationId: 1, createdAt: -1, _id: -1 });
messageSchema.index({ companyId: 1, conversationId: 1, sender: 1, createdAt: -1 });
messageSchema.index({ companyId: 1, conversationId: 1, deletedForEveryone: 1, createdAt: -1 });
messageSchema.index({ companyId: 1, sender: 1, createdAt: -1 });
messageSchema.index({ eventKey: 1 }, { unique: true, partialFilterExpression: { eventKey: { $type: "string" } } });

module.exports = mongoose.model(
    "Message",
    messageSchema
);
