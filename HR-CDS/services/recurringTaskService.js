const Task = require('../models/Task');
const moment = require('moment');

class RecurringTaskService {
  // Generate recurring tasks
  async generateRecurringTasks() {
    try {
      console.log('🔁 [Service-1] generateRecurringTasks called');
      
      const now = new Date();
      console.log('🔁 [Service-2] Current time:', now);
      
      // Find recurring tasks whose nextOccurrence is due
      console.log('🔁 [Service-3] Finding due recurring tasks...');
      const dueRecurringTasks = await Task.find({
        isRecurring: true,
        nextOccurrence: { 
          $lte: now,
          $ne: null 
        },
        $or: [
          { recurrenceEndDate: { $exists: false } },
          { recurrenceEndDate: null },
          { recurrenceEndDate: { $gte: now } }
        ]
      })
      .populate('assignedUsers', 'name email')
      .populate('assignedGroups', 'name description members')
      .populate('createdBy', 'name email');

      console.log(`📋 [Service-4] Found ${dueRecurringTasks.length} recurring tasks due for generation`);

      // Log all found tasks for debugging
      dueRecurringTasks.forEach((task, index) => {
        console.log(`📝 [Service-5] Task ${index + 1}:`, {
          id: task._id,
          title: task.title,
          nextOccurrence: task.nextOccurrence,
          repeatPattern: task.repeatPattern,
          repeatDays: task.repeatDays
        });
      });

      let generatedCount = 0;

      for (const task of dueRecurringTasks) {
        try {
          console.log(`🔄 [Service-6] Processing task: ${task.title}`);
          const newTask = await this.generateNextTask(task);
          if (newTask) {
            generatedCount++;
            console.log(`✅ [Service-7] Generated recurring task: ${newTask.title} for ${newTask.dueDateTime}`);
          } else {
            console.log(`⚠️ [Service-8] No task generated for: ${task.title}`);
          }
        } catch (error) {
          console.error(`❌ [Service-9] Error generating task from ${task.title}:`, error);
          console.error(`❌ [Service-10] Error details:`, error.message);
        }
      }

      console.log(`🎉 [Service-11] Successfully generated ${generatedCount} recurring tasks`);
      return generatedCount;

    } catch (error) {
      console.error('💥 [Service-12] ERROR in generateRecurringTasks:', error);
      console.error('💥 [Service-13] Error message:', error.message);
      console.error('💥 [Service-14] Error stack:', error.stack);
      throw error;
    }
  }

  // Generate next occurrence task
  async generateNextTask(parentTask) {
    try {
      console.log(`🔄 [NextTask-1] generateNextTask called for: ${parentTask.title}`);
      console.log(`🔄 [NextTask-2] Parent task nextOccurrence:`, parentTask.nextOccurrence);

      if (!parentTask.nextOccurrence) {
        console.log(`⏭️ [NextTask-3] No next occurrence for task: ${parentTask.title}`);
        return null;
      }

      // Calculate the next occurrence after the current one
      console.log(`🔄 [NextTask-4] Calculating next occurrence...`);
      const nextOccurrence = this.calculateNextOccurrence(
        parentTask.nextOccurrence,
        parentTask.repeatPattern,
        parentTask.repeatDays
      );

      console.log(`🔄 [NextTask-5] Calculated nextOccurrence:`, nextOccurrence);

      if (!nextOccurrence) {
        console.log(`❌ [NextTask-6] Could not calculate next occurrence for: ${parentTask.title}`);
        return null;
      }

      // Create new task data
      console.log(`🔄 [NextTask-7] Creating new task data...`);
      const newTaskData = {
        title: parentTask.title,
        description: parentTask.description,
        dueDateTime: parentTask.nextOccurrence, // Use the calculated next occurrence
        assignedUsers: parentTask.assignedUsers.map(user => user._id),
        assignedGroups: parentTask.assignedGroups.map(group => group._id),
        createdBy: parentTask.createdBy._id,
        priority: parentTask.priority,
        priorityDays: parentTask.priorityDays,
        whatsappNumber: parentTask.whatsappNumber,
        repeatPattern: parentTask.repeatPattern,
        repeatDays: parentTask.repeatDays,
        isRecurring: true,
        parentTask: parentTask._id,
        files: parentTask.files.map(file => ({
          filename: file.filename,
          originalName: file.originalName,
          path: file.path
        })),
        statusByUser: parentTask.assignedUsers.map(userId => ({
          user: userId,
          status: 'pending',
          updatedAt: new Date()
        })),
        overallStatus: 'pending'
      };

      console.log(`🔄 [NextTask-8] New task data created, saving...`);

      // Create the new task
      const newTask = new Task(newTaskData);
      await newTask.save();

      console.log(`✅ [NextTask-9] New task saved with ID:`, newTask._id);

      // Update parent task's next occurrence
      console.log(`🔄 [NextTask-10] Updating parent task nextOccurrence...`);
      parentTask.nextOccurrence = nextOccurrence;
      parentTask.recurrenceCount = (parentTask.recurrenceCount || 0) + 1;
      await parentTask.save();

      console.log(`🔄 [NextTask-11] Parent task updated - next occurrence: ${nextOccurrence}`);

      return newTask;

    } catch (error) {
      console.error('💥 [NextTask-12] ERROR in generateNextTask:', error);
      console.error('💥 [NextTask-13] Error message:', error.message);
      console.error('💥 [NextTask-14] Error stack:', error.stack);
      throw error;
    }
  }

