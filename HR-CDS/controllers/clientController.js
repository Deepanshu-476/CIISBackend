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
const emailService = require('../../services/emailService'); 
const multer = require('multer');
const path = require('path');// Import email service

// Default department ID for clients
const DEFAULT_CLIENT_DEPARTMENT_ID = '69ae555c9a1e47e80a40204c';
// Default job role ID for clients
const DEFAULT_CLIENT_JOB_ROLE_ID = '69ae559b9a1e47e80a4020a2';

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
const sendWelcomeEmail = async (email, name, company, password) => {
  console.log('📧 ====== SENDING WELCOME EMAIL ======');
  console.log(`📧 To: ${email}`);
  console.log(`📧 Name: ${name}`);
  console.log(`📧 Company: ${company}`);
  console.log(`📧 Auto-generated password: ${password}`);
  
  const loginUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
  const fullLoginUrl = `${loginUrl}/login`;
  
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

// ================= UPLOAD RECEIPT STORAGE =================

const storage = multer.diskStorage({

  destination: (req, file, cb) => {
    cb(null, 'uploads/receipts');
  },

  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }

});

const upload = multer({ storage });

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
      companyCode // Add companyCode filter
    } = req.query;

    console.log('🔍 Parsed query params:', { page, limit, sortBy, sortOrder, search, status, projectManager, service, companyCode });

    // Build filter object
    const filter = {};
    
    // ✅ Add companyCode filter (mandatory)
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
    
    // Enhanced search functionality
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

    // Sort options
    const sortOptions = {};
    const validSortFields = ['client', 'company', 'city', 'status', 'createdAt', 'updatedAt'];
    
    if (validSortFields.includes(sortBy)) {
      sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
    } else {
      sortOptions.createdAt = -1;
    }
    console.log('🔍 Sort options:', sortOptions);

    // Execute query with pagination
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
      notes
    } = req.body;

    console.log('🔍 Processing client data:', {
      client,
      company,
      city,
      companyCode,
      projectManager,
      services,
      email,
      phone
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

    // Check if client already exists for this company
    const existingClient = await Client.findOne({
      client: client.trim(),
      companyCode: companyCode.trim().toUpperCase()
    }).session(session);

    if (existingClient) {
      console.warn('⚠️ Client already exists:', existingClient._id);
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: 'Client already exists for this company'
      });
    }

    // Check if email is already in use (if email provided)
    let cleanEmail = email ? email.trim().toLowerCase() : '';
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
        return res.status(409).json({
          success: false,
          message: "Email already in use"
        });
      }
    } else {
      // Generate email if not provided
      cleanEmail = `${client.toLowerCase().replace(/[^a-z0-9]/g, '')}@${companyCode.toLowerCase()}.com`;
      console.log('🔍 Generated email:', cleanEmail);
    }

    // Validate services exist if provided
    if (services && services.length > 0) {
      const serviceNames = services.filter(s => s && typeof s === 'string' && s.trim().length > 0);
      if (serviceNames.length > 0) {
        const existingServices = await Service.find({ 
          servicename: { $in: serviceNames },
          companyCode: companyCode.trim().toUpperCase()
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
    
    const companyExists = await Company.findOne({ companyCode: companyCode.trim().toUpperCase() }).session(session);
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
      // Remove special characters and spaces, convert to lowercase
      const baseName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      // Add random numbers for security
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
      companyCode: companyCode.trim().toUpperCase(),
      employeeId,
      phone: phone?.trim() || '',
      address: address?.trim() || '',
      gender: 'other', // Default value
      maritalStatus: 'single', // Default value
      dob: null,
      salary: null,
      accountNumber: '',
      ifsc: '',
      bankName: '',
      bankHolderName: '',
      employeeType: 'client', 
      companyRole: 'client', // Set companyRole  to indicate this is a client user
      properties: [],
      propertyOwned: '',
      additionalDetails: JSON.stringify({
        clientId: null, // Will update after client creation
        isClientRepresentative: true,
        companyName: company,
        city: city
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

    // Create new client
    const newClient = new Client({
      client: client.trim(),
      company: company.trim(),
      city: city.trim(),
      companyCode: companyCode.trim().toUpperCase(),
      projectManager: cleanProjectManagers,
      services: services || [],
      status: status || 'Active',
      progress: progress || '0/0 (0%)',
      email: cleanEmail,
      phone: phone ? phone.trim() : '',
      address: address ? address.trim() : '',
      description: description ? description.trim() : '',
      notes: notes ? notes.trim() : '',
      userId: createdUser._id // Link to the created user
    });

    console.log('🔍 Creating client with data:', newClient);
    await newClient.save({ session });
    console.log('✅ Client created successfully:', newClient._id);

    // Update user's additionalDetails with client ID
    const updatedAdditionalDetails = JSON.parse(createdUser.additionalDetails || '{}');
    updatedAdditionalDetails.clientId = newClient._id;
    
    await User.findByIdAndUpdate(
      createdUser._id,
      { 
        $set: { 
          'additionalDetails': JSON.stringify(updatedAdditionalDetails),
          employeeType: newClient._id.toString() // Store client ID in employeeType
        } 
      },
      { session }
    );
    console.log('✅ User updated with client reference');

    // Commit transaction
    await session.commitTransaction();
    console.log('✅ Transaction committed successfully');

    // Send welcome email with auto-generated password (don't await - don't block response)
    sendWelcomeEmail(cleanEmail, client, company, autoPassword)
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
          autoPassword: autoPassword // Include in response so admin can share with client
        }
      }
    });
  } catch (error) {
    await session.abortTransaction();
    console.error('❌ Error adding client:', error);
    
    if (error.code === 11000) {
      console.error('❌ Duplicate key error:', error.keyValue);
      return res.status(400).json({
        success: false,
        message: 'Client already exists for this company'
      });
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

// ✅ UPDATED updateClient function with subscription handling
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
      subscription  // ✅ ADDED: subscription field
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
    
    // ✅ Add companyCode validation
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
        client: client.trim(),
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
    if (email !== undefined) updateData.email = email.trim().toLowerCase();
    if (phone !== undefined) updateData.phone = phone.trim();
    if (address !== undefined) updateData.address = address.trim();
    if (description !== undefined) updateData.description = description.trim();
    if (notes !== undefined) updateData.notes = notes.trim();

    // ✅ ✅ ✅ CRITICAL FIX: Handle subscription update
    if (subscription !== undefined) {
      console.log('🔍 Updating subscription:', JSON.stringify(subscription, null, 2));
      
      if (Array.isArray(subscription) && subscription.length > 0) {
        // Format dates properly
        const formattedSubscription = subscription.map(sub => ({
          startDate: sub.startDate ? new Date(sub.startDate) : null,
          endDate: sub.endDate ? new Date(sub.endDate) : null,
          status: sub.status || 'Active',
          planName: sub.planName || '',
          amount: sub.amount || 0
        }));
        updateData.subscription = formattedSubscription;
        console.log('✅ Formatted subscription:', JSON.stringify(formattedSubscription, null, 2));
      } else if (subscription !== null && subscription.length === 0) {
        // If empty array sent, clear subscription
        updateData.subscription = [];
        console.log('✅ Clearing subscription');
      }
    }

    console.log('🔍 Final update data:', JSON.stringify(updateData, null, 2));

    // Update client
    const updatedClient = await Client.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    );

    console.log('✅ Client updated successfully:', updatedClient._id);
    console.log('✅ Updated subscription:', updatedClient.subscription);
    
    res.json({
      success: true,
      message: 'Client updated successfully',
      data: updatedClient
    });
  } catch (error) {
    console.error('❌ Error updating client:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Client name already exists for this company'
      });
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

    // Add the project manager
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

    // Remove the project manager
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

const renewSubscription = async (req, res) => { 
  try { 
    const { startDate, endDate } = req.body; 
    const client = await Client.findById(req.params.id); 
    if (!client) { 
      return res.status(404).json({ 
        success: false, 
        message: 'Client not found' 
      }); 
    } 
    if (!client.subscription) { 
      client.subscription = []; 
    } 
    client.subscription.push({
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      status: 'Active',
      renewedAt: new Date()
    });
    await client.save();
    
    // ================= EMAIL TO CLIENT ================= //
    try { 
      if (client.email) { 
        await emailService.sendEmail( 
          client.email, 
          'Subscription Renewed Successfully', 
          `<h2>Your plan has been renewed successfully.</h2>
           <p><strong>Start Date:</strong> ${startDate}</p>
           <p><strong>End Date:</strong> ${endDate}</p>
           <p>Thank you for staying with us.</p>` 
        ); 
      } 
    } catch (emailError) { 
      console.log('Renewal email error:', emailError.message); 
    } 
    
    res.status(200).json({ 
      success: true, 
      message: 'Subscription renewed successfully', 
      data: client 
    }); 
  } catch (error) { 
    console.log('Renew Subscription Error:', error); 
    res.status(500).json({ 
      success: false, 
      message: 'Renewal failed' 
    }); 
  } 
};

// ================= UPLOAD PAYMENT RECEIPT =================

const uploadReceipt = async (req, res) => {
  try {
    const clientId = req.params.id;
    const { amount, transactionId, startDate, endDate } = req.body;
    const receiptFile = req.file;

    // Validate required fields
    if (!amount) {
      return res.status(400).json({
        success: false,
        message: 'Amount is required'
      });
    }

    if (!transactionId) {
      return res.status(400).json({
        success: false,
        message: 'Transaction ID is required'
      });
    }

    if (!receiptFile) {
      return res.status(400).json({
        success: false,
        message: 'Receipt file is required'
      });
    }

    // Validate amount is a positive number
    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Please enter a valid amount greater than 0'
      });
    }

    // Find client
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({
        success: false,
        message: 'Client not found'
      });
    }

    // Check if client has a paymentReceipts array (create if not exists)
    if (!client.paymentReceipts) {
      client.paymentReceipts = [];
    }

    // Create receipt data object
    const receiptData = {
      amount: numericAmount,
      transactionId: transactionId.trim(),
      receiptImage: receiptFile.path,
      receiptFilename: receiptFile.filename,
      receiptOriginalName: receiptFile.originalname,
      receiptSize: receiptFile.size,
      receiptMimeType: receiptFile.mimetype,
      uploadDate: new Date(),
      status: 'Pending',
      clientName: client.client,
      clientEmail: client.email,
      companyCode: client.companyCode,
      renewStartDate: startDate, 
      renewEndDate: endDate
    };

    if (startDate && endDate) { 
      if (!client.subscription) { 
        client.subscription = []; 
      } 
      client.subscription.push({ 
        startDate, 
        endDate, 
        status: 'Active', 
        renewedAt: new Date(), 
        paymentStatus: 'Pending' 
      }); 
    }  

    // Add to client's paymentReceipts array
    client.paymentReceipts.push(receiptData);
    await client.save();

    console.log(`✅ Receipt saved for client ${client.client} (${clientId})`);

    try { 
      if (client.email) { 
        await emailService.sendEmail( 
          client.email, 
          'Subscription Renewal Request Submitted', 
          `<h2>Your renewal request has been submitted successfully.</h2>
           <p><strong>Amount:</strong> ₹${numericAmount}</p>
           <p><strong>Transaction ID:</strong> ${transactionId}</p>
           <p><strong>Start Date:</strong> ${startDate}</p>
           <p><strong>End Date:</strong> ${endDate}</p>
           <p>Your payment is currently under verification.</p>` 
        ); 
        console.log('✅ Renewal email sent to client'); 
      } 
    } catch (emailError) { 
      console.log('❌ Client renewal email failed:', emailError.message); 
    }

    // Send email notification to owner(s)
    try {
      // Get owner/company email from company record
      const Company = require('../../models/Company');
      const company = await Company.findOne({ companyCode: client.companyCode });
      
      let ownerEmail = 'owner@gmail.com'; // Default fallback
      
      if (company && company.email) {
        ownerEmail = company.email;
      }
      
      // Also get all admin users
      const adminUsers = await User.find({ 
        role: { $in: ['admin', 'superadmin', 'owner'] },
        companyCode: client.companyCode
      }).select('email name');
      
      const adminEmails = adminUsers.map(admin => admin.email);
      const allRecipients = [ownerEmail, ...adminEmails];
      const uniqueRecipients = [...new Set(allRecipients)]; // Remove duplicates
      
      // Prepare email content
      const emailHtml = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>New Subscription Payment Receipt Uploaded</title>
            <style>
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                    line-height: 1.6;
                    color: #333;
                    background-color: #f4f7fb;
                    margin: 0;
                    padding: 20px;
                }
                .email-container {
                    max-width: 600px;
                    margin: 0 auto;
                    background: white;
                    border-radius: 16px;
                    overflow: hidden;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
                }
                .email-header {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    padding: 30px;
                    text-align: center;
                    color: white;
                }
                .email-header h1 {
                    margin: 0;
                    font-size: 24px;
                }
                .email-body {
                    padding: 30px;
                }
                .info-card {
                    background: #f8fafc;
                    border-radius: 12px;
                    padding: 20px;
                    margin: 20px 0;
                    border-left: 4px solid #3b82f6;
                }
                .info-row {
                    display: flex;
                    padding: 10px 0;
                    border-bottom: 1px solid #e2e8f0;
                }
                .info-label {
                    flex: 0 0 120px;
                    font-weight: 600;
                    color: #4a5568;
                }
                .info-value {
                    flex: 1;
                    color: #2d3748;
                }
                .status-badge {
                    display: inline-block;
                    padding: 4px 12px;
                    background: #fef3c7;
                    color: #92400e;
                    border-radius: 20px;
                    font-size: 12px;
                    font-weight: 600;
                }
                .button {
                    display: inline-block;
                    background: #3b82f6;
                    color: white;
                    text-decoration: none;
                    padding: 12px 24px;
                    border-radius: 8px;
                    margin-top: 20px;
                }
                .footer {
                    background: #f8fafc;
                    padding: 20px;
                    text-align: center;
                    font-size: 12px;
                    color: #718096;
                }
            </style>
        </head>
        <body>
            <div class="email-container">
                <div class="email-header">
                    <h1>💰 New Payment Receipt Uploaded</h1>
                    <p>Subscription Renewal Request</p>
                </div>
                
                <div class="email-body">
                    <h2>Payment Details</h2>
                    
                    <div class="info-card">
                        <div class="info-row">
                            <div class="info-label">Client Name:</div>
                            <div class="info-value"><strong>${client.client}</strong></div>
                        </div>
                        <div class="info-row">
                            <div class="info-label">Company:</div>
                            <div class="info-value">${client.company}</div>
                        </div>
                        <div class="info-row">
                            <div class="info-label">Email:</div>
                            <div class="info-value">${client.email || 'Not provided'}</div>
                        </div>
                        <div class="info-row">
                            <div class="info-label">Phone:</div>
                            <div class="info-value">${client.phone || 'Not provided'}</div>
                        </div>
                        <div class="info-row">
                            <div class="info-label">Amount:</div>
                            <div class="info-value"><strong>₹${numericAmount.toLocaleString('en-IN')}</strong></div>
                        </div>
                        <div class="info-row">
                            <div class="info-label">Transaction ID:</div>
                            <div class="info-value"><code>${transactionId}</code></div>
                        </div>
                        <div class="info-row">
                            <div class="info-label">Upload Date:</div>
                            <div class="info-value">${new Date().toLocaleString('en-IN')}</div>
                        </div>
                        <div class="info-row">
                            <div class="info-label">Status:</div>
                            <div class="info-value"><span class="status-badge">⏳ Pending Verification</span></div>
                        </div>
                    </div>
                    
                    <div style="background: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <strong>⚠️ Action Required:</strong>
                        <p style="margin: 10px 0 0 0;">Please verify the payment receipt and update the subscription status for this client.</p>
                    </div>
                    
                    <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin/clients/${clientId}" class="button">
                        View Client Details →
                    </a>
                </div>
                
                <div class="footer">
                    <p>CIIS NETWORK - Subscription Management System</p>
                    <p>This is an automated notification. Please do not reply to this email.</p>
                </div>
            </div>
        </body>
        </html>
      `;
      
      // Send emails to all recipients
      const emailPromises = uniqueRecipients.map(recipient => 
        emailService.sendEmail(
          recipient,
          `🔔 Payment Receipt Uploaded - ${client.client} (${client.company})`,
          emailHtml,
          {
            priority: 'high',
            referenceId: `payment-receipt-${clientId}-${Date.now()}`,
            headers: {
              'X-Email-Type': 'payment-receipt',
              'X-Client-Id': clientId,
              'X-Transaction-Id': transactionId
            }
          }
        )
      );
      
      await Promise.all(emailPromises);
      console.log(`✅ Payment receipt notification emails sent to ${uniqueRecipients.length} recipients`);
      
    } catch (emailError) {
      console.error('⚠️ Error sending email notifications:', emailError);
      // Don't fail the request if email fails
    }
    
    // Return success response
    res.status(200).json({
      success: true,
      message: 'Receipt uploaded successfully! Owner has been notified.',
      data: {
        receiptId: receiptData._id || 'pending',
        transactionId: transactionId,
        amount: numericAmount,
        uploadDate: receiptData.uploadDate,
        status: 'pending',
        receiptPath: receiptFile.path
      }
    });
    
  } catch (error) {
    console.error('❌ Receipt Upload Error:', error);
    
    // Clean up uploaded file if there's an error
    if (req.file && req.file.path) {
      const fs = require('fs');
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('Error deleting file:', err);
        else console.log('Deleted uploaded file due to error');
      });
    }
    
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload receipt. Please try again.'
    });
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
  uploadReceipt,
  renewSubscription,
  upload
};

console.log("✅ clientController.js loaded successfully with auto-user creation and email integration");