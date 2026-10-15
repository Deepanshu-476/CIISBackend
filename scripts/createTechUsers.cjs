require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const connectDB = require('../config/db');
const Company = require('../models/Company');
const Branch = require('../models/Branch');
const Department = require('../models/Department');
const JobRole = require('../models/JobRole');
const User = require('../models/User');

const testUsersList = [
  { name: 'Vansh Test', email: 'vanshtest@gmail.com', phone: '9800000001' },
  { name: 'Aarav Sharma', email: 'aarav.sharma.test@gmail.com', phone: '9800000002' },
  { name: 'Diya Patel', email: 'diya.patel.test@gmail.com', phone: '9800000003' },
  { name: 'Arjun Verma', email: 'arjun.verma.test@gmail.com', phone: '9800000004' },
  { name: 'Ananya Gupta', email: 'ananya.gupta.test@gmail.com', phone: '9800000005' },
  { name: 'Rohan Mehta', email: 'rohan.mehta.test@gmail.com', phone: '9800000006' },
  { name: 'Ishita Singh', email: 'ishita.singh.test@gmail.com', phone: '9800000007' },
  { name: 'Vivaan Joshi', email: 'vivaan.joshi.test@gmail.com', phone: '9800000008' },
  { name: 'Kavya Bansal', email: 'kavya.bansal.test@gmail.com', phone: '9800000009' },
  { name: 'Aditya Kumar', email: 'aditya.kumar.test@gmail.com', phone: '9800000010' },
  { name: 'Priya Chauhan', email: 'priya.chauhan.test@gmail.com', phone: '9800000011' },
  { name: 'Kabir Malhotra', email: 'kabir.malhotra.test@gmail.com', phone: '9800000012' },
  { name: 'Neha Saxena', email: 'neha.saxena.test@gmail.com', phone: '9800000013' },
  { name: 'Rahul Khanna', email: 'rahul.khanna.test@gmail.com', phone: '9800000014' },
  { name: 'Pooja Arora', email: 'pooja.arora.test@gmail.com', phone: '9800000015' },
  { name: 'Deepak Sethi', email: 'deepak.sethi.test@gmail.com', phone: '9800000016' },
  { name: 'Simran Kaur', email: 'simran.kaur.test@gmail.com', phone: '9800000017' },
  { name: 'Gaurav Rajput', email: 'gaurav.rajput.test@gmail.com', phone: '9800000018' },
  { name: 'Divya Tiwari', email: 'divya.tiwari.test@gmail.com', phone: '9800000019' },
  { name: 'Pankaj Bhatia', email: 'pankaj.bhatia.test@gmail.com', phone: '9800000020' }
];

async function main() {
  await connectDB();
  console.log('Connected to DB');

  const company = await Company.findOne({ companyCode: 'TECH334753' });
  if (!company) {
    throw new Error('Company TECH334753 not found');
  }
  console.log('Found Company:', company.companyName, company.companyCode, company._id);

  const branch = await Branch.findOne({ company: company._id, isActive: true });
  if (!branch) {
    throw new Error('Branch not found for TECH334753');
  }
  console.log('Found Branch:', branch.name, branch.branchCode, branch._id);

  const department = await Department.findOne({ company: company._id, name: 'IT DEPARTMENT' });
  if (!department) {
    throw new Error('IT DEPARTMENT not found for TECH334753');
  }
  console.log('Found Department:', department.name, department._id);

  // Check or create JobRole 'User' under IT DEPARTMENT
  let jobRole = await JobRole.findOne({
    company: company._id,
    department: department._id,
    name: 'User'
  });

  if (!jobRole) {
    console.log("JobRole 'User' not found, creating it under IT DEPARTMENT...");
    const existingRole = await JobRole.findOne({ company: company._id, department: department._id });
    const shiftSettings = existingRole?.shiftSettings || {
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

    jobRole = await JobRole.create({
      name: 'User',
      description: 'Standard Employee User',
      department: department._id,
      departmentName: department.name,
      company: company._id,
      companyCode: company.companyCode,
      isActive: true,
      createdBy: company.ownerName ? undefined : undefined,
      createdByName: 'Test Admin',
      shiftSettings: shiftSettings,
      shifts: [shiftSettings]
    });
    console.log("Created JobRole 'User':", jobRole._id);
  } else {
    console.log("Found existing JobRole 'User':", jobRole._id);
  }

  const defaultPassword = '0987654321';
  const now = new Date();
  const createdUsers = [];

  for (let i = 0; i < testUsersList.length; i++) {
    const item = testUsersList[i];
    const cleanEmail = item.email.toLowerCase().trim();

    // Check if user already exists
    let existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      console.log(`User ${item.name} (${cleanEmail}) already exists (ID: ${existingUser._id}), skipping or updating...`);
      createdUsers.push(existingUser);
      continue;
    }

    const newUser = new User({
      name: item.name,
      email: cleanEmail,
      password: defaultPassword, // Pre-save hook will bcrypt hash this!
      company: company._id,
      companyCode: company.companyCode,
      branch: branch._id,
      assignedBranches: [branch._id],
      branchCode: branch.branchCode,
      branchName: branch.name,
      department: department._id.toString(),
      departmentName: department.name,
      jobRole: jobRole._id.toString(),
      jobRoleName: jobRole.name,
      companyRole: 'employee',
      employeeType: 'full-time',
      phone: item.phone,
      salary: 25000,
      gender: i % 2 === 0 ? 'male' : 'female',
      maritalStatus: 'single',
      dateOfJoining: now,
      shiftId: jobRole.shiftSettings?.shiftId || '1791876103803-0s9pae',
      shiftName: jobRole.shiftSettings?.shiftName || 'General Shift',
      shiftType: jobRole.shiftSettings?.shiftType || 'general',
      isActive: true,
      registrationStatus: 'active',
      registrationSource: 'admin',
      isVerified: true,
      notificationPreferences: {
        push: true,
        web: true,
        email: false,
        channels: {
          taskAssigned: true,
          taskClient: true,
          leave: true,
          assets: true,
          projects: true,
          chats: true,
          attendance: true
        }
      },
      chatSettings: {
        about: 'Available',
        blockedContacts: [],
        chats: {
          theme: 'system',
          enterToSend: true,
          mediaAutoDownload: true,
          wallpaper: ''
        },
        general: {
          startWithSystem: false,
          keepLoggedIn: true,
          compactMode: true
        },
        keyboard: {
          enabled: true,
          sendMessage: 'Enter',
          newLine: 'Shift+Enter'
        },
        privacy: {
          groups: 'everyone',
          lastSeen: 'everyone',
          profilePhoto: 'everyone',
          readReceipts: true
        },
        videoVoice: {
          cameraEnabled: true,
          microphoneEnabled: true,
          speakerEnabled: true
        }
      }
    });

    const saved = await newUser.save();
    console.log(`[${i + 1}/20] Registered ${saved.name} (${saved.email}) - Emp ID: ${saved.employeeId}`);
    createdUsers.push(saved);
  }

  console.log(`\nSuccessfully registered/verified ${createdUsers.length} users in TECH334753!`);

  // Verify password login check for first user vanshtest@gmail.com
  const checkUser = await User.findOne({ email: 'vanshtest@gmail.com' }).select('+password');
  if (checkUser) {
    const isMatch = await bcrypt.compare(defaultPassword, checkUser.password);
    console.log(`Password verification for vanshtest@gmail.com with '0987654321': ${isMatch ? 'PASSED ✅' : 'FAILED ❌'}`);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
