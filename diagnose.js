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
  void 0;

  
  const fbStatus = getFirebasePushStatus();
  void 0;
  void 0;

  
  const deviceCount = await Device.countDocuments({});
  void 0;

  
  const devices = await Device.find({}).limit(10).lean();
  void 0;
  void 0;

  
  const users = await User.find({}).limit(5).lean();
  void 0;
  void 0;
};

main()
  .catch(console.error)
  .finally(async () => {
    await mongoose.disconnect().catch(() => {});
  });
