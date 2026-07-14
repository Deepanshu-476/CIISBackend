const Client = require('../models/Client');
const Service = require('../models/Service');
const ClientPlan = require('../models/ClientPlan');
const ClientTask = require('../models/ClientTask');
const User = require('../../models/User');
const Department = require('../../models/Department');
const JobRole = require('../../models/JobRole');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Company = require('../../models/Company');
const emailService = require('../../services/emailService'); 
const multer = require('multer');
const path = require('path');
const { getPaginationOptions, buildPaginationMeta } = require('../../utils/pagination');


const DEFAULT_CLIENT_DEPARTMENT_ID = '69ae555c9a1e47e80a40204c';

const DEFAULT_CLIENT_JOB_ROLE_ID = '69ae559b9a1e47e80a4020a2';

const normalizeCompanyCode = (companyCode) => companyCode?.trim().toUpperCase();
const normalizeEmail = (email) => email?.trim().toLowerCase();
const normalizeName = (value) => value?.trim();
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let clientMultiCompanyIndexPromise = null;

const isIndexKey = (index, expectedKey) => {
  const key = index?.key || {};
  const keyNames = Object.keys(key);
  const expectedNames = Object.keys(expectedKey);
  return keyNames.length === expectedNames.length &&
    expectedNames.every(name => Number(key[name]) === Number(expectedKey[name]));
};

const ensureClientMultiCompanyIndexes = async () => {
  if (clientMultiCompanyIndexPromise) return clientMultiCompanyIndexPromise;

  clientMultiCompanyIndexPromise = (async () => {
    try {
      const indexes = await Client.collection.indexes();
      const oldUniqueIndex = indexes.find(index => (
        index.unique === true &&
        isIndexKey(index, { client: 1, companyCode: 1 })
      ));

      if (oldUniqueIndex?.name) {
        await Client.collection.dropIndex(oldUniqueIndex.name);
      }

      await Client.collection.createIndex(
        { client: 1, company: 1, companyCode: 1 },
        { unique: true, name: 'client_1_company_1_companyCode_1' }
      );
      await Client.collection.createIndex(
        { parentClientId: 1, companyCode: 1 },
        { name: 'parentClientId_1_companyCode_1' }
      );
      await Client.collection.createIndex(
        { parentClientName: 1, companyCode: 1 },
        { name: 'parentClientName_1_companyCode_1' }
      );
    } catch (error) {
      clientMultiCompanyIndexPromise = null;
      console.error('Client multi-company index sync failed:', error);
    }
  })();

  return clientMultiCompanyIndexPromise;
};

const sendConflict = (res, message, field, extra = {}) => {
  return res.status(409).json({
    success: false,
    message,
    field,
    ...extra
  });
};

const getPlanServiceNames = plan => (
  Array.isArray(plan?.services)
    ? [...new Set(plan.services.map(item => String(item.service || '').trim()).filter(Boolean))]
    : []
);

const createSubscriptionFromInput = ({ sub = {}, plan = null, fallbackNo = 1 }) => {
  const servicesSnapshot = plan?.services?.map(item => ({
    service: item.service,
    tasks: (item.tasks || []).map(task => ({
      name: task.name,
      description: task.description || task.name,
      priority: task.priority || 'Medium',
      dueInDays: Number(task.dueInDays || 0)
    }))
  })) || [];

  return {
    subscriptionNo: fallbackNo,
    planId: plan?._id || sub.planId || null,
    planName: plan?.name || sub.planName || '',
    servicesSnapshot,
    startDate: new Date(sub.startDate),
    endDate: new Date(sub.endDate),
    price: plan ? Number(plan.price || 0) : Number(sub.price || 0),
    status: sub.status || 'Active',
    extraTasks: Number(sub.extraTasks || 0),
    benefits: sub.benefits || ''
  };
};

const getClientCompanyFilter = (client) => ({
  companyCode: client.companyCode,
  $or: [
    { parentClientId: client._id },
    { _id: client._id },
    {
      $or: [{ parentClientId: null }, { parentClientId: { $exists: false } }],
      client: { $regex: `^${escapeRegExp(client.client || '')}$`, $options: 'i' }
    }
  ]
});

const getLatestSubscription = (client) => (
  Array.isArray(client?.subscription) && client.subscription.length > 0
    ? client.subscription[client.subscription.length - 1]
    : null
);

const getClientRevenueTotal = (client) => {
  const approvedReceiptTotal = Array.isArray(client?.paymentReceipts)
    ? client.paymentReceipts
      .filter(receipt => ['Approved', 'Paid'].includes(receipt.status))
      .reduce((sum, receipt) => sum + Number(receipt.amount || 0), 0)
    : 0;

  if (approvedReceiptTotal > 0) return approvedReceiptTotal;

  const paidInvoiceTotal = Array.isArray(client?.dueInvoices)
    ? client.dueInvoices
      .filter(invoice => invoice.status === 'Paid')
      .reduce((sum, invoice) => sum + Number(invoice.amount || 0), 0)
    : 0;

  if (paidInvoiceTotal > 0) return paidInvoiceTotal;

  return Array.isArray(client?.subscription)
    ? client.subscription.reduce((sum, subscription) => sum + Number(subscription.price || 0), 0)
    : 0;
};

const toCompanyCard = (client, taskSummary = {}) => {
  const latestSubscription = getLatestSubscription(client);
  const approvedPayments = Array.isArray(client.paymentReceipts)
    ? client.paymentReceipts.filter(receipt => receipt.status === 'Approved')
    : [];
  const lastPayment = approvedPayments
    .sort((a, b) => new Date(b.verifiedAt || b.uploadDate || 0) - new Date(a.verifiedAt || a.uploadDate || 0))[0] || null;

  return {
    _id: client._id,
    parentClientId: client.parentClientId || client._id,
    parentClientName: client.parentClientName || client.client,
    companyLogo: client.companyLogo || '',
    companyName: client.company,
    company: client.company,
    gst: client.gst || '',
    pan: client.pan || '',
    email: client.email || '',
    phone: client.phone || '',
    status: client.status,
    activePlan: latestSubscription?.planName || '',
    totalServices: Array.isArray(client.services) ? client.services.length : 0,
    totalTasks: taskSummary.total || 0,
    lastPayment: lastPayment ? {
      amount: lastPayment.amount || 0,
      date: lastPayment.verifiedAt || lastPayment.uploadDate || null,
      receiptNumber: lastPayment.receiptNumber || ''
    } : null,
    client
  };
};

const getSubscriptionTaskDueDate = subscription => {
  if (!subscription?.endDate) return null;
  const dueDate = new Date(subscription.endDate);
  if (Number.isNaN(dueDate.getTime())) return null;
  return dueDate;
};

