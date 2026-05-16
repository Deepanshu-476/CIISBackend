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

    file: {
        type: String,
        default: ""
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