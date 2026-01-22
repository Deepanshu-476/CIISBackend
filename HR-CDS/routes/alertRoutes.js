const express = require("express");
const router = express.Router();
const alertController = require("../controllers/alertController");

const { protect, authorize } = require('../../middleware/authMiddleware');


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
router.get("/", protect, alertController.getAlerts);
router.get("/unread/count", protect, alertController.getUnreadCount);
router.patch("/:id/read", protect, alertController.markAsRead);

// Protected routes (admin/hr/manager only)
router.post("/", protect, canManageAlerts, alertController.addAlert);
router.put("/:id", protect, canManageAlerts, alertController.updateAlert);
router.delete("/:id", protect , canManageAlerts, alertController.deleteAlert);

module.exports = router;