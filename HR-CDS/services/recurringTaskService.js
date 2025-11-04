// services/recurringTaskService.js
const Task = require('../models/Task');
const mongoose = require('mongoose');

class RecurringTaskService {
  // Generate recurring tasks (to be called by a cron job)
  async generateRecurringTasks() {
    try {
      const now = new Date();
      
      // Find tasks that need recurrence generation
      const recurringTasks = await Task.find({
        isRecurring: true,
        nextOccurrence: { $lte: now },
        $or: [
          { recurrenceEndDate: { $exists: false } },
          { recurrenceEndDate: { $gte: now } }
        ]
      }).populate('assignedUsers assignedGroups createdBy');

      for (const task of recurringTasks) {
        await this.generateNextOccurrence(task);
      }

      console.log(`Generated recurring tasks for ${recurringTasks.length} tasks`);
    } catch (error) {
      console.error('Error generating recurring tasks:', error);
    }
  }

  async generateNextOccurrence(parentTask) {
    const session = await mongoose.startSession();
    
    try {
      session.startTransaction();

      // Create new task instance based on parent
      const newTaskData = {
        title: parentTask.title,
        description: parentTask.description,
        dueDateTime: parentTask.nextOccurrence,
        assignedUsers: parentTask.assignedUsers,
        assignedGroups: parentTask.assignedGroups,
        createdBy: parentTask.createdBy,
        priority: parentTask.priority,
        priorityDays: parentTask.priorityDays,
        whatsappNumber: parentTask.whatsappNumber,
        repeatPattern: parentTask.repeatPattern,
        repeatDays: parentTask.repeatDays,
        isRecurring: true,
        parentTask: parentTask._id,
        files: parentTask.files.map(file => ({ ...file.toObject() })),
        voiceNote: parentTask.voiceNote ? { ...parentTask.voiceNote.toObject() } : null
      };

      // Calculate next occurrence
      newTaskData.nextOccurrence = this.calculateNextOccurrence(
        parentTask.nextOccurrence,
        parentTask.repeatPattern,
        parentTask.repeatDays
      );

      const newTask = new Task(newTaskData);
      await newTask.save({ session });

      // Update parent task's next occurrence
      parentTask.nextOccurrence = newTaskData.nextOccurrence;
      await parentTask.save({ session });

      await session.commitTransaction();
      
      return newTask;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  calculateNextOccurrence(dueDateTime, repeatPattern, repeatDays) {
    let nextDate = new Date(dueDateTime);
    
    switch (repeatPattern) {
      case 'daily':
        nextDate.setDate(nextDate.getDate() + 1);
        break;
      
      case 'weekly':
        if (repeatDays && repeatDays.length > 0) {
          const currentDay = nextDate.getDay();
          const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
          const currentDayName = dayNames[currentDay];
          
          let nextDayIndex = repeatDays.indexOf(currentDayName);
          if (nextDayIndex === repeatDays.length - 1) {
            nextDayIndex = 0;
          } else {
            nextDayIndex++;
          }
          
          const nextDayName = repeatDays[nextDayIndex];
          const targetDayIndex = dayNames.indexOf(nextDayName);
          let daysToAdd = targetDayIndex - currentDay;
          
          if (daysToAdd <= 0) {
            daysToAdd += 7;
          }
          
          nextDate.setDate(nextDate.getDate() + daysToAdd);
        } else {
          nextDate.setDate(nextDate.getDate() + 7);
        }
        break;
      
      case 'monthly':
        nextDate.setMonth(nextDate.getMonth() + 1);
        break;
      
      default:
        return null;
    }
    
    return nextDate;
  }
}

module.exports = new RecurringTaskService();