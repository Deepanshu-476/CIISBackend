const express = require("express");

const router = express.Router();

const {
    createConversation,
    createGroupConversation,
    sendMessage,
    getMessages,
    getCompanyUsers
} = require("../controllers/chatController");

const authMiddleware =
require("../../middlewares/auth");
const upload = require("../../../utils/multer");


// USERS
router.get(
    "/users",
    authMiddleware,
    getCompanyUsers
);


// CREATE CONVERSATION
router.post(
    "/conversation",
    authMiddleware,
    createConversation
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
