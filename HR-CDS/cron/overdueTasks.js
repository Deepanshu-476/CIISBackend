const cron = require('node-cron');
const Task = require('../models/Task');
const Notification = require('../models/Notification');
const User = require('../../models/User');
const moment = require('moment');

// Run every 30 minutes to check for overdue tasks
cron.schedule('*/30 * * * *', async () => {
  try {
    console.log('🔄 Running overdue tasks check...');
    
    const result = await Task.updateAllOverdueTasks();
    
    // Get all tasks that were marked overdue
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
    
    // Send notifications for newly overdue tasks
    let notificationsSent = 0;
    for (const task of newlyOverdueTasks) {
      for (const userId of task.assignedUsers) {
        try {
          await Notification.create({
            user: userId._id,
            title: 'Task Marked as Overdue',
            message: `Task "${task.title}" has been automatically marked as overdue.`,
            type: 'task_overdue',
            relatedTask: task._id,
            metadata: {
              dueDate: task.dueDateTime,
              taskTitle: task.title,
              markedAt: new Date()
            }
          });
          
          notificationsSent++;
          
          // Mark as notified
          await Task.findByIdAndUpdate(task._id, { overdueNotified: true });
          
        } catch (notifyError) {
          console.error(`Error creating notification for user ${userId._id}:`, notifyError);
        }
      }
    }
    
    console.log(`✅ Overdue tasks check completed:
      • Updated: ${result.updated}
      • Already Overdue: ${result.alreadyOverdue}
      • Skipped: ${result.skipped}
      • Total Checked: ${result.total}
      • Notifications Sent: ${notificationsSent}`);
      
  } catch (error) {
    console.error('❌ Error in overdue tasks cron job:', error);
  }
});

// Optional: Daily summary at 9 AM
cron.schedule('0 9 * * *', async () => {
  try {
    console.log('📊 Running daily overdue summary...');
    
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
      console.log(`📊 Daily Overdue Summary (${yesterday.toDateString()}):
        • New Overdue Tasks: ${overdueTasks.length}
        • Tasks: ${overdueTasks.map(t => t.title).join(', ')}`);
    }
    
  } catch (error) {
    console.error('❌ Error in daily summary cron job:', error);
  }
});

module.exports = cron;