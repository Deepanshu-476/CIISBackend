const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../../../models/User");
const Group = require("../../models/Group");


// CREATE CONVERSATION
exports.createConversation = async (req, res) => {

    try {

        const { receiverId } = req.body;

        // FIND RECEIVER
        const receiver = await User.findById(receiverId);

        if (!receiver) {
            return res.status(404).json({
                success: false,
                message: "Receiver not found"
            });
        }

        // COMPANY SECURITY CHECK
        if (
            receiver.company.toString() !==
            req.user.company.toString()
        ) {
            return res.status(403).json({
                success: false,
                message: "Cross company chat not allowed"
            });
        }

        // FIND EXISTING CONVERSATION
        let conversation = await Conversation.findOne({
            companyId: req.user.company,
            members: {
                $all: [req.user.id, receiverId]
            }
        });

        // CREATE NEW IF NOT EXISTS
        if (!conversation) {

            conversation = await Conversation.create({

                companyId: req.user.company,

                members: [
                    req.user.id,
                    receiverId
                ]
            });
        }

        res.status(200).json({
            success: true,
            conversation
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};


// CREATE GROUP CONVERSATION
exports.createGroupConversation = async (req, res) => {
    try {
        const { groupId } = req.body;

        const group = await Group.findById(groupId);

        if (!group || !group.isActive) {
            return res.status(404).json({
                success: false,
                message: "Group not found"
            });
        }

        const isMember = group.members.some(
            (member) => member.toString() === req.user.id
        );

        if (!isMember) {
            return res.status(403).json({
                success: false,
                message: "You are not a member of this group"
            });
        }

        let conversation = await Conversation.findOne({
            companyId: req.user.company,
            groupId
        });

        if (!conversation) {
            conversation = await Conversation.create({
                companyId: req.user.company,
                groupId,
                members: group.members,
                isGroup: true,
                groupName: group.name,
                admins: [group.createdBy]
            });
        } else {
            let needsUpdate = false;

            const currentMemberIds = group.members.map((member) => member.toString());
            const conversationMemberIds = conversation.members.map((member) => member.toString());

            if (currentMemberIds.length !== conversationMemberIds.length ||
                !currentMemberIds.every((memberId) => conversationMemberIds.includes(memberId))) {
                conversation.members = group.members;
                needsUpdate = true;
            }

            if (conversation.groupName !== group.name) {
                conversation.groupName = group.name;
                needsUpdate = true;
            }

            if (!conversation.admins || !conversation.admins.length) {
                conversation.admins = [group.createdBy];
                needsUpdate = true;
            }

            if (needsUpdate) {
                await conversation.save();
            }
        }

        res.status(200).json({
            success: true,
            conversation
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};


// GET ALL CONVERSATIONS
exports.getConversations = async (req, res) => {
    try {
        const conversations = await Conversation.find({
            companyId: req.user.company,
            members: req.user.id
        })
        .populate("members", "name email profileImage companyRole")
        .populate("admins", "name email profileImage")
        .sort({ updatedAt: -1 });

        res.status(200).json({
            success: true,
            conversations
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};


// GET A SINGLE CONVERSATION
exports.getConversation = async (req, res) => {
    try {
        const conversation = await Conversation.findOne({
            _id: req.params.id,
            companyId: req.user.company,
            members: req.user.id
        })
        .populate("members", "name email profileImage companyRole")
        .populate("admins", "name email profileImage");

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: "Conversation not found"
            });
        }

        res.status(200).json({
            success: true,
            conversation
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};


// GET COMPANY GROUPS
exports.getCompanyGroups = async (req, res) => {
    try {
        const groups = await Group.find({
            members: req.user.id,
            isActive: true
        })
        .select("name description members createdBy")
        .populate("createdBy", "name email profileImage");

        res.status(200).json({
            success: true,
            groups
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};


// SEND MESSAGE
exports.sendMessage = async (req, res) => {

    try {

        const {
            conversationId,
            text
        } = req.body;

        const conversation = await Conversation.findOne({
            _id: conversationId,
            companyId: req.user.company
        });

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: "Conversation not found"
            });
        }

        const isMember = conversation.members.some(
            (member) => member.toString() === req.user.id
        );

        if (!isMember) {
            return res.status(403).json({
                success: false,
                message: "You are not a member of this conversation"
            });
        }

        let file = "";
        let fileType = "";

        if (req.file) {
            file = `/uploads/chat/${req.file.filename}`;
            fileType = req.file.mimetype;
        }

        const message = await Message.create({
            companyId: req.user.company,
            conversationId,
            sender: req.user.id,
            text,
            file,
            fileType,
            seenBy: [req.user.id]
        });

        const populatedMessage = await Message.findById(message._id)
            .populate("sender", "name email profileImage");

        if (global.io) {
            const room = `conversation:${conversationId}`;
            global.io.to(room).emit("chat:receive-message", populatedMessage);
            global.io.to(room).emit("chat:unread-update", {
                senderId: req.user.id,
                conversationId
            });
        }

        res.status(201).json({
            success: true,
            message: populatedMessage
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};


// GET CONVERSATION MESSAGES
exports.getMessages = async (req, res) => {

    try {

        const conversation = await Conversation.findOne({
            _id: req.params.id,
            companyId: req.user.company,
            members: req.user.id
        });

        if (!conversation) {
            return res.status(404).json({
                success: false,
                message: "Conversation not found"
            });
        }

        const messages = await Message.find({
            conversationId: req.params.id,
            companyId: req.user.company
        })
        .populate("sender", "name email profileImage")
        .sort({ createdAt: 1 });

        res.status(200).json({
            success: true,
            messages
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};


// GET COMPANY USERS
exports.getCompanyUsers = async (req, res) => {

    try {

        const users = await User.find({

            company: req.user.company,

            _id: {
                $ne: req.user.id
            }

        }).select(
            "name email profileImage companyRole"
        );

        res.status(200).json({
            success: true,
            users
        });

    } catch (error) {

        console.log(error);

        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};
