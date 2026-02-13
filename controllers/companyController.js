const Company = require("../models/Company");
const User = require("../models/User");
const crypto = require("crypto");
const mongoose = require("mongoose");
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const emailService = require('../services/emailService');
// =============================
// MULTER CONFIGURATION FOR LOGOS
// =============================

// Configure multer for logo storage
const logoStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    // Create logos directory if it doesn't exist
    const logoDir = path.join(__dirname, '../uploads/logos');
    if (!fs.existsSync(logoDir)) {
      fs.mkdirSync(logoDir, { recursive: true });
    }
    cb(null, logoDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `logo-${uniqueSuffix}${ext}`);
  }
});

// File filter for images only
const logoFileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|svg|webp/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  
  if (extname && mimetype) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed (JPEG, PNG, GIF, SVG, WEBP)'), false);
  }
};

// Multer middleware for single file upload
exports.uploadLogo = multer({
  storage: logoStorage,
  fileFilter: logoFileFilter,
  limits: {
    fileSize: 2 * 1024 * 1024 // 2MB limit
  }
}).single('logo');

// =============================
// HELPER FUNCTIONS
// =============================

// Helper function
const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

// Helper function to get company stats
const getCompanyStats = async (companyId) => {
  const [totalUsers, activeUsers, deactivatedUsers] = await Promise.all([
    User.countDocuments({ company: companyId }),
    User.countDocuments({ company: companyId, isActive: true }),
    User.countDocuments({ company: companyId, isActive: false }),
  ]);

  return {
    totalUsers,
    activeUsers,
    deactivatedUsers,
  };
};

// =============================
// LOGO UPLOAD HANDLER
// =============================

exports.uploadLogoHandler = async (req, res) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. Please select a logo image.'
      });
    }

    // Get file details
    const file = req.file;
    
    // Generate URL to the uploaded file
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const logoUrl = `${baseUrl}/uploads/logos/${file.filename}`;

    // Return success response
    return res.status(200).json({
      success: true,
      message: 'Logo uploaded successfully 🎉',
      logoUrl: logoUrl,
      fileDetails: {
        filename: file.filename,
        originalName: file.originalname,
        size: file.size,
        mimetype: file.mimetype
      },
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('❌ Logo upload error:', err);
    
    // Handle multer errors
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File size too large. Maximum size is 2MB.'
      });
    }
    
    if (err.message.includes('Only image files')) {
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to upload logo',
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// =============================
// COMPANY LOGO UPDATE
// =============================

exports.updateCompanyLogo = async (req, res) => {
  try {
    const { id } = req.params;
    const { logoUrl } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid company id",
      });
    }

    if (!logoUrl || logoUrl.trim() === '') {
      return res.status(400).json({
        success: false,
        message: "Logo URL is required",
      });
    }

    const company = await Company.findById(id);
    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    // Update logo
    company.logo = logoUrl.trim();
    await company.save();

    return res.status(200).json({
      success: true,
      message: "Company logo updated successfully",
      company: {
        id: company._id,
        companyName: company.companyName,
        logo: company.logo,
        updatedAt: company.updatedAt
      }
    });

  } catch (err) {
    console.error("❌ Update company logo error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update company logo",
    });
  }
};

// =============================
// CREATE COMPANY
// =============================

