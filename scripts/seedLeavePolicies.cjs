require('dotenv').config();
const mongoose = require('mongoose');
const LeavePolicy = require('../models/LeavePolicy');
const Company = require('../models/Company');
const Department = require('../models/Department');
const JobRole = require('../models/JobRole');
const User = require('../models/User');

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  const company = await Company.findOne({ companyCode: 'TECH334753' });
  if (!company) throw new Error('Company TECH334753 not found');

  const admin = await User.findOne({ email: 'vansh24810@gmail.com' });
  const itDept = await Department.findOne({ company: company._id, name: 'IT DEPARTMENT' });
  const userRole = await JobRole.findOne({ company: company._id, name: 'User' });
  const internRole = await JobRole.findOne({ company: company._id, name: 'INTERN2' });

  console.log('Admin:', admin?.email, 'IT Dept:', itDept?._id, 'User Role:', userRole?._id);

  // Update existing Sick policy to include User role and set entitled days
  const updatedSick = await LeavePolicy.findOneAndUpdate(
    { company: company._id, leaveType: 'Sick' },
    {
      $addToSet: { jobRoles: userRole._id },
      $set: {
        department: itDept._id,
        departments: [itDept._id],
        entitledDays: 15,
        monthlyAllowed: 5,
        payType: 'Paid',
        status: 'Active'
      }
    },
    { new: true, upsert: true }
  );
  console.log('Sick policy updated:', updatedSick._id, 'jobRoles count:', updatedSick.jobRoles.length);

  // Also create/ensure Casual Leave policy for IT DEPARTMENT
  const casualPolicy = await LeavePolicy.findOneAndUpdate(
    { company: company._id, leaveType: 'Casual Leave' },
    {
      policyName: 'Casual Leave Policy',
      department: itDept._id,
      departments: [itDept._id],
      jobRoles: [userRole._id, internRole._id],
      leaveType: 'Casual Leave',
      payType: 'Paid',
      entitledDays: 18,
      monthlyAllowed: 4,
      status: 'Active',
      company: company._id,
      companyCode: 'TECH334753',
      createdBy: admin._id
    },
    { new: true, upsert: true }
  );
  console.log('Casual policy ready:', casualPolicy._id);

  await mongoose.disconnect();
  console.log('Done!');
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
