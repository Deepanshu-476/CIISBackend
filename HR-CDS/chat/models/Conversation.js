const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
{
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Company",
        required: true
    },

    members: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    }],

    isGroup: {
        type: Boolean,
        default: false
    },

    groupId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Group",
        default: null
    },

    groupName: {
        type: String,
        default: ""
    },

    groupImage: {
        type: String,
        default: ""
    },

    admins: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    }],

    notificationSettings: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        muted: {
            type: Boolean,
            default: false
        },
        mutedUntil: {
            type: Date,
            default: null
        }
    }],

    disappearingMode: {
        type: String,
        enum: ["off", "24h", "7d", "90d"],
        default: "off"
    },

    disappearingUpdatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null
    },

    disappearingUpdatedAt: {
        type: Date,
        default: null
    }
},
{ timestamps: true }
);

conversationSchema.index({ companyId: 1, members: 1, updatedAt: -1 });
conversationSchema.index({ companyId: 1, groupId: 1 });
conversationSchema.index({ companyId: 1, isGroup: 1, updatedAt: -1 });

module.exports = mongoose.model(
    "Conversation",
    conversationSchema
);
