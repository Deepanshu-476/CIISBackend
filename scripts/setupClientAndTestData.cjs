const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const Company = require('../models/Company');
const User = require('../models/User');
const Department = require('../models/Department');
const JobRole = require('../models/JobRole');
const Branch = require('../models/Branch');
const SupportTicket = require('../models/SupportTicket');

const Client = require('../HR-CDS/models/Client');
const Service = require('../HR-CDS/models/Service');
const ClientPlan = require('../HR-CDS/models/ClientPlan');
const ClientTask = require('../HR-CDS/models/ClientTask');
const ClientMeeting = require('../HR-CDS/models/ClientMeeting');
const ClientDocument = require('../HR-CDS/models/ClientDocument');

const COMPANY_CODE = 'TECH334753';
const CLIENT_EMAIL = 'clienttest@gmail.com';
const CLIENT_PASSWORD = 'password123'; // will set hash for 0987654321

async function setup() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB');

  const company = await Company.findOne({ companyCode: COMPANY_CODE });
  if (!company) {
    console.error('Company not found:', COMPANY_CODE);
    process.exit(1);
  }

  const branch = await Branch.findOne({ companyCode: COMPANY_CODE });
  const adminUser = await User.findOne({ companyCode: COMPANY_CODE, companyRole: { $in: ['admin', 'companyowner', 'owner'] } });
  const pmName = adminUser ? adminUser.name : 'Project Manager';

  // 1. Ensure Services in Service catalog
  const standardServices = [
    'Web Development',
    'UI/UX Design',
    'SEO Optimization',
    'Mobile App Development',
    'Cloud Architecture'
  ];

  for (const sName of standardServices) {
    await Service.findOneAndUpdate(
      { companyCode: COMPANY_CODE, servicename: sName },
      { companyCode: COMPANY_CODE, servicename: sName },
      { upsert: true, new: true }
    );
  }
  console.log('Services catalog verified for company');

  // 2. Ensure ClientPlan
  let plan = await ClientPlan.findOne({ companyCode: COMPANY_CODE, name: 'Growth Starter Plan' });
  if (!plan) {
    plan = await ClientPlan.create({
      companyCode: COMPANY_CODE,
      name: 'Growth Starter Plan',
      price: 25000,
      months: 1,
      description: 'Comprehensive web and design growth plan',
      services: [
        {
          service: 'Web Development',
          tasks: [
            { name: 'Architecture & Design System', description: 'Setup base project & theme', priority: 'High', dueInDays: 7 },
            { name: 'Core Feature Integration', description: 'Implement REST APIs & UI', priority: 'High', dueInDays: 14 },
            { name: 'QA & Staging Release', description: 'Testing & verification', priority: 'Medium', dueInDays: 21 }
          ]
        },
        {
          service: 'UI/UX Design',
          tasks: [
            { name: 'Figma High-Fidelity Mockups', description: 'Create responsive prototype', priority: 'High', dueInDays: 5 },
            { name: 'User Experience Review', description: 'Client feedback and revisions', priority: 'Medium', dueInDays: 10 }
          ]
        }
      ],
      isActive: true
    });
    console.log('Created ClientPlan:', plan.name);
  } else {
    console.log('Found existing ClientPlan:', plan.name);
  }

  // 3. Find or create Client Department & JobRole
  let clientDept = await Department.findOne({
    company: company._id,
    name: { $regex: /^client$/i },
    isActive: true
  });
  if (!clientDept) {
    clientDept = await Department.create({
      name: 'client',
      description: 'Department for clients',
      company: company._id,
      companyCode: COMPANY_CODE,
      isActive: true
    });
  }

  let clientRole = await JobRole.findOne({
    company: company._id,
    department: clientDept._id,
    name: { $regex: /^client$/i },
    isActive: true
  });
  if (!clientRole) {
    clientRole = await JobRole.create({
      name: 'client',
      description: 'Job role for clients',
      department: clientDept._id,
      company: company._id,
      companyCode: COMPANY_CODE,
      isActive: true
    });
  }

  // 4. Create or update User for client
  let clientUser = await User.findOne({ email: CLIENT_EMAIL, companyCode: COMPANY_CODE });
  if (!clientUser) {
    clientUser = await User.create({
      name: 'Acme Test Client',
      email: CLIENT_EMAIL,
      password: '0987654321',
      department: clientDept._id,
      jobRole: clientRole._id,
      company: company._id,
      companyCode: COMPANY_CODE,
      branch: branch?._id,
      assignedBranches: branch?._id ? [branch._id] : [],
      employeeId: `CLT-${Date.now()}`,
      phone: '9876543210',
      address: 'Industrial Area Phase 2, Panchkula',
      gender: 'other',
      maritalStatus: 'single',
      employeeType: 'client',
      companyRole: 'client',
      role: 'User',
      isActive: true
    });
    console.log('Created client User:', clientUser.email);
  } else {
    clientUser.password = '0987654321';
    clientUser.companyRole = 'client';
    clientUser.employeeType = 'client';
    clientUser.department = clientDept._id;
    clientUser.jobRole = clientRole._id;
    clientUser.company = company._id;
    clientUser.companyCode = COMPANY_CODE;
    clientUser.isActive = true;
    await clientUser.save();
    console.log('Updated existing client User password and role');
  }

  // 5. Create or update Client entity
  const startDate = new Date();
  const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  let clientEntity = await Client.findOne({ companyCode: COMPANY_CODE, email: CLIENT_EMAIL });
  if (!clientEntity) {
    clientEntity = await Client.create({
      client: 'Acme Test Client',
      company: 'Acme Global Tech',
      city: 'Panchkula',
      companyCode: COMPANY_CODE,
      branch: branch?._id,
      projectManager: [pmName],
      services: ['Web Development', 'UI/UX Design'],
      activeClientPlan: plan._id,
      status: 'Active',
      progress: '1/5 (20%)',
      email: CLIENT_EMAIL,
      phone: '9876543210',
      address: 'Industrial Area Phase 2, Panchkula',
      description: 'Enterprise IT Client for system testing',
      userId: clientUser._id,
      subscription: [
        {
          subscriptionNo: 1,
          planId: plan._id,
          planName: plan.name,
          startDate,
          endDate,
          price: 25000,
          status: 'Active',
          servicesSnapshot: plan.services.map(s => ({
            service: s.service,
            tasks: s.tasks.map(t => ({
              name: t.name,
              description: t.description,
              priority: t.priority,
              dueInDays: t.dueInDays
            }))
          }))
        }
      ],
      dueInvoices: [
        {
          title: 'Growth Starter Plan - Month 1',
          subscriptionNo: 1,
          planName: plan.name,
          amount: 25000,
          periodStart: startDate,
          periodEnd: endDate,
          billingCycle: '1 Month',
          dueDate: endDate,
          status: 'Paid',
          note: 'Initial subscription invoice'
        }
      ],
      paymentReceipts: [
        {
          amount: 25000,
          startDate,
          endDate,
          paymentDate: startDate,
          status: 'Approved',
          notes: 'Online bank transfer verified',
          receiptNumber: 'REC-2026-001'
        }
      ]
    });
    console.log('Created Client entity:', clientEntity._id);
  } else {
    clientEntity.userId = clientUser._id;
    clientEntity.services = ['Web Development', 'UI/UX Design'];
    clientEntity.activeClientPlan = plan._id;
    clientEntity.status = 'Active';
    clientEntity.projectManager = [pmName];
    await clientEntity.save();
    console.log('Updated existing Client entity');
  }

  // Update User additionalDetails with clientId
  clientUser.additionalDetails = JSON.stringify({
    clientId: clientEntity._id,
    clientIds: [clientEntity._id]
  });
  clientUser.employeeType = clientEntity._id.toString();
  await clientUser.save();

  // 6. Generate Client Tasks
  const existingTasks = await ClientTask.find({ clientId: clientEntity._id });
  if (existingTasks.length === 0) {
    const sub = clientEntity.subscription[0];
    const taskDocs = [
      {
        clientId: clientEntity._id,
        subscriptionId: sub._id,
        subscriptionNo: sub.subscriptionNo,
        planId: plan._id,
        planName: plan.name,
        service: 'Web Development',
        name: 'Architecture & Design System',
        description: 'Setup base project & theme',
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        priority: 'High',
        status: 'completed',
        completed: true,
        assignedTo: adminUser ? adminUser._id : null,
        assignedToName: pmName
      },
      {
        clientId: clientEntity._id,
        subscriptionId: sub._id,
        subscriptionNo: sub.subscriptionNo,
        planId: plan._id,
        planName: plan.name,
        service: 'Web Development',
        name: 'Core Feature Integration',
        description: 'Implement REST APIs & UI',
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        priority: 'High',
        status: 'in-progress',
        completed: false,
        assignedTo: adminUser ? adminUser._id : null,
        assignedToName: pmName
      },
      {
        clientId: clientEntity._id,
        subscriptionId: sub._id,
        subscriptionNo: sub.subscriptionNo,
        planId: plan._id,
        planName: plan.name,
        service: 'UI/UX Design',
        name: 'Figma High-Fidelity Mockups',
        description: 'Create responsive prototype',
        dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
        priority: 'Medium',
        status: 'pending',
        completed: false,
        assignedTo: adminUser ? adminUser._id : null,
        assignedToName: pmName
      }
    ];
    await ClientTask.insertMany(taskDocs);
    console.log('Inserted client tasks:', taskDocs.length);
  } else {
    console.log('Client tasks already present:', existingTasks.length);
  }

  // 7. Generate a Client Meeting
  const meeting = await ClientMeeting.findOneAndUpdate(
    { clientId: clientEntity._id, title: 'Weekly Project Sync & Review' },
    {
      title: 'Weekly Project Sync & Review',
      clientId: clientEntity._id,
      clientName: clientEntity.client,
      company: clientEntity.company,
      companyCode: COMPANY_CODE,
      email: clientEntity.email,
      phone: clientEntity.phone,
      meetingType: 'Online',
      meetingDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      time: '11:00 AM',
      location: 'Google Meet',
      link: 'https://meet.google.com/abc-defg-hij',
      status: 'Scheduled',
      createdBy: adminUser?._id,
      createdByName: pmName
    },
    { upsert: true, new: true }
  );
  console.log('Client meeting ready:', meeting.title);

  // 8. Generate a Support Ticket
  let ticket = await SupportTicket.findOne({ companyCode: COMPANY_CODE, requester: clientUser._id });
  if (!ticket) {
    ticket = await SupportTicket.create({
      ticketNumber: `TK-${Date.now().toString().slice(-6)}`,
      company: company._id,
      companyCode: COMPANY_CODE,
      requester: clientUser._id,
      requesterName: clientEntity.client,
      requesterEmail: clientEntity.email,
      department: 'Support Desk',
      subject: 'Inquiry regarding custom dashboard metrics',
      description: 'Need additional metrics chart added to project dashboard.',
      category: 'General',
      priority: 'Medium',
      status: 'Open',
      source: 'portal',
      messages: [
        {
          sender: clientUser._id,
          senderName: clientEntity.client,
          senderRole: 'employee',
          message: 'Hello team, can we schedule a demo for custom dashboard metrics?',
          createdAt: new Date()
        }
      ]
    });
    console.log('Created SupportTicket:', ticket.ticketNumber);
  } else {
    console.log('Found existing SupportTicket:', ticket.ticketNumber);
  }

  // 9. Generate a Client Document
  const doc = await ClientDocument.findOneAndUpdate(
    { client: clientEntity._id, originalName: 'Project_Scope_Document_v1.pdf' },
    {
      client: clientEntity._id,
      companyCode: COMPANY_CODE,
      originalName: 'Project_Scope_Document_v1.pdf',
      storedName: `scope_${Date.now()}.pdf`,
      path: '/uploads/documents/sample_scope.pdf',
      mimeType: 'application/pdf',
      size: 1024 * 350,
      category: 'General',
      uploadedBy: adminUser?._id || clientUser._id,
      uploadedByName: pmName,
      uploadedByRole: 'company',
      isDeleted: false
    },
    { upsert: true, new: true }
  );
  console.log('Client document ready:', doc.originalName);

  console.log('\n=== SETUP COMPLETE ===');
  console.log('Client Email:', CLIENT_EMAIL);
  console.log('Client Password:', '0987654321');
  console.log('Company Code:', COMPANY_CODE);
  console.log('Client Entity ID:', clientEntity._id);
  console.log('User ID:', clientUser._id);

  await mongoose.disconnect();
}

setup().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
