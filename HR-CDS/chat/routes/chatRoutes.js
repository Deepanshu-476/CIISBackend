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
  updateConversationMute,
  updateDisappearingMessages,
  updateMessageReaction,
} = require("../controllers/chatController");

const authMiddleware = require("../../middlewares/auth");
const upload = require("../middleware/upload");
const statusUpload = require("../middleware/statusUpload");
const {
  getStatuses,
  createStatus,
  markViewed,
  deleteStatus,
} = require("../controllers/statusController");

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
router.patch("/conversation/:id/mute", authMiddleware, updateConversationMute);
router.patch("/conversation/:id/disappearing-messages", authMiddleware, updateDisappearingMessages);
router.patch("/message/:messageId/reaction", authMiddleware, updateMessageReaction);
router.get("/statuses", authMiddleware, getStatuses);
router.post("/statuses", authMiddleware, statusUpload.single("file"), createStatus);
router.patch("/statuses/:statusId/view", authMiddleware, markViewed);
router.delete("/statuses/:statusId", authMiddleware, deleteStatus);

router.get("/turn-credentials", authMiddleware, async (_req, res) => {
  const apiKey = process.env.METERED_TURN_API_KEY;
  const appName = process.env.METERED_TURN_APP_NAME;

  if (!apiKey || !appName) {
    return res.status(503).json({
      success: false,
      message: "TURN server is not configured",
    });
  }

  try {
    const endpoint = new URL(
      `https://${appName}.metered.live/api/v1/turn/credentials`
    );
    endpoint.searchParams.set("apiKey", apiKey);

    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`TURN provider responded with ${response.status}`);
    }

    const iceServers = await response.json();

    if (!Array.isArray(iceServers) || iceServers.length === 0) {
      throw new Error("TURN provider returned no ICE servers");
    }

    return res.json(iceServers);
  } catch (error) {
    console.error("TURN credentials fetch failed:", error.message);
    return res.status(502).json({
      success: false,
      message: "Unable to fetch TURN credentials",
    });
  }
});

router.get("/test", (req, res) => {
  res.json({success: true, message: "Chat API Working"});
});

module.exports = router;
