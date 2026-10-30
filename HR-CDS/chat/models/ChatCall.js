const mongoose = require("mongoose");

// One record per chat call, written by the call socket so users can see call history.
const chatCallSchema = new mongoose.Schema(
{
    callId: {
        type: String,
        required: true,
        unique: true
    },

    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Company",
        default: null
    },

    conversationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Conversation",
        default: null
    },

    caller: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    participants: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    }],

    // Participants who picked up; anyone else in `participants` missed the call.
    answeredBy: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    }],

    callType: {
        type: String,
        enum: ["audio", "video"],
        default: "audio"
    },

    isGroupCall: {
        type: Boolean,
        default: false
    },

    title: {
        type: String,
        default: ""
    },

    status: {
        type: String,
        enum: ["ringing", "ongoing", "completed", "missed", "rejected"],
        default: "ringing"
    },

    startedAt: {
        type: Date,
        default: Date.now
    },

    answeredAt: {
        type: Date,
        default: null
    },

    endedAt: {
        type: Date,
        default: null
    },

    durationSeconds: {
        type: Number,
        default: 0
    }
},
{ timestamps: true }
);

chatCallSchema.index({ companyId: 1, caller: 1, startedAt: -1 });
chatCallSchema.index({ companyId: 1, participants: 1, startedAt: -1 });

module.exports = mongoose.model("ChatCall", chatCallSchema);
