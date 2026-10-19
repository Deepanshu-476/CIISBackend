const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");

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
const {getCallHistory} = require("../utils/callHistory");
const upload = require("../middleware/upload");
const statusUpload = require("../middleware/statusUpload");
const compressUploadedMedia = require("../middleware/compressMedia");
const {
  getStatuses,
  createStatus,
  markViewed,
  deleteStatus,
} = require("../controllers/statusController");

const uploadChatFile = (req, res, next) => {
  upload.single("file")(req, res, error => {
    if (!error) return next();
    return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      success: false,
      message: error.code === "LIMIT_FILE_SIZE" ? "Attachments must be 100 MB or smaller" : error.message,
    });
  });
};

const uploadStatusFile = (req, res, next) => {
  statusUpload.single("file")(req, res, error => {
    if (!error) return next();
    return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      success: false,
      message: error.code === "LIMIT_FILE_SIZE" ? "Status file is too large" : error.message,
    });
  });
};

const turnCredentialsLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many TURN credential requests" },
});

const splitList = (value = "") =>
  String(value)
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);

const getCoturnUrls = () => {
  const urls = splitList(process.env.COTURN_URLS || process.env.TURN_URLS);
  if (urls.length) return urls;

  const host = String(process.env.COTURN_HOST || process.env.TURN_HOST || "").trim();
  if (!host) return [];

  return [
    `stun:${host}:3478`,
    `turn:${host}:3478?transport=udp`,
    `turn:${host}:3478?transport=tcp`,
  ];
};

const createCoturnIceServers = () => {
  const secret = String(process.env.COTURN_STATIC_AUTH_SECRET || process.env.TURN_STATIC_AUTH_SECRET || "").trim();
  const urls = getCoturnUrls();
  if (!secret || !urls.length) return null;

  const ttlSeconds = Math.max(60, Number(process.env.COTURN_CREDENTIAL_TTL_SECONDS || 3600));
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const username = `${expiresAt}`;
  const credential = crypto
    .createHmac("sha1", secret)
    .update(username)
    .digest("base64");

  const stunUrls = urls.filter(url => /^stuns?:/i.test(url));
  const turnUrls = urls.filter(url => /^turns?:/i.test(url));

  return [
    ...(stunUrls.length ? [{ urls: stunUrls }] : []),
    ...(turnUrls.length ? [{ urls: turnUrls, username, credential }] : []),
  ];
};

router.get("/users", authMiddleware, getCompanyUsers);
router.get("/conversations", authMiddleware, getConversations);
router.get("/conversation/:id", authMiddleware, getConversation);
router.post("/conversation", authMiddleware, createConversation);
router.post("/conversation/group", authMiddleware, createGroupConversation);
router.get("/groups", authMiddleware, getCompanyGroups);
router.post("/message", authMiddleware, uploadChatFile, compressUploadedMedia, sendMessage);
router.get("/messages/:id", authMiddleware, getMessages);
router.patch("/message/:messageId/delete-for-me", authMiddleware, deleteMessageForMe);
router.patch("/message/:messageId/delete-for-everyone", authMiddleware, deleteMessageForEveryone);
router.post("/message/:messageId/forward", authMiddleware, forwardMessage);
router.patch("/message/:messageId/seen", authMiddleware, markMessageSeen);
router.patch("/conversation/:id/mute", authMiddleware, updateConversationMute);
router.patch("/conversation/:id/disappearing-messages", authMiddleware, updateDisappearingMessages);
router.patch("/message/:messageId/reaction", authMiddleware, updateMessageReaction);
router.get("/calls", authMiddleware, async (req, res) => {
  try {
    const calls = await getCallHistory({
      userId: req.user._id,
      companyId: req.user.company,
      limit: req.query.limit,
      before: req.query.before,
    });
    return res.json({success: true, calls});
  } catch (error) {
    console.error("Call history fetch failed:", error);
    return res.status(500).json({success: false, message: "Could not load call history"});
  }
});
router.get("/statuses", authMiddleware, getStatuses);
router.post("/statuses", authMiddleware, uploadStatusFile, compressUploadedMedia, createStatus);
router.patch("/statuses/:statusId/view", authMiddleware, markViewed);
router.delete("/statuses/:statusId", authMiddleware, deleteStatus);

router.get("/turn-credentials", authMiddleware, turnCredentialsLimiter, async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const coturnIceServers = createCoturnIceServers();
  if (!coturnIceServers || !coturnIceServers.length) {
    return res.status(503).json({
      success: false,
      message: "Self-hosted TURN server is not configured",
    });
  }

  return res.json(coturnIceServers);
});

router.get("/test", (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  res.json({success: true, message: "Chat API Working"});
});

module.exports = router;
