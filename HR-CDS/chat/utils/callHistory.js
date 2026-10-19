const mongoose = require("mongoose");
const ChatCall = require("../models/ChatCall");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");

const USER_FIELDS = "name email profileImage avatar image photo";

const toObjectId = value => (mongoose.isValidObjectId(value) ? new mongoose.Types.ObjectId(String(value)) : null);

// History is best-effort: a database hiccup must never break the live call.
const safely = (label, task) => Promise.resolve().then(task).catch(error => {
    console.error(`Call history ${label} failed:`, error?.message || error);
});

const recordCallStarted = room => safely("start", () => ChatCall.create({
    callId: room.callId,
    companyId: toObjectId(room.companyId),
    conversationId: toObjectId(room.conversationId),
    caller: room.hostUserId,
    participants: Array.from(room.participants.keys()).filter(id => id !== room.hostUserId),
    callType: room.callType,
    isGroupCall: Boolean(room.isGroupCall),
    title: room.title || "",
    startedAt: new Date(room.startedAt || Date.now()),
}));

const recordParticipantsAdded = (callId, userIds) => safely("add participants", () => ChatCall.updateOne(
    {callId},
    {$addToSet: {participants: {$each: userIds}}, $set: {isGroupCall: true}}
));

const recordCallAnswered = (callId, userId, answeredAt) => safely("answer", () => ChatCall.updateOne(
    {callId},
    {
        $addToSet: {answeredBy: userId},
        $set: {status: "ongoing"},
        $min: {answeredAt},
    }
));

const getFinalStatus = room => {
    if (room.answeredAt) return "completed";
    const invitees = Array.from(room.participants.entries()).filter(([id]) => id !== room.hostUserId);
    if (invitees.length && invitees.every(([, participant]) => participant.status === "rejected")) return "rejected";
    return "missed";
};

const postCallMessage = async (room, status, durationSeconds) => {
    const conversationId = toObjectId(room.conversationId);
    if (!conversationId) return;
    const conversation = await Conversation.findById(conversationId).select("companyId members isGroup groupId");
    if (!conversation) return;

    const message = await Message.create({
        companyId: conversation.companyId,
        conversationId,
        sender: room.hostUserId,
        messageType: "system",
        systemEvent: {type: "call", actor: room.hostUserId, mode: room.callType},
        call: {callId: room.callId, callType: room.callType, status, durationSeconds, caller: room.hostUserId},
        // A call entry is a log line, not a new message, so it must not raise unread badges.
        seenBy: conversation.members,
    });

    conversation.updatedAt = message.createdAt || new Date();
    await conversation.save();

    const populated = await Message.findById(message._id)
        .populate("sender", USER_FIELDS)
        .populate("systemEvent.actor", USER_FIELDS);

    if (!global.io) return;
    conversation.members.forEach(memberId => {
        const room = `user:${memberId}`;
        global.io.to(room).emit("chat:receive-message", populated);
        global.io.to(room).emit("chat:conversation-updated", {
            conversationId: conversation._id,
            lastMessage: populated,
            updatedAt: conversation.updatedAt,
            isGroup: conversation.isGroup,
            groupId: conversation.groupId,
        });
    });
};

const recordCallFinished = room => {
    if (!room || room.historyFinalized) return Promise.resolve();
    room.historyFinalized = true;
    const endedAt = new Date();
    const status = getFinalStatus(room);
    const durationSeconds = room.answeredAt
        ? Math.max(0, Math.round((endedAt.getTime() - room.answeredAt) / 1000))
        : 0;

    return safely("finish", async () => {
        await ChatCall.updateOne({callId: room.callId}, {$set: {status, endedAt, durationSeconds}});
        await postCallMessage(room, status, durationSeconds);
    });
};

const getCallHistory = async ({userId, companyId, limit = 50, before}) => {
    const userObjectId = toObjectId(userId);
    if (!userObjectId) return [];
    const query = {
        $or: [{caller: userObjectId}, {participants: userObjectId}],
        status: {$ne: "ringing"},
    };
    const companyObjectId = toObjectId(companyId);
    if (companyObjectId) query.companyId = companyObjectId;
    if (before && !Number.isNaN(new Date(before).getTime())) query.startedAt = {$lt: new Date(before)};

    return ChatCall.find(query)
        .sort({startedAt: -1})
        .limit(Math.min(Math.max(Number(limit) || 50, 1), 100))
        .populate("caller", USER_FIELDS)
        .populate("participants", USER_FIELDS)
        .lean();
};

module.exports = {
    recordCallStarted,
    recordParticipantsAdded,
    recordCallAnswered,
    recordCallFinished,
    getCallHistory,
};
