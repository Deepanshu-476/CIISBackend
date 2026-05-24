const express = require("express");
const router = express.Router();

const {
  createConversation,
  createGroupConversation,
  getConversations,
  getConversation,
  sendMessage,
  getMessages,
  getCompanyUsers,
  getCompanyGroups,
  deleteMessageForMe,
  deleteMessageForEveryone,
  forwardMessage,
  markMessageSeen,
} = require("../controllers/chatController");

const authMiddleware = require("../../middlewares/auth");
const upload = require("../middleware/upload");

router.get("/users", authMiddleware, getCompanyUsers);
router.get("/conversations", authMiddleware, getConversations);
router.get("/conversation/:id", authMiddleware, getConversation);
router.post("/conversation", authMiddleware, createConversation);
router.post("/conversation/group", authMiddleware, createGroupConversation);
router.get("/groups", authMiddleware, getCompanyGroups);
router.post("/message", authMiddleware, upload.single("file"), sendMessage);
router.get("/messages/:id", authMiddleware, getMessages);
router.patch("/message/:messageId/delete-for-me", authMiddleware, deleteMessageForMe);
router.patch("/message/:messageId/delete-for-everyone", authMiddleware, deleteMessageForEveryone);
router.post("/message/:messageId/forward", authMiddleware, forwardMessage);
router.patch("/message/:messageId/seen", authMiddleware, markMessageSeen);

router.get("/test", (req, res) => {
  res.json({success: true, message: "Chat API Working"});
});

module.exports = router;
