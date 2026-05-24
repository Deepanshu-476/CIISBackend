const User = require('../../models/User');
const {sendSystemNotification} = require('./systemNotificationService');

/**
 * Send notification to a user
 */
exports.sendNotification = async ({
  recipient,
  type,
  title,
  message,
  data = {},
  priority = 'medium',
  saveToDb = true
}) => {
  try {
    if (!recipient) {
      throw new Error('Recipient is required');
    }

    const notificationData = {
      recipients: [recipient],
      type,
      title,
      message,
      data,
      priority,
      targetPath: data?.targetPath || '',
    };

    // Save to database if required
    if (saveToDb) {
      const notifications = await sendSystemNotification(notificationData);
      return notifications[0] || null;
    }

    return {
      recipient,
      type,
      title,
      message,
      data,
      priority,
      isRead: false,
      createdAt: new Date(),
    };

  } catch (error) {
    console.error('❌ Error sending notification:', error);
    return null;
  }
};

/**
 * Send notification to all company owners/admins
 */
exports.notifyCompanyOwners = async ({
  companyId,
  type,
  title,
  message,
  data = {},
  excludeUser = null
}) => {
  try {
    // Find all owners and admins in the company
    const owners = await User.find({
      company: companyId,
      companyRole: { $in: ['Owner', 'Admin'] },
      _id: { $ne: excludeUser },
      isActive: true
    }).select('_id');

    const notifications = [];
    
    for (const owner of owners) {
      const notification = await exports.sendNotification({
        recipient: owner._id,
        type,
        title,
        message,
        data,
        priority: 'high'
      });
      
      if (notification) {
        notifications.push(notification);
      }
    }

    return notifications;

  } catch (error) {
    console.error('❌ Error notifying company owners:', error);
    return [];
  }
};
