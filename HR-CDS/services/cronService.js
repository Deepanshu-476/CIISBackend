// services/cronService.js
const cron = require('node-cron');
const recurringTaskService = require('./recurringTaskService');

class CronService {
  init() {
    // Run every day at 2 AM to generate recurring tasks
    cron.schedule('0 2 * * *', async () => {
      console.log('Running recurring task generation...');
      await recurringTaskService.generateRecurringTasks();
    });

    console.log('Cron jobs initialized');
  }
}

module.exports = new CronService();