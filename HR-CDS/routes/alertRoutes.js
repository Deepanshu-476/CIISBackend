const express = require("express");
const router = express.Router();
const alertController = require("../controllers/alertController");
const auth = require("../../middleware/authMiddleware");
const isAdmin = require("../../middleware/isAdmin");
const isHR = require("../../middleware/isHR");
const isManager = require("../../middleware/isManager");

// Middleware to check if user can manage alerts
const canManageAlerts = (req, res, next) => {
  const role = req.user?.role?.toLowerCase();
  if (['admin', 'hr', 'manager'].includes(role)) {
    return next();
  }
  return res.status(403).json({
    success: false,
    message: 'Not authorized to manage alerts'
  });
};

// Public routes (but require auth)
router.get("/", auth, alertController.getAlerts);
router.get("/unread/count", auth, alertController.getUnreadCount);
router.patch("/:id/read", auth, alertController.markAsRead);

// Protected routes (admin/hr/manager only)
router.post("/", auth, canManageAlerts, alertController.addAlert);
router.put("/:id", auth, canManageAlerts, alertController.updateAlert);
router.delete("/:id", auth, canManageAlerts, alertController.deleteAlert);

module.exports = router;