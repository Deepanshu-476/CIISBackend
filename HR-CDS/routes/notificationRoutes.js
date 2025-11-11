const express = require("express");
const router = express.Router();

const auth = require("../../middleware/authMiddleware");

const {
  getNotifications,
  markAsRead,
  createNotification,
} = require("../controllers/notificationController");

// ✅ Now log AFTER imports
console.log("🔍 Controllers:", { getNotifications, markAsRead, createNotification });
console.log("🔍 Auth Middleware:", auth);

router.get("/", auth, getNotifications);
router.put("/mark-read/:id", auth, markAsRead);
router.post("/test", auth, createNotification);

module.exports = router;
