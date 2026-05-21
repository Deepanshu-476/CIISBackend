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

        const group = await Group.findOne({
            _id: groupId,
            isActive: true
        });

        if (!group) {
            return res.status(404).json({
                success: false,
                message: "Group not found"
            });
        }

        const memberIds = (group.members || []).map((member) =>
            member.toString()
        );

        if (
            group.createdBy.toString() !== req.user.id.toString() &&
            !memberIds.includes(req.user.id.toString())
        ) {
            return res.status(403).json({
                success: false,
                message: "You are not a member of this group"
            });
        }

        const members = Array.from(new Set([
            group.createdBy.toString(),
            ...memberIds
        ]));

        let conversation = await Conversation.findOne({
            companyId: req.user.company,
            isGroup: true,
            groupId
        });

        if (!conversation) {
            conversation = await Conversation.create({
                companyId: req.user.company,
                members,
                isGroup: true,
                groupId,
                groupName: group.name,
                admins: [group.createdBy]
            });
        } else {
            conversation.members = members;
            conversation.groupName = group.name;
            await conversation.save();
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


// SEND MESSAGE
exports.sendMessage = async (req, res) => {

    try {

        const {
            conversationId,
            text
        } = req.body;

        const message = await Message.create({

            companyId: req.user.company,

            conversationId,

            sender: req.user.id,

            text,

            file: req.file ? `/api/uploads/tasks/${req.file.filename}` : "",

            seenBy: [req.user.id]
        });

        const populatedMessage =
            await Message.findById(message._id)
            .populate("sender", "name email profileImage");

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
