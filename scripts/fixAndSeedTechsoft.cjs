require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const connectDB = require('../config/db');

const Company = require('../models/Company');
const Department = require('../models/Department');
const JobRole = require('../models/JobRole');
const PagePermission = require('../models/PagePermission');
const SidebarConfig = require('../models/SidebarConfig');
const User = require('../models/User');

async function main() {
  await connectDB();
  console.log('Connected to DB');

  const tech = await Company.findOne({ companyCode: 'TECH334753' });
  const career = await Company.findOne({ companyCode: 'CAREER' });
  const admin = await User.findOne({ email: 'vansh24810@gmail.com', companyCode: 'TECH334753' });

  if (!tech || !career || !admin) {
    throw new Error('Required documents not found');
  }

  console.log(`Configuring TechSoftSolutions (ID: ${tech._id}, Code: ${tech.companyCode})...`);

  // 1. ADD JOB ROLES FOR SALES DEPARTMENT
  const salesDept = await Department.findOne({ company: tech._id, name: 'SALES DEPARTMENT' });
  if (salesDept) {
    const existingSalesRoles = await JobRole.find({ company: tech._id, department: salesDept._id });
    if (existingSalesRoles.length === 0) {
      console.log('Adding Job Roles for SALES DEPARTMENT...');
      const shiftSettings = {
        shiftId: '1791876103803-0s9pae',
        shiftName: 'General Shift',
        shiftType: 'general',
        shiftStart: '09:00',
        shiftEnd: '19:00',
        earlyClockInStart: '08:30',
        lateGraceLimit: '09:10',
        halfDayLateLimit: '11:00',
        shortLeaveEarlyLimit: '18:30',
        halfDayEarlyLimit: '15:00',
        secondHalfStart: '14:00',
        secondHalfClockInWindow: { start: '13:30', end: '14:30' }
      };

      await JobRole.create([
        {
          name: 'Sales Executive',
          description: 'Sales Executive Role',
          department: salesDept._id,
          departmentName: salesDept.name,
          company: tech._id,
          companyCode: tech.companyCode,
          isActive: true,
          createdBy: admin._id,
          createdByName: admin.name,
          shiftSettings,
          shifts: [shiftSettings]
        },
        {
          name: 'Sales Manager',
          description: 'Sales Manager Role',
          department: salesDept._id,
          departmentName: salesDept.name,
          company: tech._id,
          companyCode: tech.companyCode,
          isActive: true,
          createdBy: admin._id,
          createdByName: admin.name,
          shiftSettings,
          shifts: [shiftSettings]
        }
      ]);
      console.log('✅ Created Sales Executive and Sales Manager roles.');
    } else {
      console.log('SALES DEPARTMENT already has roles:', existingSalesRoles.map(r => r.name).join(', '));
    }
  }

  // 2. SYNC PAGE PERMISSIONS FROM CAREER
  console.log('\nSyncing PagePermissions from CAREER...');
  const careerPerms = await PagePermission.find({ company: career._id }).lean();
  let permsCreated = 0;

  for (const cp of careerPerms) {
    const existing = await PagePermission.findOne({
      company: tech._id,
      $or: [{ pageKey: cp.pageKey }, { path: cp.path }]
    });

    if (!existing) {
      await PagePermission.create({
        company: tech._id,
        companyCode: tech.companyCode,
        pageKey: cp.pageKey,
        name: cp.name,
        path: cp.path,
        permissionPattern: cp.permissionPattern,
        permissionActions: cp.permissionActions,
        approvers: [{ user: admin._id, addedAt: new Date() }],
        editUsers: [{ user: admin._id, addedAt: new Date() }],
        viewUsers: [{ user: admin._id, addedAt: new Date() }],
        deleteUsers: [{ user: admin._id, addedAt: new Date() }],
        generateUsers: [{ user: admin._id, addedAt: new Date() }],
        lockUsers: [{ user: admin._id, addedAt: new Date() }],
        unlockUsers: [{ user: admin._id, addedAt: new Date() }],
        userAccessScopes: [
          { user: admin._id, accessType: 'view', addedAt: new Date() },
          { user: admin._id, accessType: 'edit', addedAt: new Date() },
          { user: admin._id, accessType: 'approve', addedAt: new Date() }
        ]
      });
      permsCreated++;
    }
  }
  const totalPerms = await PagePermission.countDocuments({ company: tech._id });
  console.log(`✅ PagePermissions synced: Created ${permsCreated} new. Total for TECH334753: ${totalPerms}`);

  // 3. SYNC SIDEBAR CONFIG FROM CAREER
  console.log('\nSyncing SidebarConfig from CAREER...');
  const careerSidebars = await SidebarConfig.find({
    $or: [{ companyId: career._id }, { companyCode: 'CAREER' }]
  }).lean();

  let sidebarsCreated = 0;
  for (const cs of careerSidebars) {
    const cleanDoc = { ...cs };
    delete cleanDoc._id;
    delete cleanDoc.__v;
    cleanDoc.companyId = tech._id;
    cleanDoc.companyCode = tech.companyCode;
    cleanDoc.department = cleanDoc.department ? String(cleanDoc.department) : '';
    cleanDoc.jobRole = cleanDoc.jobRole ? String(cleanDoc.jobRole) : '';

    const existing = await SidebarConfig.findOne({
      companyId: tech._id,
      department: cleanDoc.department,
      jobRole: cleanDoc.jobRole,
      companyRole: cleanDoc.companyRole
    });

    if (!existing) {
      await SidebarConfig.create(cleanDoc);
      sidebarsCreated++;
    }
  }
  const totalSidebars = await SidebarConfig.countDocuments({ companyId: tech._id });
  console.log(`✅ SidebarConfigs synced: Created ${sidebarsCreated} new. Total for TECH334753: ${totalSidebars}`);

  console.log('\n🎉 ALL FIXES AND SEEDING COMPLETED FOR TECH334753!');
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
