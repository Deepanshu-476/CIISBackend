// socket/handlers/notificationHandlers.js

// Socket events for notifications
const notificationHandlers = (io, socket) => {
  
  // Mark notification as read
  socket.on('notification:markRead', async (notificationId, callback) => {
    try {
      const Notification = require('../../HR-CDS/models/Notification');
      
      await Notification.findOneAndUpdate(
        { _id: notificationId, recipient: socket.userId },
        { isRead: true }
      );
      
      // Get updated unread count
      const unreadCount = await Notification.countDocuments({
        recipient: socket.userId,
        isRead: false
      });
      
      // Emit to user's room
      io.to(`user:${socket.userId}`).emit('notification:unread_count', unreadCount);
      
      if (callback && typeof callback === 'function') {
        callback({ success: true });
      }
    } catch (error) {
      console.error('Error marking notification as read:', error);
      if (callback && typeof callback === 'function') {
        callback({ success: false, error: error.message });
      }
    }
  });

  // Mark all notifications as read
  socket.on('notification:markAllRead', async (callback) => {
    try {
      const Notification = require('../../HR-CDS/models/Notification');
      
      await Notification.updateMany(
        { recipient: socket.userId, isRead: false },
        { isRead: true }
      );
      
      io.to(`user:${socket.userId}`).emit('notification:unread_count', 0);
      
      if (callback && typeof callback === 'function') {
        callback({ success: true });
      }
    } catch (error) {
      console.error('Error marking all as read:', error);
      if (callback && typeof callback === 'function') {
        callback({ success: false, error: error.message });
      }
    }
  });

  // Get unread count
  socket.on('notification:getUnreadCount', async (callback) => {
    try {
      const Notification = require('../../HR-CDS/models/Notification');
      
      const count = await Notification.countDocuments({
        recipient: socket.userId,
        isRead: false
      });
      
      if (callback && typeof callback === 'function') {
        callback({ success: true, count });
      }
    } catch (error) {
      console.error('Error getting unread count:', error);
      if (callback && typeof callback === 'function') {
        callback({ success: false, error: error.message });
      }
    }
  });
};

module.exports = notificationHandlers;