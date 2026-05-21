const express = require("express");

const router = express.Router();

const {
    createConversation,
    createGroupConversation,
<<<<<<< HEAD
=======
    getConversations,
    getConversation,
>>>>>>> c90a0774f0eba0543411d3f8ac3340a510b9b9af
    sendMessage,
    getMessages,
    getCompanyUsers,
    getCompanyGroups
} = require("../controllers/chatController");

const authMiddleware =
require("../../middlewares/auth");
const upload = require("../../../utils/multer");

const upload =
require(
    "../middleware/upload"
);


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

// CREATE OR OPEN GROUP CONVERSATION
router.post(
    "/conversation/group",
    authMiddleware,
    createGroupConversation
);

// GET USER GROUPS
router.get(
    "/groups",
    authMiddleware,
    getCompanyGroups
);

// CREATE GROUP CONVERSATION
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
