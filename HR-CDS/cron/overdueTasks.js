const cron = require('node-cron');
const Task = require('../models/Task');
const User = require('../../models/User');
const moment = require('moment');
const {notifyDirectUsers} = require('../utils/systemNotificationService');


cron.schedule('*/30 * * * *', async () => {
  try {
    void 0;
    
    const result = await Task.updateAllOverdueTasks();
    
    
    const now = new Date();
    const thirtyMinutesAgo = new Date(now.getTime() - (30 * 60 * 1000));
    
    const newlyOverdueTasks = await Task.find({
      markedOverdueAt: { $gte: thirtyMinutesAgo, $lte: now },
      isActive: true,
      overdueNotified: { $ne: true }
    })
    .populate('assignedUsers', 'name email')
    .populate('createdBy', 'name email')
    .lean();
    
    
    let notificationsSent = 0;
    for (const task of newlyOverdueTasks) {
      for (const userId of task.assignedUsers) {
        try {
          await notifyDirectUsers({
            userIds: [userId._id],
            targetPath: '/ciisUser/task-management',
            title: 'Task Marked as Overdue',
            message: `Task "${task.title}" has been automatically marked as overdue.`,
            type: 'task_overdue',
            data: {
              taskId: task._id,
              dueDate: task.dueDateTime,
              taskTitle: task.title,
              markedAt: new Date()
            },
            priority: 'high',
          });
          
          notificationsSent++;
          
          
          await Task.findByIdAndUpdate(task._id, { overdueNotified: true });
          
        } catch (notifyError) {
          console.error(`Error creating notification for user ${userId._id}:`, notifyError);
        }
      }
    }
    
    void 0;
      
  } catch (error) {
    console.error('❌ Error in overdue tasks cron job:', error);
  }
});


cron.schedule('0 9 * * *', async () => {
  try {
    void 0;
    
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const overdueTasks = await Task.find({
      markedOverdueAt: { $gte: yesterday, $lt: today },
      isActive: true
    })
    .populate('assignedUsers', 'name email')
    .lean();
    
    if (overdueTasks.length > 0) {
      void 0;
    }
    
  } catch (error) {
    console.error('❌ Error in daily summary cron job:', error);
  }
});

module.exports = cron;
