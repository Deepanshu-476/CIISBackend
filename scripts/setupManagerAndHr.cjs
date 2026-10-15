require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Company = require('../models/Company');
const Department = require('../models/Department');
const JobRole = require('../models/JobRole');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const company = await Company.findOne({ companyCode: 'TECH334753' });
  const itDept = await Department.findOne({ company: company._id, name: 'IT DEPARTMENT' });
  const salesDept = await Department.findOne({ company: company._id, name: 'SALES DEPARTMENT' });
  const salesMgrRole = await JobRole.findOne({ company: company._id, name: 'Sales Manager' });

  // 1. Setup Aarav as Manager
  let aarav = await User.findOne({ email: 'aarav.sharma.test@gmail.com' });
  if (aarav) {
    aarav.companyRole = 'manager';
    aarav.role = 'manager';
    aarav.department = salesDept?._id || itDept?._id;
    aarav.jobRole = salesMgrRole?._id;
    aarav.password = '0987654321';
    await aarav.save();
    console.log('✅ Aarav setup as Manager (password: 0987654321)');
  }

  // 2. Setup Diya as HR
  // Check if HR job role exists or create one
  let hrRole = await JobRole.findOne({ company: company._id, name: 'HR Manager' });
  if (!hrRole) {
    hrRole = await JobRole.create({
      name: 'HR Manager',
      company: company._id,
      department: itDept._id,
      companyCode: 'TECH334753'
    });
  }
  let diya = await User.findOne({ email: 'diya.patel.test@gmail.com' });
  if (diya) {
    diya.companyRole = 'hr';
    diya.role = 'hr';
    diya.department = itDept?._id;
    diya.jobRole = hrRole?._id;
    diya.password = '0987654321';
    await diya.save();
    console.log('✅ Diya setup as HR (password: 0987654321)');
  }

  await mongoose.disconnect();
}

main().catch(console.error);