  // Calculate next occurrence
  calculateNextOccurrence(dueDateTime, repeatPattern, repeatDays = []) {
    console.log(`🔄 [Calc-1] calculateNextOccurrence called`);
    console.log(`🔄 [Calc-2] Inputs - dueDateTime: ${dueDateTime}, repeatPattern: ${repeatPattern}, repeatDays:`, repeatDays);
    
    if (!dueDateTime || repeatPattern === 'none') {
      console.log(`❌ [Calc-3] Invalid inputs - returning null`);
      return null;
    }

    let nextDate = new Date(dueDateTime);
    console.log(`🔄 [Calc-4] Starting date:`, nextDate);
    
    switch (repeatPattern) {
      case 'daily':
        nextDate.setDate(nextDate.getDate() + 1);
        console.log(`🔄 [Calc-5] Daily pattern - next date:`, nextDate);
        break;
      
      case 'weekly':
        if (repeatDays && repeatDays.length > 0) {
          console.log(`🔄 [Calc-6] Weekly pattern with specific days:`, repeatDays);
          const currentDay = nextDate.getDay();
          const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
          const currentDayName = dayNames[currentDay];
          console.log(`🔄 [Calc-7] Current day: ${currentDayName} (${currentDay})`);
          
          let nextDayIndex = 0;
          let found = false;
          
          // Look for the next day in the same week
          for (let i = currentDay + 1; i < 7; i++) {
            if (repeatDays.includes(dayNames[i])) {
              nextDayIndex = i;
              found = true;
              console.log(`🔄 [Calc-8] Found next day: ${dayNames[i]} (${i})`);
              break;
            }
          }
          
          // If not found in same week, take first day of next week
          if (!found && repeatDays.length > 0) {
            nextDayIndex = dayNames.indexOf(repeatDays[0]);
            console.log(`🔄 [Calc-9] No day found in same week, taking first day: ${repeatDays[0]} (${nextDayIndex})`);
          }
          
          let daysToAdd = nextDayIndex - currentDay;
          if (daysToAdd <= 0) {
            daysToAdd += 7;
          }
          console.log(`🔄 [Calc-10] Days to add: ${daysToAdd}`);
          
          nextDate.setDate(nextDate.getDate() + daysToAdd);
        } else {
          console.log(`🔄 [Calc-11] Weekly pattern without specific days - adding 7 days`);
          nextDate.setDate(nextDate.getDate() + 7);
        }
        console.log(`🔄 [Calc-12] Weekly pattern - next date:`, nextDate);
        break;
      
      case 'monthly':
        nextDate.setMonth(nextDate.getMonth() + 1);
        console.log(`🔄 [Calc-13] Monthly pattern - next date:`, nextDate);
        break;
      
      default:
        console.log(`❌ [Calc-14] Unknown pattern: ${repeatPattern} - returning null`);
        return null;
    }
    
    console.log(`✅ [Calc-15] Final calculated next occurrence:`, nextDate);
    return nextDate;
  }
}

module.exports = new RecurringTaskService();