exports.createCompany = async (req, res) => {
  let transactionCompleted = false;
  let companyCreated = false;
  let createdCompany = null;
  let createdOwner = null;
  
  try {
    const {
      companyName,
      companyEmail,
      companyAddress,
      companyPhone,
      ownerName,
      logo,
      ownerEmail,
      ownerPassword,
      department = "Management",
    } = req.body;

    // ✅ 1. ENHANCED VALIDATION
    const validationErrors = [];

    // Required fields validation
    const requiredFields = [
      { field: "companyName", label: "Company Name", value: companyName },
      { field: "companyEmail", label: "Company Email", value: companyEmail },
      { field: "companyAddress", label: "Company Address", value: companyAddress },
      { field: "companyPhone", label: "Company Phone", value: companyPhone },
      { field: "ownerName", label: "Owner Name", value: ownerName },
      { field: "ownerEmail", label: "Owner Email", value: ownerEmail },
      { field: "ownerPassword", label: "Owner Password", value: ownerPassword },
    ];

    requiredFields.forEach(({ field, label, value }) => {
      if (!value || value.trim() === "") {
        validationErrors.push(`${label} is required`);
      }
    });

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (companyEmail && !emailRegex.test(companyEmail)) {
      validationErrors.push("Invalid company email format");
    }
    if (ownerEmail && !emailRegex.test(ownerEmail)) {
      validationErrors.push("Invalid owner email format");
    }

    // Phone validation
    if (companyPhone && !/^[0-9+\-\s()]{10,15}$/.test(companyPhone)) {
      validationErrors.push("Phone number must be 10-15 digits");
    }

    // Password strength validation
    if (ownerPassword && ownerPassword.length < 6) {
      validationErrors.push("Password must be at least 6 characters long");
    }

    // Return validation errors if any
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validationErrors,
        timestamp: new Date().toISOString()
      });
    }

    // ✅ 2. ENHANCED DUPLICATE CHECK (with specific messages)
    const trimmedCompanyName = companyName.trim();
    const lowerCompanyEmail = companyEmail.toLowerCase().trim();
    const lowerOwnerEmail = ownerEmail.toLowerCase().trim();
    const trimmedPhone = companyPhone.replace(/\D/g, '').slice(0, 10); // Clean phone number

    // Generate company code
    const generateCompanyCode = (name) => {
      // Take first 4 letters, remove spaces and special chars, make uppercase
      const baseCode = name
        .replace(/[^a-zA-Z0-9]/g, '')
        .substring(0, 4)
        .toUpperCase();
      
      // Add timestamp suffix for uniqueness
      const timestamp = Date.now().toString().slice(-4);
      const random = Math.floor(10 + Math.random() * 90);
      
      return `${baseCode}${timestamp}${random}`;
    };

    let companyCode = generateCompanyCode(trimmedCompanyName);
    let isCodeUnique = false;
    let attempts = 0;
    const maxAttempts = 5;

    // Ensure unique company code
    while (!isCodeUnique && attempts < maxAttempts) {
      const existingCode = await Company.findOne({ companyCode });
      if (!existingCode) {
        isCodeUnique = true;
      } else {
        companyCode = generateCompanyCode(trimmedCompanyName + attempts);
        attempts++;
      }
    }

    // ✅ Generate dbIdentifier for multi-tenancy
    const dbIdentifier = `company_${companyCode}_${Date.now()}`;

    // Check for duplicates
    const [existingCompanyEmail, existingCompanyPhone, existingCompanyName, existingUserEmail] = await Promise.all([
      Company.findOne({ companyEmail: lowerCompanyEmail }),
      Company.findOne({ companyPhone: trimmedPhone }),
      Company.findOne({ 
        companyName: { $regex: new RegExp(`^${trimmedCompanyName}$`, 'i') }
      }),
      User.findOne({ email: lowerOwnerEmail })
    ]);

    if (existingCompanyEmail) {
      return res.status(409).json({
        success: false,
        message: `Company with email '${companyEmail}' already exists`,
        field: "companyEmail",
        value: companyEmail,
        suggestion: "Please use a different email address"
      });
    }

    if (existingCompanyPhone) {
      return res.status(409).json({
        success: false,
        message: `Company with phone '${companyPhone}' already exists`,
        field: "companyPhone",
        value: companyPhone,
        suggestion: "Please use a different phone number"
      });
    }

    if (existingCompanyName) {
      return res.status(409).json({
        success: false,
        message: `Company with name '${companyName}' already exists`,
        field: "companyName",
        value: companyName,
        suggestion: "Please choose a different company name"
      });
    }

    if (existingUserEmail) {
      return res.status(409).json({
        success: false,
        message: `User with email '${ownerEmail}' already exists in the system`,
        field: "ownerEmail",
        value: ownerEmail,
        suggestion: "Please use a different email for the owner"
      });
    }

    // ✅ 3. CREATE COMPANY IN TRANSACTION
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // ✅ CREATE COMPANY WITH ALL FIELDS
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const frontendLoginUrl = `${process.env.FRONTEND_URL || baseUrl}/company/${companyCode}/login`;
      const apiLoginUrl = `${baseUrl}/api/v1/auth/company/${companyCode}/login`;
      
      const companyData = {
        companyName: trimmedCompanyName,
        companyCode: companyCode,
        companyEmail: lowerCompanyEmail,
        companyAddress: companyAddress.trim(),
        companyPhone: trimmedPhone,
        ownerName: ownerName.trim(),
        logo: logo || null,
        companyDomain: lowerCompanyEmail.split('@')[1] || 'example.com',
        loginUrl: frontendLoginUrl,
        apiLoginUrl: apiLoginUrl,
        dbIdentifier: dbIdentifier,
        isActive: true,
      };

      const company = await Company.create([companyData], { session });
      createdCompany = company[0];
      companyCreated = true;

      // ✅ 4. CREATE OWNER USER
      const ownerUser = await User.create([{
        company: createdCompany._id,
        companyCode: companyCode,
        name: ownerName.trim(),
        email: lowerOwnerEmail,
        password: ownerPassword,
        department: department,
        jobRole: "super_admin",
        phone: trimmedPhone,
        isActive: true,
        isVerified: true,
        createdBy: null,
        role: 'super_admin',
        permissions: ['all']
      }], { session });

      createdOwner = ownerUser[0];

      // ✅ 5. GENERATE LOGIN TOKEN
      const loginToken = crypto.randomBytes(32).toString("hex");
      createdCompany.loginToken = loginToken;
      
      // ✅ 6. SET SUBSCRIPTION EXPIRY (30 days from now)
      const subscriptionExpiry = new Date();
      subscriptionExpiry.setDate(subscriptionExpiry.getDate() + 30);
      createdCompany.subscriptionExpiry = subscriptionExpiry;
      
      await createdCompany.save({ session });

      // Commit transaction
      await session.commitTransaction();
      transactionCompleted = true;
      session.endSession();

      // ✅ 7. SEND EMAILS AFTER TRANSACTION IS COMMITTED
      // Don't await - send emails in background
      const emailPromise = emailService.sendCompanyRegistrationEmails(
        {
          id: createdCompany._id,
          companyName: createdCompany.companyName,
          companyCode: companyCode,
          companyEmail: createdCompany.companyEmail,
          companyPhone: createdCompany.companyPhone,
          companyAddress: createdCompany.companyAddress,
          ownerName: createdCompany.ownerName,
          loginUrl: frontendLoginUrl,
          apiLoginUrl: apiLoginUrl,
          createdAt: createdCompany.createdAt,
          subscriptionExpiry: createdCompany.subscriptionExpiry
        },
        {
          id: createdOwner._id,
          name: createdOwner.name,
          email: createdOwner.email,
          jobRole: createdOwner.jobRole,
          department: createdOwner.department,
          employeeId: createdOwner.employeeId,
          password: ownerPassword // Only for email template, never log this
        }
      );

      // Handle email promise without blocking response
      emailPromise
        .then(emailResults => {
          console.log(`✅ Registration emails processed for company: ${companyCode}`);
          if (process.env.NODE_ENV === 'development') {
            console.log('Email results:', emailResults);
          }
        })
        .catch(emailError => {
          console.error('❌ Background email sending failed:', emailError);
          // Log to error tracking service in production
        });

      // ✅ 8. SUCCESS RESPONSE
      return res.status(201).json({
        success: true,
        message: "Company registered successfully! 🎉 Check your email for login credentials.",
        company: {
          id: createdCompany._id,
          companyName: createdCompany.companyName,
          companyCode: companyCode,
          companyEmail: createdCompany.companyEmail,
          companyPhone: createdCompany.companyPhone,
          companyAddress: createdCompany.companyAddress,
          ownerName: createdCompany.ownerName,
          companyDomain: createdCompany.companyDomain,
          loginUrl: frontendLoginUrl,
          apiLoginUrl: apiLoginUrl,
          dbIdentifier: createdCompany.dbIdentifier,
          isActive: createdCompany.isActive,
          subscriptionExpiry: createdCompany.subscriptionExpiry,
          createdAt: createdCompany.createdAt,
        },
        owner: {
          id: createdOwner._id,
          name: createdOwner.name,
          email: createdOwner.email,
          jobRole: createdOwner.jobRole,
          department: createdOwner.department,
          employeeId: createdOwner.employeeId,
          isVerified: createdOwner.isVerified,
        },
        emailStatus: {
          message: "Registration emails are being sent to company and owner",
          companyEmail: createdCompany.companyEmail,
          ownerEmail: createdOwner.email
        },
        metadata: {
          timestamp: new Date().toISOString(),
          transactionId: createdCompany._id.toString(),
          companyCode: companyCode,
          stepsCompleted: ["company_creation", "owner_creation", "token_generation", "email_queued"]
        }
      });

    } catch (transactionError) {
      // Rollback transaction on error
      await session.abortTransaction();
      session.endSession();
      
      // Re-throw to be caught by outer catch block
      throw transactionError;
    }

  } catch (err) {
    console.error("❌ Create company error:", err);
    
    // ✅ 9. ENHANCED ERROR HANDLING WITH CLEANUP
    let statusCode = 500;
    let errorMessage = "Failed to create company";
    let errorDetails = null;
    let cleanupRequired = false;

    // Handle different error types
    if (err.name === 'ValidationError') {
      statusCode = 400;
      errorMessage = "Validation failed";
      
      const validationErrors = {};
      Object.keys(err.errors).forEach((key) => {
        validationErrors[key] = {
          message: err.errors[key].message,
          value: err.errors[key].value,
          kind: err.errors[key].kind
        };
      });
      
      errorDetails = validationErrors;
    } 
    else if (err.code === 11000) {
      statusCode = 409;
      
      const duplicateField = Object.keys(err.keyPattern)[0];
      const duplicateValue = err.keyValue[duplicateField];
      
      // Map to user-friendly messages
      const fieldMessages = {
        'companyName': 'Company name',
        'companyEmail': 'Company email',
        'companyPhone': 'Company phone',
        'email': 'Owner email',
        'companyCode': 'Company code'
      };
      
      const fieldLabel = fieldMessages[duplicateField] || duplicateField;
      errorMessage = `${fieldLabel} '${duplicateValue}' already exists`;
      
      errorDetails = {
        field: duplicateField,
        value: duplicateValue,
        code: err.code
      };
      
      cleanupRequired = companyCreated;
    }
    else if (err.name === 'CastError') {
      statusCode = 400;
      errorMessage = `Invalid ${err.path}: ${err.value}`;
    }
    else if (err.name === 'MongoError') {
      errorMessage = "Database error occurred";
      cleanupRequired = companyCreated;
    }

    // ✅ 10. CLEANUP IF PARTIALLY CREATED
    if (cleanupRequired && !transactionCompleted) {
      try {
        // Attempt to clean up partially created data
        if (companyCreated && createdCompany) {
          await Company.findByIdAndDelete(createdCompany._id);
          if (createdOwner) {
            await User.findByIdAndDelete(createdOwner._id);
          }
          console.log("✅ Cleaned up partially created company data");
        }
      } catch (cleanupError) {
        console.error("❌ Cleanup error:", cleanupError);
      }
    }

    // Return error response
    return res.status(statusCode).json({
      success: false,
      message: errorMessage,
      ...(errorDetails && { details: errorDetails }),
      ...(process.env.NODE_ENV === 'development' && { 
        debug: {
          error: err.message,
          stack: err.stack
        }
      }),
      timestamp: new Date().toISOString(),
      suggestion: statusCode === 500 ? "Please try again later or contact support" : "Please correct the errors and try again"
    });
  }
};