const getSubscriptionMonthSpan = subscription => {
  const start = new Date(subscription?.startDate);
  const end = new Date(subscription?.endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 1;
  const months = ((end.getFullYear() - start.getFullYear()) * 12) + (end.getMonth() - start.getMonth());
  return Math.max(1, months || 1);
};

const createRenewalDueInvoice = ({ subscription, plan = null }) => {
  const amount = Number(subscription?.price || 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const planName = subscription?.planName || plan?.name || 'Subscription Renewal';
  const months = getSubscriptionMonthSpan(subscription);

  return {
    title: `${planName} Renewal`,
    subscriptionId: subscription._id,
    subscriptionNo: subscription.subscriptionNo,
    planName,
    periodStart: subscription.startDate,
    periodEnd: subscription.endDate,
    billingCycle: `${months} Month${months === 1 ? '' : 's'}`,
    amount,
    dueDate: subscription.startDate || new Date(),
    note: `Auto generated bill for Subscription ${subscription.subscriptionNo}`,
    status: 'Due'
  };
};

const generateTasksForSubscription = async ({ client, subscription, plan, session }) => {
  if (!plan || !subscription?._id) return [];
  const createdTaskIds = [];
  const subscriptionDueDate = getSubscriptionTaskDueDate(subscription);

  for (const serviceTemplate of plan.services || []) {
    for (const taskTemplate of serviceTemplate.tasks || []) {
      const [task] = await ClientTask.create([{
        clientId: client._id,
        subscriptionId: subscription._id,
        subscriptionNo: subscription.subscriptionNo,
        planId: plan._id,
        planName: plan.name,
        templateTaskId: taskTemplate._id,
        isPlanTask: true,
        service: serviceTemplate.service,
        name: taskTemplate.name,
        description: taskTemplate.description || taskTemplate.name,
        dueDate: subscriptionDueDate,
        dueDateSource: 'subscription',
        priority: taskTemplate.priority || 'Medium',
        status: 'pending',
        completed: false,
        activityLogs: [{
          action: 'created_from_plan',
          userName: 'System',
          description: `Generated from ${plan.name} / Subscription ${subscription.subscriptionNo}`,
          createdAt: new Date()
        }]
      }], { session });

      createdTaskIds.push(task._id);
    }
  }

  if (createdTaskIds.length) {
    await Client.updateOne(
      { _id: client._id, 'subscription._id': subscription._id },
      { $set: { 'subscription.$.generatedTaskIds': createdTaskIds } },
      { session }
    );
  }

  return createdTaskIds;
};

const extendOverdueClientTasksToSubscriptionEnd = async ({ clientId, subscription, session = null }) => {
  const subscriptionDueDate = getSubscriptionTaskDueDate(subscription);
  if (!clientId || !subscriptionDueDate) {
    return { matchedCount: 0, modifiedCount: 0 };
  }

  const now = new Date();
  const overdueOpenTaskFilter = {
    clientId,
    completed: { $ne: true },
    status: { $nin: ['completed', 'onhold'] },
    $or: [
      { status: 'overdue' },
      { dueDate: { $lt: now } }
    ]
  };
  const updateOptions = session ? { session } : {};
  const activityLog = {
    action: 'subscription_renewed_due_date_extended',
    userName: 'System',
    description: `Due date extended to subscription expiry ${subscriptionDueDate.toISOString()}`,
    oldValues: { overdueBefore: now },
    newValues: {
      dueDate: subscriptionDueDate,
      subscriptionNo: subscription.subscriptionNo || null,
      subscriptionId: subscription._id || null
    },
    createdAt: now
  };

  const result = await ClientTask.updateMany(
    overdueOpenTaskFilter,
    {
      $set: {
        dueDate: subscriptionDueDate,
        dueDateSource: 'subscription',
        status: 'pending'
      },
      $push: { activityLogs: activityLog }
    },
    updateOptions
  );

  return {
    matchedCount: result.matchedCount || result.n || 0,
    modifiedCount: result.modifiedCount || result.nModified || 0
  };
};


const getWelcomeEmailTemplate = (name, company, email, password, loginUrl) => {
  const currentYear = new Date().getFullYear();
  
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to CIIS NETWORK</title>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                background-color: #f4f7fb;
            }
            
            .email-container {
                max-width: 600px;
                margin: 20px auto;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                border-radius: 16px;
                overflow: hidden;
                box-shadow: 0 20px 40px rgba(0,0,0,0.1);
            }
            
            .email-header {
                background: rgba(255,255,255,0.1);
                padding: 40px 30px;
                text-align: center;
                border-bottom: 1px solid rgba(255,255,255,0.2);
            }
            
            .email-header h1 {
                color: white;
                font-size: 32px;
                margin-bottom: 10px;
                font-weight: 700;
                text-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            
            .email-header p {
                color: rgba(255,255,255,0.9);
                font-size: 18px;
            }
            
            .email-body {
                background: white;
                padding: 40px 30px;
                border-radius: 24px 24px 0 0;
                margin-top: -20px;
            }
            
            .welcome-message {
                text-align: center;
                margin-bottom: 30px;
            }
            
            .welcome-message h2 {
                color: #2d3748;
                font-size: 24px;
                margin-bottom: 10px;
            }
            
            .welcome-message p {
                color: #718096;
                font-size: 16px;
            }
            
            .credentials-card {
                background: linear-gradient(135deg, #f6f9fc 0%, #edf2f7 100%);
                border-radius: 16px;
                padding: 30px;
                margin: 30px 0;
                border: 1px solid #e2e8f0;
            }
            
            .credential-item {
                display: flex;
                align-items: center;
                padding: 15px 0;
                border-bottom: 1px solid #e2e8f0;
            }
            
            .credential-item:last-child {
                border-bottom: none;
            }
            
            .credential-label {
                flex: 0 0 120px;
                font-weight: 600;
                color: #4a5568;
            }
            
            .credential-value {
                flex: 1;
                font-family: 'Courier New', monospace;
                background: white;
                padding: 10px 15px;
                border-radius: 8px;
                border: 1px solid #cbd5e0;
                color: #2d3748;
                font-size: 14px;
                word-break: break-all;
            }
            
            .important-note {
                background: #fff3cd;
                border-left: 4px solid #ffc107;
                padding: 20px;
                margin: 30px 0;
                border-radius: 8px;
            }
            
            .important-note h4 {
                color: #856404;
                margin-bottom: 10px;
                font-size: 16px;
            }
            
            .important-note p {
                color: #856404;
                font-size: 14px;
            }
            
            .button-container {
                text-align: center;
                margin: 30px 0;
            }
            
            .login-button {
                display: inline-block;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                text-decoration: none;
                padding: 15px 40px;
                border-radius: 40px;
                font-weight: 600;
                font-size: 16px;
                box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
                transition: transform 0.2s, box-shadow 0.2s;
            }
            
            .login-button:hover {
                transform: translateY(-2px);
                box-shadow: 0 15px 30px rgba(102, 126, 234, 0.4);
            }
            
            .features-grid {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 20px;
                margin: 30px 0;
            }
            
            .feature-item {
                text-align: center;
                padding: 20px;
                background: #f8fafc;
                border-radius: 12px;
            }
            
            .feature-icon {
                font-size: 32px;
                margin-bottom: 10px;
            }
            
            .feature-item h4 {
                color: #2d3748;
                margin-bottom: 5px;
                font-size: 16px;
            }
            
            .feature-item p {
                color: #718096;
                font-size: 13px;
            }
            
            .email-footer {
                text-align: center;
                padding: 30px;
                background: #f8fafc;
                border-top: 1px solid #e2e8f0;
            }
            
            .email-footer p {
                color: #718096;
                font-size: 14px;
                margin-bottom: 10px;
            }
            
            .email-footer a {
                color: #667eea;
                text-decoration: none;
            }
            
            .company-badge {
                display: inline-block;
                background: rgba(102, 126, 234, 0.1);
                color: #667eea;
                padding: 5px 15px;
                border-radius: 20px;
                font-size: 14px;
                font-weight: 500;
                margin-top: 10px;
            }
            
            @media (max-width: 600px) {
                .email-container {
                    margin: 10px;
                    border-radius: 12px;
                }
                
                .email-header {
                    padding: 30px 20px;
                }
                
                .email-body {
                    padding: 30px 20px;
                }
                
                .credential-item {
                    flex-direction: column;
                    align-items: flex-start;
                }
                
                .credential-label {
                    margin-bottom: 5px;
                }
                
                .credential-value {
                    width: 100%;
                }
                
                .features-grid {
                    grid-template-columns: 1fr;
                }
            }
        </style>
    </head>
    <body>
        <div class="email-container">
            <div class="email-header">
                <h1>🎉 Welcome to CIIS NETWORK!</h1>
                <p>Your account has been created successfully</p>
            </div>
            
            <div class="email-body">
                <div class="welcome-message">
                    <h2>Hello ${name}!</h2>
                    <p>Thank you for joining CIIS NETWORK. We're excited to have you on board!</p>
                    <div class="company-badge">${company} • ${email}</div>
                </div>
                
                <div class="credentials-card">
                    <h3 style="margin-bottom: 20px; color: #2d3748;">🔐 Your Login Credentials</h3>
                    
                    <div class="credential-item">
                        <div class="credential-label">Email:</div>
                        <div class="credential-value">${email}</div>
                    </div>
                    
                    <div class="credential-item">
                        <div class="credential-label">Password:</div>
                        <div class="credential-value">${password}</div>
                    </div>
                </div>
                
                <div class="important-note">
                    <h4>⚠️ Important Security Notes:</h4>
                    <p>• Please change your password after first login</p>
                    <p>• Never share your password with anyone</p>
                    <p>• Use a strong, unique password for your account</p>
                    <p>• Enable two-factor authentication for added security</p>
                </div>
                
                <div class="button-container">
                    <a href="${loginUrl}" class="login-button" target="_blank">
                        🔑 Login to Your Account
                    </a>
                </div>
                
                <div class="features-grid">
                    <div class="feature-item">
                        <div class="feature-icon">📊</div>
                        <h4>Dashboard</h4>
                        <p>View your personalized dashboard</p>
                    </div>
                    
                    <div class="feature-item">
                        <div class="feature-icon">👥</div>
                        <h4>Team Management</h4>
                        <p>Manage your team efficiently</p>
                    </div>
                    
                    <div class="feature-item">
                        <div class="feature-icon">📅</div>
                        <h4>Leave Management</h4>
                        <p>Track and manage leaves</p>
                    </div>
                    
                    <div class="feature-item">
                        <div class="feature-icon">📈</div>
                        <h4>Reports</h4>
                        <p>Generate insightful reports</p>
                    </div>
                </div>
                
                <div style="text-align: center; margin-top: 30px; padding: 20px; background: #f0f9ff; border-radius: 12px;">
                    <p style="color: #0369a1; font-size: 15px;">
                        <strong>Need help?</strong> Our support team is here for you 24/7
                    </p>
                </div>
            </div>
            
            <div class="email-footer">
                <p>© ${currentYear} CIIS NETWORK. All rights reserved.</p>
                <p>
                    <a href="#">Privacy Policy</a> • 
                    <a href="#">Terms of Service</a> • 
                    <a href="#">Contact Support</a>
                </p>
                <p style="font-size: 12px; margin-top: 20px;">
                    This email was sent to ${email} regarding your CIIS NETWORK account.
                </p>
            </div>
        </div>
    </body>
    </html>
  `;
};


const getCompanyLoginUrl = (companyCode) => {
  const normalizedCompanyCode = companyCode?.trim();
  if (!normalizedCompanyCode) {
    return 'https://cds.ciisnetwork.in/login';
  }

  return `https://cds.ciisnetwork.in/company/${normalizedCompanyCode}/login`;
};

const sendWelcomeEmail = async (email, name, company, password, companyCode) => {
  void 0;
  void 0;
  void 0;
  void 0;
  void 0;
  void 0;
  
  const fullLoginUrl = getCompanyLoginUrl(companyCode);
  
  try {
    const emailHtml = getWelcomeEmailTemplate(name, company, email, password, fullLoginUrl);
    
    const result = await emailService.sendEmail(
      email,
      `🎉 Welcome to CIIS NETWORK - Your Account Has Been Created (${company})`,
      emailHtml,
      {
        priority: 'high',
        referenceId: `client-welcome-${Date.now()}`,
        notificationType: 'email_notification',
        notificationTargetPath: '/ciisUser/ClientDashboard',
        notificationMessage: `Your CIIS account for ${company} has been created. Please check your email for login details.`,
        notificationPriority: 'high',
        headers: {
          'X-Email-Type': 'client-welcome',
          'X-Company': company,
          'X-Company-Code': companyCode || '',
          'X-User-Email': email
        }
      }
    );
    
    if (result.success) {
      void 0;
    } else {
      console.warn(`⚠️ Welcome email sending failed but continuing: ${result.error}`);
    }
    
    return result;
  } catch (error) {
    console.error('❌ Error sending welcome email:', error);
    return { success: false, error: error.message };
  }
};

const getAllClients = async (req, res) => {
  void 0;
  try {
    const {
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      search,
      status,
      projectManager,
      service,
      companyCode,
      groupByClient = 'false'
    } = req.query;

    const filter = {};
    
    if (!companyCode) {
      console.warn('⚠️ No companyCode provided in request');
      return res.status(400).json({
        success: false,
        message: 'Company code is required'
      });
    }
    filter.companyCode = companyCode.toUpperCase();
    
    if (status && status !== 'All') filter.status = status;
    
    if (projectManager && projectManager !== 'All') {
      filter.projectManager = projectManager;
    }
    
    if (service && service !== 'All') {
      filter.services = service;
    }
    
    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { client: searchRegex },
        { company: searchRegex },
        { city: searchRegex },
        { email: searchRegex },
        { description: searchRegex },
        { 'projectManager': { $regex: searchRegex } }
      ];
    }

    const sortOptions = {};
    const validSortFields = ['client', 'company', 'city', 'status', 'createdAt', 'updatedAt'];
    
    if (validSortFields.includes(sortBy)) {
      sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
    } else {
      sortOptions.createdAt = -1;
    }

    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const safePage = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (safePage - 1) * safeLimit;
    
    const [clients, total] = await Promise.all([
      Client.find(filter)
        .sort(sortOptions)
        .skip(skip)
        .limit(safeLimit)
        .lean(),
      Client.countDocuments(filter)
    ]);

    if (groupByClient === 'true') {
      const clientIds = clients.map(client => client._id);
      const taskCounts = await ClientTask.aggregate([
        { $match: { clientId: { $in: clientIds } } },
        {
          $group: {
            _id: '$clientId',
            total: { $sum: 1 },
            completed: { $sum: { $cond: [{ $eq: ['$completed', true] }, 1, 0] } },
            pending: { $sum: { $cond: [{ $eq: ['$completed', true] }, 0, 1] } }
          }
        }
      ]);
      const taskSummaryByClient = taskCounts.reduce((acc, item) => {
        acc[String(item._id)] = item;
        return acc;
      }, {});
      const groupedMap = new Map();

      clients.forEach(companyClient => {
        const key = String(companyClient.parentClientId || companyClient.parentClientName || companyClient.client || companyClient._id);
        const latestSubscription = getLatestSubscription(companyClient);
        const revenue = getClientRevenueTotal(companyClient);
        const isExpired = latestSubscription?.endDate
          ? new Date(latestSubscription.endDate) < new Date()
          : companyClient.status !== 'Active';

        if (!groupedMap.has(key)) {
          groupedMap.set(key, {
            _id: companyClient.parentClientId || companyClient._id,
            client: companyClient.parentClientName || companyClient.client,
            companyCode: companyClient.companyCode,
            totalCompanies: 0,
            activeCompanies: 0,
            expiredCompanies: 0,
            totalRevenue: 0,
            companies: []
          });
        }

        const group = groupedMap.get(key);
        group.totalCompanies += 1;
        group.activeCompanies += companyClient.status === 'Active' && !isExpired ? 1 : 0;
        group.expiredCompanies += isExpired ? 1 : 0;
        group.totalRevenue += revenue;
        group.companies.push(toCompanyCard(companyClient, taskSummaryByClient[String(companyClient._id)]));
      });

      return res.json({
        success: true,
        data: Array.from(groupedMap.values()),
        count: groupedMap.size,
        total,
        pagination: buildPaginationMeta({ page: safePage, limit: safeLimit, total })
      });
    }

    res.json({
      success: true,
      data: clients,
      count: clients.length,
      total,
      pagination: buildPaginationMeta({ page: safePage, limit: safeLimit, total })
    });
  } catch (error) {
    console.error('❌ Error fetching clients:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching clients',
      error: error.message
    });
  }
};

