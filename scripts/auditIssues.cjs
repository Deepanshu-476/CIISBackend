require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const connectDB = require('../config/db');

const Company = require('../models/Company');
const Branch = require('../models/Branch');
const Department = require('../models/Department');
const JobRole = require('../models/JobRole');
const User = require('../models/User');
const PagePermission = require('../models/PagePermission');
const SidebarConfig = require('../models/SidebarConfig');
const MenuAccess = require('../models/MenuAccess');

async function audit() {
  await connectDB();
  console.log('--- AUDITING TECH334753 vs CAREER ---');

  const tech = await Company.findOne({ companyCode: 'TECH334753' }).lean();
  const career = await Company.findOne({ companyCode: 'CAREER' }).lean();

  console.log('\n1. Company Allowed Pages:');
  console.log('TECH334753 allowedPages count:', tech.allowedPages?.length);
  console.log('TECH334753 allowedPages:', tech.allowedPages);

  console.log('\n2. SidebarConfig:');
  const techSidebar = await SidebarConfig.find({
    $or: [{ companyId: tech._id }, { companyCode: 'TECH334753' }]
  }).lean();
  console.log('TECH334753 SidebarConfig count:', techSidebar.length);

  const careerSidebar = await SidebarConfig.find({
    $or: [{ companyId: career._id }, { companyCode: 'CAREER' }]
  }).lean();
  console.log('CAREER SidebarConfig count:', careerSidebar.length);

  console.log('\n3. PagePermission:');
  const techPerms = await PagePermission.find({ company: tech._id }).lean();
  console.log('TECH334753 PagePermissions count:', techPerms.length);

  const careerPerms = await PagePermission.find({ company: career._id }).lean();
  console.log('CAREER PagePermissions count:', careerPerms.length);

  console.log('\n4. MenuAccess:');
  const techMenu = await MenuAccess.find({ company: tech._id }).lean();
  console.log('TECH334753 MenuAccess count:', techMenu.length);

  console.log('\n5. Departments & JobRoles in TECH334753:');
  const techDepts = await Department.find({ company: tech._id }).lean();
  for (const d of techDepts) {
    const roles = await JobRole.find({ company: tech._id, department: d._id }).lean();
    console.log(`- Dept: ${d.name} (${d._id}) -> Roles: [${roles.map(r => r.name).join(', ')}]`);
  }

  console.log('\n6. Users registered in TECH334753:');
  const users = await User.find({ company: tech._id }).select('name email employeeId department departmentName jobRole jobRoleName companyRole isActive registrationStatus').lean();
  console.log('Total users in TECH334753:', users.length);
  console.log('Sample users:');
  users.slice(0, 5).forEach(u => console.log(u));

  process.exit(0);
}

audit().catch(e => {
  console.error(e);
  process.exit(1);
});