// =============================
// GET ALL COMPANIES
// =============================

exports.getAllCompanies = async (req, res) => {
  try {
    const companies = await Company.find({})
      .select(
        "_id companyName companyEmail companyAddress companyPhone ownerName logo companyDomain loginToken isActive deactivatedAt subscriptionExpiry createdAt updatedAt companyCode dbIdentifier loginUrl"
      )
      .sort({ createdAt: -1 });

    // ✅ Get user counts for each company
    const companiesWithStats = await Promise.all(
      companies.map(async (company) => {
        const userCount = await User.countDocuments({
          company: company._id,
          isActive: true,
        });

        return {
          ...company.toObject(),
          totalUsers: userCount,
        };
      })
    );

    return res.status(200).json({
      success: true,
      count: companiesWithStats.length,
      companies: companiesWithStats,
    });
  } catch (err) {
    console.error("❌ Get all companies error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch companies",
    });
  }
};

// =============================
// GET COMPANY BY ID
// =============================

exports.getCompanyById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid company id",
      });
    }

    const company = await Company.findById(id).select("-loginToken");

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const stats = await getCompanyStats(company._id);

    return res.status(200).json({
      success: true,
      company: {
        ...company.toObject(),
        ...stats,
      },
    });
  } catch (err) {
    console.error("❌ Get company by id error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch company",
    });
  }
};