const getClientById = async (req, res) => {
  void 0;
  try {
    const { id } = req.params;
    
    const client = await Client.findById(id).lean();
    if (!client) {
      console.warn('⚠️ Client not found with id:', id);
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    res.json({
      success: true,
      data: client
    });
  } catch (error) {
    console.error('❌ Error fetching client:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching client',
      error: error.message
    });
  }
};

const getClientCompanies = async (req, res) => {
  try {
    const { clientId } = req.params;
    const parentClient = await Client.findById(clientId).lean();

    if (!parentClient) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    const companies = await Client.find(getClientCompanyFilter(parentClient))
      .sort({ company: 1, createdAt: -1 })
      .lean();
    const clientIds = companies.map(company => company._id);
    const taskCounts = await ClientTask.aggregate([
      { $match: { clientId: { $in: clientIds } } },
      {
        $group: {
          _id: '$clientId',
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$completed', true] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$completed', true] }, 0, 1] } }
        }
      }
    ]);
    const taskSummaryByClient = taskCounts.reduce((acc, item) => {
      acc[String(item._id)] = item;
      return acc;
    }, {});

    res.json({
      success: true,
      data: companies.map(company => toCompanyCard(company, taskSummaryByClient[String(company._id)])),
      count: companies.length
    });
  } catch (error) {
    console.error('Error fetching client companies:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching companies',
      error: error.message
    });
  }
};

