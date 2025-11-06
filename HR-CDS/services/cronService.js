const cron = require('node-cron');
const RecurringTaskService = require('./recurringTaskService');

class CronService {
  init() {
    // Run every day at 6:00 AM
    cron.schedule('0 6 * * *', async () => {
      console.log('🕒 Running daily recurring task check...');
      try {
        await RecurringTaskService.generateRecurringTasks();
      } catch (error) {
        console.error('❌ Error in daily recurring task check:', error);
      }
    });

    // Run every hour for testing (you can remove this in production)
    cron.schedule('0 * * * *', async () => {
      console.log('🕒 Running hourly recurring task check...');
      try {
        await RecurringTaskService.generateRecurringTasks();
      } catch (error) {
        console.error('❌ Error in hourly recurring task check:', error);
      }
    });

    console.log('✅ Cron jobs initialized');
  }
}

module.exports = new CronService();