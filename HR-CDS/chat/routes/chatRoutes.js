const express = require("express");
const router = express.Router();

const {
    createConversation,
    createGroupConversation,
    sendMessage,
    getMessages,
    getCompanyUsers,
    getCompanyGroups,
    getConversations,  // Added missing import
    getConversation    // Added missing import
} = require("../controllers/chatController");

const authMiddleware = require("../../middlewares/auth");

// Fixed: Removed duplicate upload import and used correct path
const upload = require("../../../utils/multer");

// USERS
router.get(
    "/users",
    authMiddleware,
    getCompanyUsers
);

// GET ALL CONVERSATIONS
router.get(
    "/conversations",
    authMiddleware,
    getConversations
);

// GET A SINGLE CONVERSATION
router.get(
    "/conversation/:id",
    authMiddleware,
    getConversation
);

// CREATE PRIVATE CONVERSATION
router.post(
    "/conversation",
    authMiddleware,
    createConversation
);

// GET USER GROUPS
router.get(
    "/groups",
    authMiddleware,
    getCompanyGroups
);

// CREATE GROUP CONVERSATION (Removed duplicate route - keeping one)
router.post(
    "/conversation/group",
    authMiddleware,
    createGroupConversation
);

// SEND MESSAGE
router.post(
    "/message",
    authMiddleware,
    upload.single("file"),
    sendMessage
);

// GET MESSAGES
router.get(
    "/messages/:id",
    authMiddleware,
    getMessages
);

// TEST
router.get("/test", (req, res) => {
    res.json({
        success: true,
        message: "Chat API Working"
    });
});

module.exports = router;