const getCompanyById = async (req, res) => {
  req.params.id = req.params.companyId;
  return getClientById(req, res);
};

const addClientCompany = async (req, res) => {
  try {
    const { clientId } = req.params;
    const parentClient = await Client.findById(clientId).lean();

    if (!parentClient) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    req.body = {
      ...req.body,
      client: parentClient.client,
      parentClientId: parentClient.parentClientId || parentClient._id,
      parentClientName: parentClient.parentClientName || parentClient.client,
      companyCode: req.body.companyCode || parentClient.companyCode,
      projectManager: req.body.projectManager || parentClient.projectManager || [],
      city: req.body.city || parentClient.city
    };

    return addClient(req, res);
  } catch (error) {
    console.error('Error adding client company:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding company',
      error: error.message
    });
  }
};

const updateCompany = async (req, res) => {
  req.params.id = req.params.companyId;
  return updateClient(req, res);
};

const deleteCompany = async (req, res) => {
  req.params.id = req.params.companyId;
  return deleteClient(req, res);
};

const addClient = async (req, res) => {
  void 0;
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    await ensureClientMultiCompanyIndexes();
    const {
      client,
      company,
      city,
      companyCode,
      projectManager,
      services,
      status,
      progress,
      email,
      phone,
      address,
      description,
      notes,
      clientPlanId,
      subscription,
      parentClientId,
      parentClientName,
      companyLogo,
      industry,
      gst,
      pan,
      website,
      state,
      country,
      pincode
    } = req.body;

    void 0;

    
    const errors = [];
    
    if (!client || client.trim().length === 0) {
      errors.push('Client name is required');
    }
    
    if (!company || company.trim().length === 0) {
      errors.push('Company name is required');
    }
    
    if (!city || city.trim().length === 0) {
      errors.push('City is required');
    }
    
    if (!companyCode || companyCode.trim().length === 0) {
      errors.push('Company code is required');
    }
    
    if (!projectManager || !Array.isArray(projectManager) || projectManager.length === 0) {
      errors.push('At least one project manager is required');
    } else {
      const validManagers = projectManager.filter(manager => 
        manager && typeof manager === 'string' && manager.trim().length > 0
      );
      
      if (validManagers.length === 0) {
        errors.push('Valid project managers are required');
      }
    }
    
    if (errors.length > 0) {
      console.warn('⚠️ Validation errors:', errors);
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    const cleanCompanyCode = normalizeCompanyCode(companyCode);
    const cleanClientName = normalizeName(client);
    const cleanCompanyName = normalizeName(company);
    const cleanCity = normalizeName(city);
    const cleanProjectManagers = projectManager.map(manager => normalizeName(manager));
    let selectedClientPlan = null;
    if (clientPlanId) {
      selectedClientPlan = await ClientPlan.findOne({
        _id: clientPlanId,
        companyCode: cleanCompanyCode,
        isActive: true
      }).session(session);
      if (!selectedClientPlan) {
        await session.abortTransaction();
        return res.status(404).json({
          success: false,
          message: 'Selected client plan not found'
        });
      }
    }
    const finalServices = selectedClientPlan ? getPlanServiceNames(selectedClientPlan) : (services || []);
    const requestedParentId = parentClientId ? String(parentClientId) : '';
    const requestedParentName = normalizeName(parentClientName) || cleanClientName;
    const isSameParentClient = existing => {
      const existingParentId = existing.parentClientId ? String(existing.parentClientId) : '';
      const existingParentName = normalizeName(existing.parentClientName) || existing.client;
      return (
        String(existing._id) === requestedParentId ||
        (requestedParentId && existingParentId === requestedParentId) ||
        String(existing.client || '').toLowerCase() === cleanClientName.toLowerCase() ||
        String(existingParentName || '').toLowerCase() === requestedParentName.toLowerCase()
      );
    };

    
    const existingClient = await Client.findOne({
      client: { $regex: `^${escapeRegExp(cleanClientName)}$`, $options: 'i' },
      company: { $regex: `^${escapeRegExp(cleanCompanyName)}$`, $options: 'i' },
      companyCode: cleanCompanyCode
    }).session(session);

    if (existingClient) {
      console.warn('⚠️ Client already exists:', existingClient._id);
      await session.abortTransaction();
      return sendConflict(res, 'This client already exists for this company.', 'client');
    }

    
    let cleanEmail = normalizeEmail(email) || '';
    let reusableClientUser = null;
    if (cleanEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(cleanEmail)) {
        console.warn('⚠️ Invalid email format:', cleanEmail);
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Invalid email format"
        });
      }
      const existingClientsWithEmail = await Client.find({
        email: cleanEmail,
        companyCode: cleanCompanyCode
      }).session(session);
      const emailBelongsToDifferentClient = existingClientsWithEmail.some(existing => !isSameParentClient(existing));
      if (emailBelongsToDifferentClient) {
        console.warn('Client email already in use by another client:', cleanEmail);
        await session.abortTransaction();
        return sendConflict(res, 'This email is already used by another client.', 'email');
      }

      const existingUser = await User.findOne({
        email: cleanEmail,
        companyCode: cleanCompanyCode
      }).session(session);
      if (existingUser) {
        if (existingClientsWithEmail.length > 0 && String(existingUser.companyRole || '').toLowerCase() === 'client') {
          reusableClientUser = existingUser;
        } else {
          console.warn('Email already in use:', cleanEmail);
          await session.abortTransaction();
          return sendConflict(res, 'This email is already registered. Please use another email.', 'email');
        }
      }
    } else {
      const clientSlug = cleanClientName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const companySlug = cleanCompanyName.toLowerCase().replace(/[^a-z0-9]/g, '');
      const emailBase = [clientSlug, companySlug].filter(Boolean).join('-') || `client-${Date.now()}`;
      const emailDomain = `${cleanCompanyCode.toLowerCase()}.com`;
      cleanEmail = `${emailBase}@${emailDomain}`;
      void 0;

      let suffix = 1;
      while (
        await User.findOne({ email: cleanEmail }).session(session) ||
        await Client.findOne({ email: cleanEmail }).session(session)
      ) {
        suffix += 1;
        cleanEmail = `${emailBase}-${suffix}@${emailDomain}`;
      }
    }

    
    if (finalServices && finalServices.length > 0) {
      const serviceNames = finalServices.filter(s => s && typeof s === 'string' && s.trim().length > 0);
      if (serviceNames.length > 0) {
        const existingServices = await Service.find({ 
          servicename: { $in: serviceNames },
          companyCode: cleanCompanyCode
        }).session(session);
        
        if (existingServices.length !== serviceNames.length) {
          const missingServices = serviceNames.filter(name => 
            !existingServices.some(s => s.servicename === name)
          );
          
          console.warn('⚠️ Missing services:', missingServices);
          await session.abortTransaction();
          return res.status(400).json({
            success: false,
            message: 'Some services do not exist for this company',
            missingServices
          });
        }
      }
    }

    
    const departmentExists = await Department.findById(DEFAULT_CLIENT_DEPARTMENT_ID).session(session);
    if (!departmentExists) {
      console.error('❌ Default department not found:', DEFAULT_CLIENT_DEPARTMENT_ID);
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Default department not found for client",
        departmentId: DEFAULT_CLIENT_DEPARTMENT_ID
      });
    }

    
    const jobRoleExists = await JobRole.findById(DEFAULT_CLIENT_JOB_ROLE_ID).session(session);
    if (!jobRoleExists) {
      console.error('❌ Default job role not found:', DEFAULT_CLIENT_JOB_ROLE_ID);
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Default job role not found for client",
        jobRoleId: DEFAULT_CLIENT_JOB_ROLE_ID
      });
    }

    
    void 0;
    
    const companyExists = await Company.findOne({ companyCode: cleanCompanyCode }).session(session);
    if (!companyExists) {
      console.error('❌ Company not found with code:', companyCode);
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Company not found"
      });
    }

    
    const generatePassword = (name) => {
      const baseName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const randomNum = Math.floor(1000 + Math.random() * 9000);
      return `${baseName}@${randomNum}`;
    };

    const autoPassword = reusableClientUser ? '' : generatePassword(client);
    
    
    const employeeId = `CLT${Date.now()}${Math.floor(Math.random() * 1000)}`;

    
    const currentUserId = req.user?.id || null;

    
    let createdUser = reusableClientUser;
    if (!createdUser) {
    const userData = {
      name: client.trim(),
      email: cleanEmail,
      password: autoPassword,
      department: DEFAULT_CLIENT_DEPARTMENT_ID,
      jobRole: DEFAULT_CLIENT_JOB_ROLE_ID,
      company: companyExists._id,
      companyCode: cleanCompanyCode,
      employeeId,
      phone: phone?.trim() || '',
      address: address?.trim() || '',
      gender: 'other',
      maritalStatus: 'single',
      dob: null,
      salary: null,
      accountNumber: '',
      ifsc: '',
      bankName: '',
      bankHolderName: '',
      employeeType: 'client', 
      companyRole: 'client',
      properties: [],
      propertyOwned: '',
      additionalDetails: JSON.stringify({
        clientId: null,
        isClientRepresentative: true,
        companyName: cleanCompanyName,
        city: cleanCity
      }),
      fatherName: '',
      motherName: '',
      emergencyName: '',
      emergencyPhone: '',
      emergencyRelation: '',
      emergencyAddress: '',
      isActive: true,
      isVerified: false,
      verificationToken: crypto.randomBytes(32).toString('hex'),
      createdBy: currentUserId
    };

    const createdUsers = await User.create([userData], { session });
    createdUser = createdUsers[0];
    }
    void 0;

    
    let subscriptionArray = [];
    if (subscription && Array.isArray(subscription) && subscription.length > 0) {
      subscriptionArray = subscription.map((sub, index) => createSubscriptionFromInput({
        sub,
        plan: selectedClientPlan,
        fallbackNo: index + 1
      }));
      void 0;
    }

    
    const newClient = new Client({
      client: cleanClientName,
      parentClientId: parentClientId || null,
      parentClientName: normalizeName(parentClientName) || cleanClientName,
      company: cleanCompanyName,
      companyLogo: companyLogo ? companyLogo.trim() : '',
      industry: industry ? industry.trim() : '',
      gst: gst ? gst.trim().toUpperCase() : '',
      pan: pan ? pan.trim().toUpperCase() : '',
      website: website ? website.trim() : '',
      state: state ? state.trim() : '',
      country: country ? country.trim() : '',
      pincode: pincode ? pincode.trim() : '',
      city: cleanCity,
      companyCode: cleanCompanyCode,
      projectManager: cleanProjectManagers,
      services: finalServices || [],
      activeClientPlan: selectedClientPlan?._id || null,
      status: status || 'Active',
      progress: progress || '0/0 (0%)',
      email: cleanEmail,
      phone: phone ? phone.trim() : '',
      address: address ? address.trim() : '',
      description: description ? description.trim() : '',
      notes: notes ? notes.trim() : '',
      subscription: subscriptionArray,
      userId: createdUser._id
    });

    await newClient.save({ session });
    if (selectedClientPlan && newClient.subscription.length > 0) {
      await generateTasksForSubscription({
        client: newClient,
        subscription: newClient.subscription[newClient.subscription.length - 1],
        plan: selectedClientPlan,
        session
      });
    }
    void 0;
    void 0;

    
    const updatedAdditionalDetails = JSON.parse(createdUser.additionalDetails || '{}');
    if (!reusableClientUser || !updatedAdditionalDetails.clientId) {
      updatedAdditionalDetails.clientId = newClient._id;
    }
    updatedAdditionalDetails.clientIds = Array.from(new Set([
      ...(Array.isArray(updatedAdditionalDetails.clientIds) ? updatedAdditionalDetails.clientIds.map(String) : []),
      String(newClient._id)
    ]));
    const userLinkUpdate = {
      additionalDetails: JSON.stringify(updatedAdditionalDetails)
    };
    if (!reusableClientUser) {
      userLinkUpdate.employeeType = newClient._id.toString();
    }
    
    await User.findByIdAndUpdate(
      createdUser._id,
      { 
        $set: userLinkUpdate
      },
      { session }
    );

    await session.commitTransaction();
    if (!reusableClientUser) {
      sendWelcomeEmail(cleanEmail, cleanClientName, cleanCompanyName, autoPassword, cleanCompanyCode)
        .then(result => {
          if (result.success) {
            void 0;
          } else {
            console.warn('Welcome email sending failed:', result.error);
          }
        })
        .catch(err => {
          console.error('Unexpected error in email sending:', err);
        });
    }

    res.status(201).json({
      success: true,
      message: reusableClientUser
        ? 'Client company added successfully. Existing client email account reused.'
        : 'Client added successfully. User account created with auto-generated password.',
      data: {
        client: newClient,
        user: {
          id: createdUser._id,
          employeeId: createdUser.employeeId,
          name: createdUser.name,
          email: createdUser.email,
          autoPassword: autoPassword || undefined,
          reused: Boolean(reusableClientUser)
        }
      }
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Error adding client:', error);
    
    if (error.code === 11000) {
      console.error('❌ Duplicate key error:', error.keyValue);
      if (error.keyValue?.email) {
        return sendConflict(res, 'This email is already registered. Please use another email.', 'email');
      }
      if (error.keyPattern?.client && error.keyPattern?.companyCode && !error.keyPattern?.company) {
        clientMultiCompanyIndexPromise = null;
        await ensureClientMultiCompanyIndexes();
        return sendConflict(
          res,
          'Old client index was refreshed. Please retry adding this company once.',
          'client'
        );
      }
      return sendConflict(res, 'This client already exists for this company.', 'client');
    }
    
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      console.error('❌ Validation errors:', errors);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error adding client',
      error: error.message
    });
  } finally {
    session.endSession();
  }
};

