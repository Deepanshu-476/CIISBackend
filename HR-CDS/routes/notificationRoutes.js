// HR-CDS/routes/notificationRoutes.js
const express = require("express");
const router = express.Router();
const { protect, authorize } = require('../../middleware/authMiddleware');
const notificationController = require("../controllers/notificationController");

// ✅ Apply protect middleware to all routes
router.use(protect);

// ✅ Basic routes for all authenticated users
router.get("/", notificationController.getNotifications);
router.get("/all", notificationController.getAllNotifications);
router.put("/mark-read/:id", notificationController.markAsRead);
router.patch("/read-all", notificationController.markAllAsRead);

// ✅ Admin-only routes
router.post("/", authorize('admin', 'hr', 'manager', 'SuperAdmin'), notificationController.createNotification);
router.delete("/cleanup", authorize('admin', 'SuperAdmin'), notificationController.deleteOldNotifications);

module.exports = router;