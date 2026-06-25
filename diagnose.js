const dotenv = require('dotenv');
const mongoose = require('mongoose');
const Device = require('./models/Device');
const User = require('./models/User');
const { getFirebasePushStatus } = require('./HR-CDS/utils/firebasePushService');

dotenv.config();

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is missing in environment');
  }

  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  // 1. Check Firebase Push Status
  const fbStatus = getFirebasePushStatus();
  console.log('--- Firebase Push Status ---');
  console.log(JSON.stringify(fbStatus, null, 2));

  // 2. Count registered devices
  const deviceCount = await Device.countDocuments({});
  console.log(`Total devices registered: ${deviceCount}`);

  // 3. List some devices
  const devices = await Device.find({}).limit(10).lean();
  console.log('--- Sample Devices ---');
  console.log(JSON.stringify(devices.map(d => ({
    _id: d._id,
    userId: d.userId,
    platform: d.platform,
    notificationPermission: d.notificationPermission,
    updatedAt: d.updatedAt,
    tokenPreview: d.deviceToken ? `${d.deviceToken.slice(0, 10)}...${d.deviceToken.slice(-10)}` : 'none'
  })), null, 2));

  // 4. Sample Users
  const users = await User.find({}).limit(5).lean();
  console.log('--- Sample Users ---');
  console.log(JSON.stringify(users.map(u => ({
    _id: u._id,
    name: u.name,
    email: u.email  
  })), null, 2));
};

main()
  .catch(console.error)
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