// =============================
// GET COMPANY BY CODE
// =============================

exports.getCompanyByCode = async (req, res) => {
  try {
    const { companyCode } = req.params;

    if (!companyCode?.trim()) {
      return res.status(400).json({
        success: false,
        message: "companyCode is required",
      });
    }

    const company = await Company.findOne({
      companyCode: companyCode.toUpperCase().trim(),
    }).select("-loginToken");

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const stats = await getCompanyStats(company._id);

    return res.status(200).json({
      success: true,
      company: {
        ...company.toObject(),
        ...stats,
      },
    });
  } catch (err) {
    console.error("❌ Get company by code error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch company",
    });
  }
};

// =============================
// GET COMPANY DETAILS BY IDENTIFIER
// =============================

exports.getCompanyDetailsByIdentifier = async (req, res) => {
  try {
    const { identifier } = req.params;
    
    console.log('Fetching company for identifier:', identifier);
    
    // Multiple ways to find company:
    // 1. By companyCode
    // 2. By loginUrl segment
    // 3. By extracted code from URL
    const company = await Company.findOne({
      $or: [
        { companyCode: identifier },
        { loginUrl: { $regex: identifier, $options: 'i' } },
        { 
          loginUrl: { 
            $regex: identifier.replace(/-/g, '.*'), 
            $options: 'i' 
          } 
        }
      ]
    }).select('-loginToken -__v');

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    // Check if company is active
    if (!company.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Company account is deactivated'
      });
    }

    // Check subscription expiry
    if (new Date() > new Date(company.subscriptionExpiry)) {
      return res.status(403).json({
        success: false,
        message: 'Company subscription has expired'
      });
    }

    res.json({
      success: true,
      company: {
        _id: company._id,
        companyName: company.companyName,
        companyEmail: company.companyEmail,
        companyAddress: company.companyAddress,
        companyPhone: company.companyPhone,
        ownerName: company.ownerName,
        logo: company.logo,
        companyDomain: company.companyDomain,
        companyCode: company.companyCode,
        isActive: company.isActive,
        subscriptionExpiry: company.subscriptionExpiry,
        loginUrl: company.loginUrl,
        dbIdentifier: company.dbIdentifier,
        createdAt: company.createdAt,
        updatedAt: company.updatedAt
      }
    });

  } catch (error) {
    console.error('Company details error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// =============================
// VALIDATE COMPANY URL
// =============================

exports.validateCompanyUrl = async (req, res) => {
  try {
    const { identifier } = req.params;
    
    const company = await Company.findOne({
      $or: [
        { companyCode: identifier },
        { loginUrl: { $regex: identifier, $options: 'i' } }
      ]
    }).select('companyName loginUrl isActive');

    if (!company) {
      return res.status(404).json({
        success: false,
        exists: false,
        message: 'Company URL not found'
      });
    }

    res.json({
      success: true,
      exists: true,
      companyName: company.companyName,
      isActive: company.isActive
    });

  } catch (error) {
    console.error('URL validation error:', error);
    res.status(500).json({
      success: false,
      exists: false,
      message: 'Server error'
    });
  }
};

// =============================
// UPDATE COMPANY
// =============================

exports.updateCompany = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid company id",
      });
    }

    // ✅ Allowed fields only (Whitelist - safe)
    const allowedFields = [
      "companyName",
      "companyEmail",
      "companyAddress",
      "companyPhone",
      "ownerName",
      "logo",
      "subscriptionExpiry",
    ];

    const updateData = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        updateData[key] = req.body[key];
      }
    }

    // ✅ lowercase email
    if (updateData.companyEmail) {
      updateData.companyEmail = updateData.companyEmail.toLowerCase();
    }

    const updatedCompany = await Company.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select("-loginToken");

    if (!updatedCompany) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Company updated successfully",
      company: updatedCompany,
    });
  } catch (err) {
    console.error("❌ Update company error:", err);

    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Duplicate field value exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update company",
    });
  }
};

