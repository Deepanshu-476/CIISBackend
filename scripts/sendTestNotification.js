const dotenv = require('dotenv');
const mongoose = require('mongoose');
const User = require('../models/User');
const {notifyDirectUsers} = require('../HR-CDS/utils/systemNotificationService');
const {sendPushToUsers} = require('../HR-CDS/utils/firebasePushService');

dotenv.config();

const args = process.argv.slice(2).reduce((acc, item, index, list) => {
  if (!item.startsWith('--')) return acc;
  const key = item.slice(2);
  const next = list[index + 1];
  acc[key] = !next || next.startsWith('--') ? true : next;
  return acc;
}, {});

const usage = () => { 
  void 0;
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is missing in environment');
  }

  if (!args.email && !args.userId) {
    usage();
    throw new Error('Provide --email or --userId');
  }

  await mongoose.connect(process.env.MONGO_URI);

  const user = args.userId
    ? await User.findById(args.userId).select('_id email name company')
    : await User.findOne({email: args.email}).select('_id email name company');

  if (!user) {
    throw new Error('User not found');
  }

  const targetScreen = String(args.screen || 'Dashboard');
  const targetPath = String(args.path || '/ciisUser/user-dashboard');
  const type = String(args.type || 'task_client');
  const title = String(args.title || 'Test Notification');
  const message = String(args.message || 'Manual notification test from CIIS backend.');
  const data = {
    source: 'manual_test',
    taskId: args.taskId || 'manual-test-task',
    service: args.service || 'Manual Test',
  };

  const notifications = await notifyDirectUsers({
    userIds: [user._id],
    targetPath,
    targetScreen,
    type,
    title,
    message,
    company: user.company,
    data,
    priority: 'high',
    push: false,
  });

  let pushResult = {success: false, sent: 0, skipped: true};
  if (!args.noPush) {
    pushResult = await sendPushToUsers({
      userIds: [user._id],
      title,
      body: message,
      data: {
        notificationId: notifications[0]?._id?.toString(),
        type,
        targetPath,
        targetScreen,
        ...data,
      },
    });
  }

  void 0;
};

main()
  .catch(error => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
