const Notification = require('../models/Notification');
const User = require('../../models/User');


exports.getMyNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 50, unreadOnly } = req.query;
    const isReadParam = req.query.isRead;

    const filter = { recipient: userId };
    if (unreadOnly === 'true' || unreadOnly === true || isReadParam === 'false' || isReadParam === false) {
      filter.isRead = false;
    } else if (isReadParam === 'true' || isReadParam === true) {
      filter.isRead = true;
    }

    const parsedLimit = Math.min(Math.max(1, parseInt(limit, 10) || 50), 200);
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const skip = (parsedPage - 1) * parsedLimit;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parsedLimit)
        .lean(),
      Notification.countDocuments(filter),
      Notification.countDocuments({ recipient: userId, isRead: false })
    ]);

    res.status(200).json({
      success: true,
      data: {
        notifications,
        pagination: {
          page: parsedPage,
          limit: parsedLimit,
          total,
          pages: Math.ceil(total / parsedLimit),
          unreadCount
        }
      }
    });

  } catch (error) {
    console.error('❌ Error fetching notifications:', error);
    res.status(500).json({
      success: false,
      error: 'Server error while fetching notifications'
    });
  }
};


exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const notification = await Notification.findOneAndUpdate(
      { _id: id, recipient: userId },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      data: notification
    });

    if (global.io) {
      const count = await Notification.countDocuments({recipient: userId, isRead: false});
      global.io.to(`user:${userId}`).emit('notification:unread_count', count);
      global.io.to(`user_${userId}`).emit('notification:unread_count', count);
    }

  } catch (error) {
    console.error('❌ Error marking notification as read:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};


exports.markAllAsRead = async (req, res) => {
  try {
    const userId = req.user._id;

    await Notification.updateMany(
      { recipient: userId, isRead: false },
      { isRead: true }
    );

    if (global.io) {
      global.io.to(`user:${userId}`).emit('notification:unread_count', 0);
      global.io.to(`user_${userId}`).emit('notification:unread_count', 0);
    }

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read'
    });

  } catch (error) {
    console.error('❌ Error marking all as read:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};


exports.deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const notification = await Notification.findOneAndDelete({
      _id: id,
      recipient: userId
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        error: 'Notification not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Notification deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting notification:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};


exports.getUnreadCount = async (req, res) => {
  try {
    const userId = req.user._id;

    const count = await Notification.countDocuments({
      recipient: userId,
      isRead: false
    });

    res.status(200).json({
      success: true,
      data: { unreadCount: count }
    });

  } catch (error) {
    console.error('❌ Error getting unread count:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
};