const updateClient = async (req, res) => {
  void 0;
  try {
    const { id } = req.params;
    const {
      client,
      company,
      city,
      companyCode,
      parentClientId,
      parentClientName,
      companyLogo,
      industry,
      gst,
      pan,
      website,
      state,
      country,
      pincode,
      projectManager,
      services,
      status,
      progress,
      email,
      phone,
      address,
      description,
      notes,
      subscription
    } = req.body;

    const existingClient = await Client.findById(id);
    if (!existingClient) {
      console.warn('⚠️ Client not found for update:', id);
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    const errors = [];
    
    if (client !== undefined && (!client || client.trim().length === 0)) {
      errors.push('Client name cannot be empty');
    }
    
    if (company !== undefined && (!company || company.trim().length === 0)) {
      errors.push('Company name cannot be empty');
    }
    
    if (city !== undefined && (!city || city.trim().length === 0)) {
      errors.push('City cannot be empty');
    }
    
    if (companyCode !== undefined && (!companyCode || companyCode.trim().length === 0)) {
      errors.push('Company code cannot be empty');
    }
    
    if (projectManager !== undefined) {
      if (!Array.isArray(projectManager) || projectManager.length === 0) {
        errors.push('At least one project manager is required');
      } else {
        const validManagers = projectManager.filter(manager => 
          manager && typeof manager === 'string' && manager.trim().length > 0
        );
        
        if (validManagers.length === 0) {
          errors.push('Valid project managers are required');
        }
      }
    }
    
    if (errors.length > 0) {
      console.warn('⚠️ Validation errors:', errors);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    if (client !== undefined && companyCode !== undefined) {
      const duplicateClient = await Client.findOne({
        _id: { $ne: id },
        client: { $regex: `^${escapeRegExp(client.trim())}$`, $options: 'i' },
        companyCode: companyCode.trim().toUpperCase()
      });

      if (duplicateClient) {
        console.warn('⚠️ Duplicate client name:', client);
        return res.status(400).json({
          success: false,
          message: 'Client name already exists for this company'
        });
      }
    }

    if (services !== undefined) {
      const serviceNames = services.filter(s => s && typeof s === 'string' && s.trim().length > 0);
      if (serviceNames.length > 0) {
        const companyCodeToUse = companyCode || existingClient.companyCode;
        const existingServices = await Service.find({ 
          servicename: { $in: serviceNames },
          companyCode: companyCodeToUse.trim().toUpperCase()
        });
        
        if (existingServices.length !== serviceNames.length) {
          const missingServices = serviceNames.filter(name => 
            !existingServices.some(s => s.servicename === name)
          );
          
          console.warn('⚠️ Missing services:', missingServices);
          return res.status(400).json({
            success: false,
            message: 'Some services do not exist for this company',
            missingServices
          });
        }
      }
    }

    if (email !== undefined) {
      const cleanEmail = normalizeEmail(email) || '';
      if (cleanEmail) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(cleanEmail)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid email format',
            field: 'email'
          });
        }

        if (cleanEmail !== existingClient.email) {
          const duplicateClientEmail = await Client.findOne({
            _id: { $ne: id },
            email: cleanEmail
          });

          if (duplicateClientEmail) {
            return sendConflict(res, 'This email is already used by another client.', 'email');
          }

          const duplicateUserEmail = await User.findOne({ email: cleanEmail });
          if (duplicateUserEmail) {
            return sendConflict(res, 'This email is already registered. Please use another email.', 'email');
          }
        }
      }
    }

    
    const updateData = {};
    
    if (client !== undefined) updateData.client = client.trim();
    if (company !== undefined) updateData.company = company.trim();
    if (parentClientId !== undefined) updateData.parentClientId = parentClientId || null;
    if (parentClientName !== undefined) updateData.parentClientName = parentClientName.trim();
    if (companyLogo !== undefined) updateData.companyLogo = companyLogo.trim();
    if (industry !== undefined) updateData.industry = industry.trim();
    if (gst !== undefined) updateData.gst = gst.trim().toUpperCase();
    if (pan !== undefined) updateData.pan = pan.trim().toUpperCase();
    if (website !== undefined) updateData.website = website.trim();
    if (state !== undefined) updateData.state = state.trim();
    if (country !== undefined) updateData.country = country.trim();
    if (pincode !== undefined) updateData.pincode = pincode.trim();
    if (city !== undefined) updateData.city = city.trim();
    if (companyCode !== undefined) updateData.companyCode = companyCode.trim().toUpperCase();
    
    if (projectManager !== undefined) {
      updateData.projectManager = projectManager
        .filter(manager => manager && typeof manager === 'string' && manager.trim().length > 0)
        .map(manager => manager.trim());
    }
    
    if (services !== undefined) updateData.services = services;
    if (status !== undefined) updateData.status = status;
    if (progress !== undefined) updateData.progress = progress;
    if (email !== undefined) updateData.email = normalizeEmail(email) || '';
    if (phone !== undefined) updateData.phone = phone.trim();
    if (address !== undefined) updateData.address = address.trim();
    if (description !== undefined) updateData.description = description.trim();
    if (notes !== undefined) updateData.notes = notes.trim();
    
    if (subscription !== undefined) {
      void 0;
      
      if (Array.isArray(subscription) && subscription.length > 0) {
        const formattedSubscription = subscription.map(sub => ({
          startDate: sub.startDate ? new Date(sub.startDate) : null,
          endDate: sub.endDate ? new Date(sub.endDate) : null,
          price: sub.price || 0,
          status: sub.status || 'Active'
        }));
        updateData.subscription = formattedSubscription;
        void 0;
      } else if (subscription !== null && subscription.length === 0) {
        updateData.subscription = [];
        void 0;
      }
    }

    const updatedClient = await Client.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    void 0;
    void 0;
    
    res.json({
      success: true,
      message: 'Client updated successfully',
      data: updatedClient
    });
  } catch (error) {
    console.error('❌ Error updating client:', error);
    
    if (error.code === 11000) {
      if (error.keyValue?.email) {
        return sendConflict(res, 'This email is already registered. Please use another email.', 'email');
      }
      return sendConflict(res, 'Client name already exists for this company.', 'client');
    }
    
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error updating client',
      error: error.message
    });
  }
};