// =============================
// DEACTIVATE COMPANY
// =============================

exports.deactivateCompany = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid company id",
      });
    }

    const company = await Company.findByIdAndUpdate(
      id,
      {
        isActive: false,
        deactivatedAt: new Date(),
      },
      { new: true }
    ).select("-loginToken");

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    // ✅ deactivate all users of this company
    await User.updateMany(
      { company: id },
      {
        isActive: false,
        lockUntil: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year lock
      }
    );

    return res.status(200).json({
      success: true,
      message: "Company deactivated successfully",
      company,
    });
  } catch (err) {
    console.error("❌ Deactivate company error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to deactivate company",
    });
  }
};

// =============================
// ACTIVATE COMPANY
// =============================

exports.activateCompany = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid company id",
      });
    }

    const company = await Company.findByIdAndUpdate(
      id,
      {
        isActive: true,
        deactivatedAt: null,
      },
      { new: true }
    ).select("-loginToken");

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    // ✅ activate all users of this company
    await User.updateMany(
      { company: id },
      {
        isActive: true,
        $unset: { lockUntil: 1 },
      }
    );

    return res.status(200).json({
      success: true,
      message: "Company activated successfully",
      company,
    });
  } catch (err) {
    console.error("❌ Activate company error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to activate company",
    });
  }
};

