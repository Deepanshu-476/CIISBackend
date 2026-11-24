const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const User = require('../models/User');

const hasProfileValue = (value) => {
  if (value === null || value === undefined) return false;
  if (value instanceof Date) {
    return !isNaN(value.getTime());
  }
  if (typeof value === 'object') {
    const label = value.name || value.roleName || value.departmentName || value.branchName || value.title || value._id || value.id || '';
    if (String(label).trim().length > 0) return true;
    if (typeof value.toString === 'function' && value.toString() !== '[object Object]') {
      const s = value.toString().trim();
      return s.length > 0 && s.toLowerCase() !== 'not provided' && s.toLowerCase() !== 'not added';
    }
    return false;
  }
  const str = String(value).trim();
  return str.length > 0 && str.toLowerCase() !== 'not provided' && str.toLowerCase() !== 'not added';
};

const calculateProfileCompletion = (profile) => {
  if (!profile || typeof profile !== 'object') return 0;
  const fields = [
    profile.name,
    profile.phone || profile.mobile,
    profile.dob,
    profile.gender,
    profile.address,
    profile.city,
    profile.state,
    profile.pinCode || profile.zipCode,
    profile.country,
    profile.aadhaar || profile.aadhar || profile.aadharCard || profile.aadhaarNumber,
    profile.panCard || profile.pan || profile.panNumber,
    profile.bankHolderName,
    profile.accountNumber,
    profile.ifsc,
    profile.bankName,
    profile.maritalStatus,
    profile.fatherName,
    profile.motherName,
    profile.emergencyName,
    profile.emergencyPhone,
    profile.emergencyRelation,
    profile.emergencyAddress,
  ];

  if (String(profile.maritalStatus || '').trim().toLowerCase() === 'married') {
    fields.push(profile.spouseName);
  }

  const completedFields = fields.filter(hasProfileValue).length;
  return Math.round((completedFields / fields.length) * 100);
};

async function syncAll() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');
  const users = await User.find({}).lean();
  console.log(`Found ${users.length} users to sync`);
  
  const bulkOps = users.map(user => {
    const score = calculateProfileCompletion(user);
    return {
      updateOne: {
        filter: { _id: user._id },
        update: { $set: { profileCompletion: score } }
      }
    };
  });
  
  if (bulkOps.length > 0) {
    const result = await User.bulkWrite(bulkOps);
    console.log(`Bulk write result: ${result.modifiedCount} users updated`);
  }
  
  const vansh = await User.findOne({ email: 'ciisvanshgupta@gmail.com' }).lean();
  console.log(`Vansh Gupta profileCompletion in DB: ${vansh?.profileCompletion}%`);
  
  const shainy = await User.findOne({ email: 'ciisshainy@gmail.com' }).lean();
  console.log(`Shainy profileCompletion in DB: ${shainy?.profileCompletion}%`);

  const taniya = await User.findOne({ email: 'ciistaniya@gmail.com' }).lean();
  console.log(`Taniya profileCompletion in DB: ${taniya?.profileCompletion}%`);

  const amrit = await User.findOne({ email: 'amritsingh07a@gmail.com' }).lean();
  console.log(`Amrit Singh profileCompletion in DB: ${amrit?.profileCompletion}%`);

  await mongoose.disconnect();
  console.log('Sync finished successfully');
}

syncAll().catch(err => {
  console.error('Sync failed:', err);
  process.exit(1);
});
