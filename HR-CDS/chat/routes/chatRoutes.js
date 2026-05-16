const express = require("express");

const router = express.Router();

const {
    createConversation,
    sendMessage,
    getMessages,
    getCompanyUsers
} = require("../controllers/chatController");

const authMiddleware =
require("../../middlewares/auth");


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


// SEND MESSAGE
router.post(
    "/message",
    authMiddleware,
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