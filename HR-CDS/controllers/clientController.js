// clientController.js
const Client = require('../models/Client');
const Service = require('../models/Service');
const User = require('../../models/User');
const Department = require('../../models/Department');
const JobRole = require('../../models/JobRole');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Company = require('../../models/Company');
const emailService = require('../../services/emailService'); // Import email service

// Default department ID for clients
const DEFAULT_CLIENT_DEPARTMENT_ID = '69ae555c9a1e47e80a40204c';
// Default job role ID for clients
const DEFAULT_CLIENT_JOB_ROLE_ID = '69ae559b9a1e47e80a4020a2';

const normalizeCompanyCode = (companyCode) => companyCode?.trim().toUpperCase();
const normalizeEmail = (email) => email?.trim().toLowerCase();
const normalizeName = (value) => value?.trim();
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const sendConflict = (res, message, field, extra = {}) => {
  return res.status(409).json({
    success: false,
    message,
    field,
    ...extra
  });
};

// Helper function to get welcome email template
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
                    
                    <div class="credential-item">
                        <div class="credential-label">Login URL:</div>
                        <div class="credential-value">${loginUrl}</div>
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

// Helper function to send welcome email using email service
const getCompanyLoginUrl = (companyCode) => {
  const normalizedCompanyCode = companyCode?.trim();
  if (!normalizedCompanyCode) {
    return 'https://cds.ciisnetwork.in/login';
  }

  return `https://cds.ciisnetwork.in/company/${normalizedCompanyCode}/login`;
};

const sendWelcomeEmail = async (email, name, company, password, companyCode) => {
  console.log('📧 ====== SENDING WELCOME EMAIL ======');
  console.log(`📧 To: ${email}`);
  console.log(`📧 Name: ${name}`);
  console.log(`📧 Company: ${company}`);
  console.log(`📧 Company Code: ${companyCode || 'N/A'}`);
  console.log(`📧 Auto-generated password: ${password}`);
  
  const fullLoginUrl = getCompanyLoginUrl(companyCode);
  
  try {
    // Get the email template
    const emailHtml = getWelcomeEmailTemplate(name, company, email, password, fullLoginUrl);
    
    // Send email using the email service
    const result = await emailService.sendEmail(
      email,
      `🎉 Welcome to CIIS NETWORK - Your Account Has Been Created (${company})`,
      emailHtml,
      {
        priority: 'high',
        referenceId: `client-welcome-${Date.now()}`,
        headers: {
          'X-Email-Type': 'client-welcome',
          'X-Company': company,
          'X-Company-Code': companyCode || '',
          'X-User-Email': email
        }
      }
    );
    
    if (result.success) {
      console.log(`✅ Welcome email sent successfully to ${email} | Message ID: ${result.messageId}`);
    } else {
      console.warn(`⚠️ Welcome email sending failed but continuing: ${result.error}`);
    }
    
    return result;
  } catch (error) {
    console.error('❌ Error sending welcome email:', error);
    // Don't throw - email failure shouldn't break client creation
    return { success: false, error: error.message };
  }
};

