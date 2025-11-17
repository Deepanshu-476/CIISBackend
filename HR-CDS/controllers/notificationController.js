const Notification = require("../models/notificationModel");

/**
 * ✅ Fetch ALL notifications for the logged-in user
 */
const getAllNotifications = async (req, res) => {
  try {
    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: No user found in token",
      });
    }

    // ✅ Fetch ALL notifications for the user
    const notifications = await Notification.find({
      user: userId,
    })
      .sort({ createdAt: -1 })
      .limit(100);

    // ✅ Count unread notifications
    const unreadCount = await Notification.countDocuments({
      user: userId,
      isRead: false
    });

    return res.status(200).json({
      success: true,
      count: notifications.length,
      unreadCount: unreadCount,
      notifications: notifications,
    });
  } catch (error) {
    console.error("❌ Error fetching all notifications:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching notifications",
    });
  }
};

/**
 * ✅ Fetch today's notifications for the logged-in user
 */
const getNotifications = async (req, res) => {
  try {
    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: No user found in token",
      });
    }

    // ✅ Get today's start & end time
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0));
    const endOfDay = new Date(today.setHours(23, 59, 59, 999));

    // ✅ Fetch only today's notifications
    const notifications = await Notification.find({
      user: userId,
      createdAt: { $gte: startOfDay, $lte: endOfDay },
    })
      .sort({ createdAt: -1 })
      .limit(50);

    return res.status(200).json({
      success: true,
      count: notifications.length,
      data: notifications,
    });
  } catch (error) {
    console.error("❌ Error fetching notifications:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching notifications",
    });
  }
};

/**
 * ✅ Mark a specific notification as read
 */
const markAsRead = async (req, res) => {
  try {
    const notificationId = req.params.id;

    if (!notificationId) {
      return res
        .status(400)
        .json({ success: false, message: "Notification ID required" });
    }

    const notification = await Notification.findById(notificationId);
    if (!notification) {
      return res
        .status(404)
        .json({ success: false, message: "Notification not found" });
    }

    notification.isRead = true;
    notification.readAt = new Date();
    await notification.save();

    return res.status(200).json({
      success: true,
      message: "Notification marked as read",
      data: notification,
    });
  } catch (error) {
    console.error("❌ Error marking notification as read:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while marking as read",
    });
  }
};

/**
 * ✅ Mark all unread notifications as read for logged-in user
 */
const markAllAsRead = async (req, res) => {
  try {
    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: No user found in token",
      });
    }

    const result = await Notification.updateMany(
      { user: userId, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    return res.status(200).json({
      success: true,
      message: `Marked ${result.modifiedCount} notifications as read`,
    });
  } catch (error) {
    console.error("❌ Error marking all notifications as read:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while marking all as read",
    });
  }
};

/**
 * ✅ Create new notification (for manual testing or system triggers)
 */
const createNotification = async (req, res) => {
  try {
    const { user, title, message, type } = req.body;

    if (!user || !title || !message) {
      return res.status(400).json({
        success: false,
        message: "Fields 'user', 'title', and 'message' are required",
      });
    }

    const newNotification = await Notification.create({
      user,
      title,
      message,
      type: type || "system",
      isRead: false,
    });

    return res.status(201).json({
      success: true,
      message: "Notification created successfully",
      data: newNotification,
    });
  } catch (error) {
    console.error("❌ Error creating notification:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while creating notification",
    });
  }
};

/**
 * ✅ Optional: Delete old notifications (maintenance cleanup)
 */
const deleteOldNotifications = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30; // default 30 days
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const result = await Notification.deleteMany({ createdAt: { $lt: cutoff } });

    return res.status(200).json({
      success: true,
      message: `Deleted ${result.deletedCount} notifications older than ${days} days.`,
    });
  } catch (error) {
    console.error("❌ Error deleting old notifications:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while deleting old notifications",
    });
  }
};

// ✅ Make sure ALL exports are included
module.exports = {
  getAllNotifications,
  getNotifications,
  markAsRead,
  markAllAsRead,
  createNotification,
  deleteOldNotifications
};