const updateClientProgress = async (req, res) => {
  void 0;
  try {
    const { id } = req.params;
    const { completed, total } = req.body;

    if (completed === undefined || total === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Completed and total values are required'
      });
    }

    const client = await Client.findById(id);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    await client.updateProgress(parseInt(completed), parseInt(total));

    res.json({
      success: true,
      message: 'Client progress updated successfully',
      data: client
    });
  } catch (error) {
    console.error('❌ Error updating client progress:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating client progress',
      error: error.message
    });
  }
};

const deleteClient = async (req, res) => {
  void 0;
  try {
    const { id } = req.params;
    
    const client = await Client.findByIdAndDelete(id);
    if (!client) {
      console.warn('⚠️ Client not found for deletion:', id);
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    res.json({
      success: true,
      message: 'Client deleted successfully',
      data: client
    });
  } catch (error) {
    console.error('❌ Error deleting client:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting client',
      error: error.message
    });
  }
};

const getClientStats = async (req, res) => {
  void 0;
  try {
    const { companyCode } = req.query;
    
    const stats = await Client.getStats(companyCode);
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('❌ Error fetching client statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching client statistics',
      error: error.message
    });
  }
};

const getManagerStats = async (req, res) => {
  void 0;
  try {
    const { companyCode } = req.query;
    
    const stats = await Client.getManagerStats(companyCode);
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('❌ Error fetching manager statistics:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching manager statistics',
      error: error.message
    });
  }
};