// =============================
// DELETE COMPANY PERMANENTLY
// =============================

exports.deleteCompanyPermanently = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid company id",
      });
    }

    const company = await Company.findById(id);
    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    // ✅ Delete users
    await User.deleteMany({ company: id });

    // ✅ Delete company
    await Company.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: "Company deleted permanently",
    });
  } catch (err) {
    console.error("❌ Delete company error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to delete company",
    });
  }
};

// =============================
// GET COMPANY USERS
// =============================

exports.getCompanyUsers = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid company id",
      });
    }

    let { page = 1, limit = 20, role, department, active = "true" } = req.query;

    page = parseInt(page);
    limit = parseInt(limit);

    if (page < 1) page = 1;
    if (limit < 1) limit = 20;
    if (limit > 100) limit = 100; // ✅ prevent abuse

    // ✅ Company exists?
    const companyExists = await Company.exists({ _id: id });
    if (!companyExists) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    // ✅ Build query
    const query = { company: id };

    if (role) query.jobRole = role;
    if (department) query.department = department;

    if (active !== "all") {
      query.isActive = active === "true";
    }

    const skip = (page - 1) * limit;

    const [users, totalUsers] = await Promise.all([
      User.find(query)
        .select("name email jobRole department phone employeeId isActive createdAt")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),

      User.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      count: users.length,
      total: totalUsers,
      pages: Math.ceil(totalUsers / limit),
      currentPage: page,
      users,
    });
  } catch (err) {
    console.error("❌ Get company users error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch company users",
    });
  }
};

// =============================
// GET COMPANY STATS
// =============================

exports.getCompanyStats = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid company id",
      });
    }

    const company = await Company.findById(id);
    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const stats = await getCompanyStats(id);

    return res.status(200).json({
      success: true,
      stats,
      company: {
        id: company._id,
        companyName: company.companyName,
        companyCode: company.companyCode,
        isActive: company.isActive,
        subscriptionExpiry: company.subscriptionExpiry,
      }
    });
  } catch (err) {
    console.error("❌ Get company stats error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch company stats",
    });
  }
};
console.log("✅ companyController.js loaded successfully");