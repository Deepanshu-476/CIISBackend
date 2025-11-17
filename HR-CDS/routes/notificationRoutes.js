const express = require("express");
const router = express.Router();

const auth = require("../../middleware/authMiddleware");

// Import the controller
const notificationController = require("../controllers/notificationController");

// Debug: Check if functions exist
console.log("🔍 Checking notification controller functions:");
console.log("getAllNotifications:", typeof notificationController.getAllNotifications);
console.log("getNotifications:", typeof notificationController.getNotifications);
console.log("markAsRead:", typeof notificationController.markAsRead);
console.log("markAllAsRead:", typeof notificationController.markAllAsRead);
console.log("createNotification:", typeof notificationController.createNotification);
console.log("deleteOldNotifications:", typeof notificationController.deleteOldNotifications);

// Apply auth middleware to all routes
router.use(auth);

// Define routes - only if the function exists
if (typeof notificationController.getNotifications === 'function') {
  router.get("/", notificationController.getNotifications);
} else {
  console.error("❌ getNotifications is not a function");
}

if (typeof notificationController.getAllNotifications === 'function') {
  router.get("/all", notificationController.getAllNotifications);
} else {
  console.error("❌ getAllNotifications is not a function");
}

if (typeof notificationController.markAsRead === 'function') {
  router.put("/mark-read/:id", notificationController.markAsRead);
} else {
  console.error("❌ markAsRead is not a function");
}

if (typeof notificationController.markAllAsRead === 'function') {
  router.patch("/read-all", notificationController.markAllAsRead);
} else {
  console.error("❌ markAllAsRead is not a function");
}

if (typeof notificationController.createNotification === 'function') {
  router.post("/test", notificationController.createNotification);
} else {
  console.error("❌ createNotification is not a function");
}

if (typeof notificationController.deleteOldNotifications === 'function') {
  router.delete("/cleanup", notificationController.deleteOldNotifications);
} else {
  console.error("❌ deleteOldNotifications is not a function");
}

module.exports = router;