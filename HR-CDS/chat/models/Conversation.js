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
    }]
},
{ timestamps: true }
);

module.exports = mongoose.model(
    "Conversation",
    conversationSchema
);