const getAllClients = async (req, res) => {
  console.log('🔍 getAllClients called with query:', req.query);
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
      companyCode
    } = req.query;

    console.log('🔍 Parsed query params:', { page, limit, sortBy, sortOrder, search, status, projectManager, service, companyCode });

    const filter = {};
    
    if (!companyCode) {
      console.warn('⚠️ No companyCode provided in request');
      return res.status(400).json({
        success: false,
        message: 'Company code is required'
      });
    }
    filter.companyCode = companyCode.toUpperCase();
    console.log('🔍 Filter with companyCode:', filter.companyCode);
    
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
      console.log('🔍 Search filter:', filter.$or);
    }

    const sortOptions = {};
    const validSortFields = ['client', 'company', 'city', 'status', 'createdAt', 'updatedAt'];
    
    if (validSortFields.includes(sortBy)) {
      sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
    } else {
      sortOptions.createdAt = -1;
    }
    console.log('🔍 Sort options:', sortOptions);

    const skip = (parseInt(page) - 1) * parseInt(limit);
    console.log('🔍 Pagination - skip:', skip, 'limit:', limit);
    
    const [clients, total] = await Promise.all([
      Client.find(filter)
        .sort(sortOptions)
        .limit(parseInt(limit))
        .skip(skip)
        .lean(),
      Client.countDocuments(filter)
    ]);

    console.log(`✅ Found ${clients.length} clients out of ${total} total`);

    res.json({
      success: true,
      data: clients,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
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
  console.log('🔍 getClientById called with id:', req.params.id);
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

    console.log('✅ Client found:', client._id);
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

const addClient = async (req, res) => {
  console.log('🔍 addClient called with body:', req.body);
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
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
      subscription  
    } = req.body;

    console.log('🔍 Processing client data:', {
      client,
      company,
      city,
      companyCode,
      projectManager,
      services,
      email,
      phone,
      subscription: subscription  // ✅ YEH CHECK KARNE KE LIYE
    });

    // Validation
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

    // Check if client already exists for this company
    const existingClient = await Client.findOne({
      client: { $regex: `^${escapeRegExp(cleanClientName)}$`, $options: 'i' },
      companyCode: cleanCompanyCode
    }).session(session);

    if (existingClient) {
      console.warn('⚠️ Client already exists:', existingClient._id);
      await session.abortTransaction();
      return sendConflict(res, 'This client already exists for this company.', 'client');
    }

    // Check if email is already in use (if email provided)
    let cleanEmail = normalizeEmail(email) || '';
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

      const existingUser = await User.findOne({ email: cleanEmail }).session(session);
      if (existingUser) {
        console.warn('⚠️ Email already in use:', cleanEmail);
        await session.abortTransaction();
        return sendConflict(res, 'This email is already registered. Please use another email.', 'email');
      }

      const existingClientEmail = await Client.findOne({ email: cleanEmail }).session(session);
      if (existingClientEmail) {
        console.warn('⚠️ Client email already in use:', cleanEmail);
        await session.abortTransaction();
        return sendConflict(res, 'This email is already used by another client.', 'email');
      }
    } else {
      // Generate email if not provided
      cleanEmail = `${cleanClientName.toLowerCase().replace(/[^a-z0-9]/g, '')}@${cleanCompanyCode.toLowerCase()}.com`;
      console.log('🔍 Generated email:', cleanEmail);

      const existingGeneratedEmail = await User.findOne({ email: cleanEmail }).session(session);
      const existingGeneratedClientEmail = await Client.findOne({ email: cleanEmail }).session(session);
      if (existingGeneratedEmail || existingGeneratedClientEmail) {
        console.warn('⚠️ Generated email already in use:', cleanEmail);
        await session.abortTransaction();
        return sendConflict(
          res,
          `Generated email ${cleanEmail} already exists. Please enter a unique client email manually.`,
          'email',
          { generatedEmail: cleanEmail }
        );
      }
    }

    // Validate services exist if provided
    if (services && services.length > 0) {
      const serviceNames = services.filter(s => s && typeof s === 'string' && s.trim().length > 0);
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

    // Check if default department exists
    console.log('🔍 Checking default department:', DEFAULT_CLIENT_DEPARTMENT_ID);
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
    console.log('✅ Default department found');

    // Check if default job role exists
    console.log('🔍 Checking default job role:', DEFAULT_CLIENT_JOB_ROLE_ID);
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
    console.log('✅ Default job role found');

    // Get company ID from companyCode
    console.log('🔍 Finding company with code:', companyCode);
    
    const companyExists = await Company.findOne({ companyCode: cleanCompanyCode }).session(session);
    if (!companyExists) {
      console.error('❌ Company not found with code:', companyCode);
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Company not found"
      });
    }
    console.log('✅ Company found:', companyExists._id);

    // Generate password from client name
    const generatePassword = (name) => {
      const baseName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const randomNum = Math.floor(1000 + Math.random() * 9000);
      return `${baseName}@${randomNum}`;
    };

    const autoPassword = generatePassword(client);
    console.log('🔍 Generated auto password for user');
    
    // Generate employee ID for user
    const employeeId = `CLT${Date.now()}${Math.floor(Math.random() * 1000)}`;
    console.log('🔍 Generated employee ID:', employeeId);

    // Get current user from request (if authenticated)
    const currentUserId = req.user?.id || null;

    // Create user first (as client representative)
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

    console.log('🔍 Creating user with data:', { ...userData, password: '[HIDDEN]' });

    // Create user in session
    const createdUsers = await User.create([userData], { session });
    const createdUser = createdUsers[0];
    console.log('✅ User created successfully:', createdUser._id);

    // Clean project managers
    const cleanProjectManagers = projectManager
      .filter(manager => manager && typeof manager === 'string' && manager.trim().length > 0)
      .map(manager => manager.trim());
    
    // ✅ SUBSCRIPTION ARRAY BANANE KA SAHI TARIKA
    let subscriptionArray = [];
    if (subscription && Array.isArray(subscription) && subscription.length > 0) {
      subscriptionArray = subscription.map(sub => ({
        startDate: new Date(sub.startDate),
        endDate: new Date(sub.endDate),
        status: sub.status || 'Active'
      }));
      console.log('✅ Subscription array created:', subscriptionArray);
    } else {
      console.log('⚠️ No subscription data received, keeping empty array');
    }

    // Create new client with subscription
    const newClient = new Client({
      client: cleanClientName,
      company: cleanCompanyName,
      city: cleanCity,
      companyCode: cleanCompanyCode,
      projectManager: cleanProjectManagers,
      services: services || [],
      status: status || 'Active',
      progress: progress || '0/0 (0%)',
      email: cleanEmail,
      phone: phone ? phone.trim() : '',
      address: address ? address.trim() : '',
      description: description ? description.trim() : '',
      notes: notes ? notes.trim() : '',
      subscription: subscriptionArray,  // ✅ YEH SAVE HOGA
      userId: createdUser._id
    });

    console.log('🔍 Creating client with subscription:', subscriptionArray);
    await newClient.save({ session });
    console.log('✅ Client created successfully with ID:', newClient._id);
    console.log('✅ Client subscription saved:', newClient.subscription);

    // Update user's additionalDetails with client ID
    const updatedAdditionalDetails = JSON.parse(createdUser.additionalDetails || '{}');
    updatedAdditionalDetails.clientId = newClient._id;
    
    await User.findByIdAndUpdate(
      createdUser._id,
      { 
        $set: { 
          'additionalDetails': JSON.stringify(updatedAdditionalDetails),
          employeeType: newClient._id.toString()
        } 
      },
      { session }
    );
    console.log('✅ User updated with client reference');

    // Commit transaction
    await session.commitTransaction();
    console.log('✅ Transaction committed successfully');

    // Send welcome email with auto-generated password
    sendWelcomeEmail(cleanEmail, cleanClientName, cleanCompanyName, autoPassword, cleanCompanyCode)
      .then(result => {
        if (result.success) {
          console.log('✅ Welcome email sent successfully');
        } else {
          console.warn('⚠️ Welcome email sending failed:', result.error);
        }
      })
      .catch(err => {
        console.error('❌ Unexpected error in email sending:', err);
      });

    console.log('✅ Client and user created successfully');
    res.status(201).json({
      success: true,
      message: 'Client added successfully. User account created with auto-generated password.',
      data: {
        client: newClient,
        user: {
          id: createdUser._id,
          employeeId: createdUser.employeeId,
          name: createdUser.name,
          email: createdUser.email,
          autoPassword: autoPassword
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
    console.log('🔍 Database session ended');
  }
};

const updateClient = async (req, res) => {
  console.log('🔍 updateClient called with id:', req.params.id, 'body:', req.body);
  try {
    const { id } = req.params;
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
      subscriptionStartDate,
      subscriptionEndDate
    } = req.body;

    // Find client
    const existingClient = await Client.findById(id);
    if (!existingClient) {
      console.warn('⚠️ Client not found for update:', id);
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    // Validation
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

    // Check if client name already exists for this company (if updating client name)
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

    // Validate services if being updated
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

    // Build update object
    const updateData = {};
    
    if (client !== undefined) updateData.client = client.trim();
    if (company !== undefined) updateData.company = company.trim();
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
    
    // Handle subscription update
    if (subscriptionStartDate && subscriptionEndDate) {
      updateData.subscription = [
        {
          startDate: new Date(subscriptionStartDate),
          endDate: new Date(subscriptionEndDate),
          status: 'Active'
        }
      ];
      console.log('🔍 Updating subscription:', updateData.subscription);
    }

    console.log('🔍 Update data:', updateData);

    // Update client
    const updatedClient = await Client.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    console.log('✅ Client updated successfully:', updatedClient._id);
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
  console.log('🔍 updateClientProgress called with id:', req.params.id, 'body:', req.body);
  try {
    const { id } = req.params;
    const { completed, total } = req.body;

    if (completed === undefined || total === undefined) {
      console.warn('⚠️ Missing completed or total values');
      return res.status(400).json({
        success: false,
        message: 'Completed and total values are required'
      });
    }

    const client = await Client.findById(id);
    if (!client) {
      console.warn('⚠️ Client not found:', id);
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    await client.updateProgress(parseInt(completed), parseInt(total));
    console.log('✅ Progress updated for client:', id);

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
  console.log('🔍 deleteClient called with id:', req.params.id);
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

    console.log('✅ Client deleted successfully:', id);
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
  console.log('🔍 getClientStats called with query:', req.query);
  try {
    const { companyCode } = req.query;
    
    const stats = await Client.getStats(companyCode);
    console.log('✅ Client stats:', stats);
    
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
  console.log('🔍 getManagerStats called with query:', req.query);
  try {
    const { companyCode } = req.query;
    
    const stats = await Client.getManagerStats(companyCode);
    console.log('✅ Manager stats:', stats);
    
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
  console.log('🔍 addProjectManager called with id:', req.params.id, 'body:', req.body);
  const { id } = req.params;
  const { managerName } = req.body;

  try {
    const client = await Client.findById(id);
    if (!client) {
      console.warn('⚠️ Client not found:', id);
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    await client.addProjectManager(managerName);
    console.log('✅ Project manager added to client:', id);

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
  console.log('🔍 removeProjectManager called with id:', req.params.id, 'body:', req.body);
  const { id } = req.params;
  const { managerName } = req.body;

  try {
    const client = await Client.findById(id);
    if (!client) {
      console.warn('⚠️ Client not found:', id);
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    await client.removeProjectManager(managerName);
    console.log('✅ Project manager removed from client:', id);

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

// Get clients by company code
const getClientsByCompany = async (req, res) => {
  console.log('🔍 getClientsByCompany called with companyCode:', req.params.companyCode);
  try {
    const { companyCode } = req.params;
    
    if (!companyCode) {
      console.warn('⚠️ No companyCode provided');
      return res.status(400).json({
        success: false,
        message: 'Company code is required'
      });
    }

    const clients = await Client.find({ 
      companyCode: companyCode.toUpperCase() 
    }).sort({ client: 1 });

    console.log(`✅ Found ${clients.length} clients for company ${companyCode}`);
    res.json({
      success: true,
      data: clients,
      count: clients.length
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
    const { days = 30 } = req.body;

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
      status: 'Active'
    });

    await client.save();

    res.json({
      success: true,
      message: "Subscription extended successfully",
      data: client
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getAllClients,
  getClientById,
  addClient,
  updateClient,
  updateClientProgress,
  deleteClient,
  getClientStats,
  getManagerStats,
  addProjectManager,
  removeProjectManager,
  getClientsByCompany,
  extendClientSubscription
};

console.log("✅ clientController.js loaded successfully with auto-user creation and email integration");