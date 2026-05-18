const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../../../models/User");



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