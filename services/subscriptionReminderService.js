const cron = require('node-cron');

const Client = require('../HR-CDS/models/Client');
const emailService = require('../services/emailService');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const hasEmail = (client) => Boolean(String(client?.email || '').trim());

const sendSubscriptionEmail = (client, subject, body) => {
  return emailService.sendEmail(
    client.email,
    subject,
    `  
      <h2>Hello ${client.client || 'Client'}</h2>
      ${body}
      <p>Please renew your plan to continue services.</p>
    `
  ); 
};

const shouldSendExpiredReminder = (client, now) => {
  if (!client.expiredReminderLastSentAt) return true;

  const lastSentAt = new Date(client.expiredReminderLastSentAt).getTime();
  if (Number.isNaN(lastSentAt)) return true;

  return now.getTime() - lastSentAt >= ONE_DAY_MS;
};

cron.schedule('0 9 * * *', async () => {
  try {
    void 0;

    const clients = await Client.find({
      subscription: { $exists: true, $ne: [] },
      email: { $exists: true, $ne: '' }
    });

    const now = new Date();

    for (const client of clients) {
      if (!hasEmail(client)) continue;

      const latestSubscription = client.subscription[client.subscription.length - 1];
      if (!latestSubscription?.endDate) continue;

      const endDate = new Date(latestSubscription.endDate);
      if (Number.isNaN(endDate.getTime())) continue;

      const daysRemaining = Math.ceil((endDate - now) / ONE_DAY_MS);
      let changed = false;

      if (daysRemaining === 5 && !client.reminder5DaysSent) {
        await sendSubscriptionEmail(
          client,
          'Subscription Expiring Soon',
          '<p>Your subscription will expire in 5 days.</p>'
        );

        client.reminder5DaysSent = true;
        changed = true;
      }

      if (daysRemaining === 3 && !client.reminder3DaysSent) {
        await sendSubscriptionEmail(
          client,
          'Subscription Expiring Soon',
          '<p>Your subscription will expire in 3 days.</p>'
        );

        client.reminder3DaysSent = true;
        changed = true;
      }

      if (daysRemaining < 0 && shouldSendExpiredReminder(client, now)) {
        await sendSubscriptionEmail(
          client,
          'Subscription Expired',
          '<p>Your subscription has expired.</p><p>You will receive this reminder every 24 hours until the subscription is renewed.</p>'
        );

        latestSubscription.status = 'Expired';
        client.expiredMailSent = true;
        client.expiredReminderLastSentAt = now;
        changed = true;
      }

      if (changed) {
        await client.save();
      }
    }

    void 0;
  } catch (error) {
    console.error('Subscription Reminder Error:', error);
  }
});
