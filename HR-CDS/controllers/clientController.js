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
// Default department ID for clients
const DEFAULT_CLIENT_DEPARTMENT_ID = '69ae555c9a1e47e80a40204c';
// Default job role ID for clients
const DEFAULT_CLIENT_JOB_ROLE_ID = '69ae559b9a1e47e80a4020a2';

// Helper function to send welcome email
const sendWelcomeEmail = async (email, name, company, password) => {
  console.log('📧 ====== WELCOME EMAIL ======');
  console.log(`📧 To: ${email}`);
  console.log(`📧 Name: ${name}`);
  console.log(`📧 Company: ${company}`);
  console.log(`📧 Auto-generated password: ${password}`);
  console.log(`📧 Login URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}/login`);
  console.log('📧 ===========================');
  // In production, you would send an actual email
  // You can integrate with nodemailer or any email service here
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
    
    // Hash the password
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(autoPassword, salt);

    // Generate employee ID for user
    const employeeId = `CLT${Date.now()}${Math.floor(Math.random() * 1000)}`;
    console.log('🔍 Generated employee ID:', employeeId);

    // Get current user from request (if authenticated)
    const currentUserId = req.user?.id || null;

    // Create user first (as client representative)
    const userData = {
      name: client.trim(),
      email: cleanEmail,
      password: hashedPassword,
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
      employeeType: 'client', // Set employeeType to indicate this is a client user
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

    // Send welcome email with auto-generated password
    sendWelcomeEmail(cleanEmail, client, company, autoPassword);

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
      notes
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
  getClientsByCompany
};

console.log("✅ clientController.js loaded successfully with auto-user creation");