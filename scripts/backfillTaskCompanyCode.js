require('dotenv').config();

const mongoose = require('mongoose');
const Task = require('../HR-CDS/models/Task');
const User = require('../models/User');
require('../models/Company');

const missingCompanyCodeFilter = {
  $or: [
    { companyCode: { $exists: false } },
    { companyCode: null },
    { companyCode: '' }, 
  ],
};

const getUserCompanyCode = async (userId) => {
  if (!userId) return null;

  const user = await User.findById(userId)
    .select('companyCode company')
    .populate('company', 'companyCode')
    .lean();

  const companyCode = user?.companyCode || user?.company?.companyCode;
  return typeof companyCode === 'string' ? companyCode.trim().toUpperCase() : null;
};

const getTaskCompanyCode = async (task) => {
  const creatorCompanyCode = await getUserCompanyCode(task.createdBy);
  if (creatorCompanyCode) return creatorCompanyCode;

  for (const userId of task.assignedUsers || []) {
    const assignedCompanyCode = await getUserCompanyCode(userId);
    if (assignedCompanyCode) return assignedCompanyCode;
  }

  return null;
};

const run = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(process.env.MONGO_URI);

  const tasks = await Task.find(missingCompanyCodeFilter)
    .select('_id title createdBy assignedUsers')
    .lean();

  let updated = 0;
  const skipped = [];

  for (const task of tasks) {
    const companyCode = await getTaskCompanyCode(task);

    if (!companyCode) {
      skipped.push(task._id.toString());
      continue;
    }

    await Task.updateOne(
      { _id: task._id },
      { $set: { companyCode } },
      { runValidators: false }
    );

    updated += 1;
  }

  console.log(`Backfill complete. Checked: ${tasks.length}, Updated: ${updated}, Skipped: ${skipped.length}`);

  if (skipped.length > 0) {
    console.log('Skipped task IDs:', skipped.join(', '));
  }
};

run()
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
