const cron = require('node-cron');

const Client = require('../HR-CDS/models/Client');

const emailService = require('../services/emailService');

cron.schedule('0 9 * * *', async () => {

  try {

    console.log('🔔 Checking subscription expiry reminders...');

    const clients = await Client.find({
      subscription: { $exists: true, $ne: [] }
    });

    const today = new Date();

    for (const client of clients) {

      const latestSubscription =
        client.subscription[client.subscription.length - 1];

      if (!latestSubscription?.endDate) continue;

      const endDate = new Date(latestSubscription.endDate);

      const diffTime = endDate - today;

      const daysRemaining = Math.ceil(
        diffTime / (1000 * 60 * 60 * 24)
      );

      // ================= 5 DAYS =================

      if (
        daysRemaining === 5 &&
        !client.reminder5DaysSent
      ) {

        await emailService.sendEmail(

          client.email,

          'Subscription Expiring Soon',

          `
            <h2>Hello ${client.client}</h2>

            <p>Your subscription will expire in 5 days.</p>

            <p>Please renew your plan to continue services.</p>
          `
        );

        client.reminder5DaysSent = true;
      }

      // ================= 3 DAYS =================

      if (
        daysRemaining === 3 &&
        !client.reminder3DaysSent
      ) {

        await emailService.sendEmail(

          client.email,

          'Subscription Expiring Soon',

          `
            <h2>Hello ${client.client}</h2>

            <p>Your subscription will expire in 3 days.</p>

            <p>Please renew your plan to continue services.</p>
          `
        );

        client.reminder3DaysSent = true;
      }

      // ================= EXPIRED =================

      if (
        daysRemaining < 0 &&
        !client.expiredMailSent
      ) {

        await emailService.sendEmail(

          client.email,

          'Subscription Expired',

          `
            <h2>Hello ${client.client}</h2>

            <p>Your subscription has expired.</p>

            <p>Please renew your plan immediately.</p>
          `
        );

        latestSubscription.status = 'Expired';

        client.expiredMailSent = true;
      }

      await client.save();

    }

    console.log('✅ Subscription reminder cron completed');

  } catch (error) {

    console.error(
      '❌ Subscription Reminder Error:',
      error
    );

  }

});