const addProjectManager = async (req, res) => {
  void 0;
  const { id } = req.params;
  const { managerName } = req.body;

  try {
    const client = await Client.findById(id);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    await client.addProjectManager(managerName);

    res.json({
      success: true,
      message: 'Project manager added successfully',
      data: client
    });
  } catch (error) {
    console.error('❌ Error adding project manager:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding project manager',
      error: error.message
    });
  }
};

const removeProjectManager = async (req, res) => {
  void 0;
  const { id } = req.params;
  const { managerName } = req.body;

  try {
    const client = await Client.findById(id);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    await client.removeProjectManager(managerName);

    res.json({
      success: true,
      message: 'Project manager removed successfully',
      data: client
    });
  } catch (error) {
    console.error('❌ Error removing project manager:', error);
    res.status(500).json({
      success: false,
      message: 'Error removing project manager',
      error: error.message
    });
  }
};

const getClientsByCompany = async (req, res) => {
  void 0;
  try {
    const { companyCode } = req.params;
    
    if (!companyCode) {
      return res.status(400).json({
        success: false,
        message: 'Company code is required'
      });
    }

    const { page, limit, skip } = getPaginationOptions(req.query, { limit: 25, maxLimit: 100 });
    const filter = { companyCode: companyCode.toUpperCase() };
    const [clients, total] = await Promise.all([
      Client.find(filter)
        .sort({ client: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Client.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: clients,
      count: clients.length,
      total,
      pagination: buildPaginationMeta({ page, limit, total })
    });
  } catch (error) {
    console.error('❌ Error fetching clients by company:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching clients',
      error: error.message
    });
  }
};

const extendClientSubscription = async (req, res) => {
  try {
    const { id } = req.params;
    const { days = 30, price = 0 } = req.body;

    const client = await Client.findById(id);

    if (!client) {
      return res.status(404).json({ message: "Client not found" });
    }

    const now = new Date();

    let startDate = now;

    if (client.subscription.length > 0) {
      const last = client.subscription[client.subscription.length - 1];

      if (new Date(last.endDate) > now) {
        startDate = new Date(last.endDate);
      }
    }

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + days);

    client.subscription.push({
      startDate,
      endDate,
      price: price,
      status: 'Active'
    });
    client.reminder5DaysSent = false;
    client.reminder3DaysSent = false;
    client.expiredMailSent = false;
    client.expiredReminderLastSentAt = null;

    await client.save();
    const createdSub = client.subscription[client.subscription.length - 1];
    const overdueTaskExtension = await extendOverdueClientTasksToSubscriptionEnd({
      clientId: client._id,
      subscription: createdSub
    });

    res.json({
      success: true,
      message: "Subscription extended successfully",
      data: client,
      overdueTaskExtension
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const renewClientSubscription = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    const { startDate, endDate, price, extraTasks = 0, benefits = '', clientPlanId } = req.body;

    const client = await Client.findById(id).session(session);

    if (!client) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    let selectedClientPlan = null;
    if (clientPlanId) {
      selectedClientPlan = await ClientPlan.findOne({
        _id: clientPlanId,
        companyCode: client.companyCode,
        isActive: true
      }).session(session);
      if (!selectedClientPlan) {
        await session.abortTransaction();
        return res.status(404).json({ success: false, message: "Selected client plan not found" });
      }
    }

    client.subscription.forEach(sub => {
      if (sub.status === 'Active') sub.status = 'Expired';
    });
    client.reminder5DaysSent = false;
    client.reminder3DaysSent = false;
    client.expiredMailSent = false;
    client.expiredReminderLastSentAt = null;

    const subscriptionNo = (client.subscription?.length || 0) + 1;
    const nextSub = createSubscriptionFromInput({
      sub: { startDate, endDate, price, status: 'Active', extraTasks, benefits },
      plan: selectedClientPlan,
      fallbackNo: subscriptionNo
    });

    
    client.subscription.push(nextSub);
    if (selectedClientPlan) {
      client.activeClientPlan = selectedClientPlan._id;
      client.services = getPlanServiceNames(selectedClientPlan);
    }

    await client.save({ session });
    const createdSub = client.subscription[client.subscription.length - 1];
    const overdueTaskExtension = await extendOverdueClientTasksToSubscriptionEnd({
      clientId: client._id,
      subscription: createdSub,
      session
    });

    if (selectedClientPlan) {
      await generateTasksForSubscription({
        client,
        subscription: createdSub,
        plan: selectedClientPlan,
        session
      });
    }

    await session.commitTransaction();
    const updatedClient = await Client.findById(id).lean();

    res.json({
      success: true,
      message: "Subscription renewed successfully",
      data: updatedClient,
      overdueTaskExtension
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Error renewing subscription:', error);
    res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

const addClientDueInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const { title = 'Subscription Due', amount, dueDate, note = '', status = 'Due' } = req.body;

    const client = await Client.findById(id);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    const dueAmount = Number(amount || 0);
    if (!Number.isFinite(dueAmount) || dueAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Please enter a valid due amount' });
    }

    const parsedDueDate = dueDate ? new Date(dueDate) : new Date();
    if (Number.isNaN(parsedDueDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid due date' });
    }

    const allowedStatuses = ['Due', 'Pending Verification', 'Paid', 'Cancelled'];
    const finalStatus = allowedStatuses.includes(status) ? status : 'Due';

    if (!client.dueInvoices) client.dueInvoices = [];
    client.dueInvoices.push({
      title: String(title || 'Subscription Due').trim(),
      amount: dueAmount,
      dueDate: parsedDueDate,
      note: String(note || '').trim(),
      status: finalStatus
    });

    if (finalStatus === 'Due' || finalStatus === 'Pending Verification') {
      client.status = 'On Hold';
    }
    await client.save();

    res.json({
      success: true,
      message: 'Due payment added successfully',
      data: client
    });
  } catch (error) {
    console.error('Error adding client due invoice:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const removeClientSubscription = async (req, res) => {
  try {
    const { id } = req.params;
    const client = await Client.findById(id);

    if (!client) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    client.subscription = [];
    await client.save();

    res.json({
      success: true,
      message: "Subscription removed successfully",
      data: client
    });
  } catch (error) {
    console.error('Error removing subscription:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const uploadClientReceipt = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, transactionId, dueInvoiceId } = req.body;

    const client = await Client.findById(id);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Receipt image file is required' });
    }

    const receiptImage = `uploads/receipts/${req.file.filename}`;

    if (!client.paymentReceipts) {
      client.paymentReceipts = [];
    }

    const receipt = {
      dueInvoiceId: dueInvoiceId || null,
      amount: amount ? parseFloat(amount) : 0,
      transactionId: transactionId || '',
      receiptImage,
      uploadDate: new Date(),
      status: 'Pending'
    };

    client.paymentReceipts.push(receipt);

    const addedReceipt = client.paymentReceipts[client.paymentReceipts.length - 1];
    if (dueInvoiceId && client.dueInvoices) {
      const dueInvoice = client.dueInvoices.id(dueInvoiceId);
      if (dueInvoice) {
        dueInvoice.status = 'Pending Verification';
        dueInvoice.receiptId = addedReceipt._id;
      }
    }

    await client.save();

    res.json({
      success: true,
      message: 'Receipt uploaded successfully',
      data: client
    });
  } catch (error) {
    console.error('Error uploading client receipt:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const updateClientReceiptStatus = async (req, res) => {
  try {
    const { id, receiptId } = req.params;
    const { status, notes = '', activateClient = true, startDate, endDate } = req.body;
    const cleanStatus = String(status || '').trim();

    if (!['Approved', 'Rejected'].includes(cleanStatus)) {
      return res.status(400).json({ success: false, message: 'Status must be Approved or Rejected' });
    }

    const client = await Client.findById(id);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Client not found' });
    }

    const receipt = client.paymentReceipts?.id(receiptId);
    if (!receipt) {
      return res.status(404).json({ success: false, message: 'Receipt not found' });
    }

    receipt.status = cleanStatus;
    receipt.verifiedAt = new Date();
    receipt.notes = String(notes || '').trim();

    let linkedDue = null;
    if (receipt.dueInvoiceId && client.dueInvoices) {
      linkedDue = client.dueInvoices.id(receipt.dueInvoiceId);
    }
    if (!linkedDue && client.dueInvoices) {
      linkedDue = client.dueInvoices.find(invoice => String(invoice.receiptId || '') === String(receipt._id));
    }

    if (linkedDue) {
      linkedDue.status = cleanStatus === 'Approved' ? 'Paid' : 'Due';
      linkedDue.clearedAt = cleanStatus === 'Approved' ? new Date() : undefined;
    }

    let activatedSubscription = null;
    if (cleanStatus === 'Approved' && activateClient) {
      const subStart = startDate ? new Date(startDate) : new Date();
      const subEnd = endDate ? new Date(endDate) : null;
      const latestDueDate = linkedDue?.dueDate ? new Date(linkedDue.dueDate) : null;
      const fallbackEnd = latestDueDate && latestDueDate > subStart
        ? latestDueDate
        : new Date(subStart.getTime() + 30 * 24 * 60 * 60 * 1000);

      client.status = 'Active';
      client.subscription.push({
        startDate: Number.isNaN(subStart.getTime()) ? new Date() : subStart,
        endDate: subEnd && !Number.isNaN(subEnd.getTime()) ? subEnd : fallbackEnd,
        price: Number(receipt.amount || linkedDue?.amount || 0),
        status: 'Active',
        extraTasks: 0,
        benefits: 'Activated after payment verification'
      });
      activatedSubscription = client.subscription[client.subscription.length - 1];
      client.reminder5DaysSent = false;
      client.reminder3DaysSent = false;
      client.expiredMailSent = false;
      client.expiredReminderLastSentAt = null;
    }

    await client.save();
    const overdueTaskExtension = activatedSubscription
      ? await extendOverdueClientTasksToSubscriptionEnd({
        clientId: client._id,
        subscription: activatedSubscription
      })
      : { matchedCount: 0, modifiedCount: 0 };

    res.json({
      success: true,
      message: `Receipt ${cleanStatus.toLowerCase()} successfully`,
      data: client,
      overdueTaskExtension
    });
  } catch (error) {
    console.error('Error updating receipt status:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

const markClientReceiptPaymentDone = async (req, res) => {
  req.body = {
    ...req.body,
    status: 'Approved',
    activateClient: true,
    notes: req.body?.notes || 'Payment status marked done by team'
  };

  return updateClientReceiptStatus(req, res);
};

module.exports = {
  getWelcomeEmailTemplate,
  getCompanyLoginUrl,
  getAllClients,
  getClientById,
  getClientCompanies,
  getCompanyById,
  addClient,
  addClientCompany,
  updateClient,
  updateCompany,
  updateClientProgress,
  deleteClient,
  deleteCompany,
  getClientStats,
  getManagerStats,
  addProjectManager,
  removeProjectManager,
  getClientsByCompany,
  extendClientSubscription,
  renewClientSubscription,
  removeClientSubscription,
  addClientDueInvoice,
  uploadClientReceipt,
  updateClientReceiptStatus,
  markClientReceiptPaymentDone
};

void 0;
