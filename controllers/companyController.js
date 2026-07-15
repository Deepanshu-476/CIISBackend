const Company = require("../models/Company");
const User = require("../models/User");
const Branch = require("../models/Branch");
const Department = require("../models/Department");
const JobRole = require("../models/JobRole");
const Plan = require("../models/Plan");
const crypto = require("crypto");
const mongoose = require("mongoose");
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const emailService = require('../services/emailService');
const { getPaginationOptions, buildPaginationMeta } = require('../utils/pagination');





const logoStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    
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


exports.uploadLogo = multer({
  storage: logoStorage,
  fileFilter: logoFileFilter,
  limits: {
    fileSize: 2 * 1024 * 1024 
  }
}).single('logo');






const isValidObjectId = (id) => {
  return mongoose.Types.ObjectId.isValid(id);
};

const normalizePaymentStatus = (status = "paid") => {
  const normalized = String(status || "paid").trim().toLowerCase();
  return ["paid", "unpaid", "partial", "waived"].includes(normalized) ? normalized : "paid";
};

const normalizePaymentMode = (mode = "other") => {
  const normalized = String(mode || "other").trim().toLowerCase();
  return ["cash", "upi", "bank_transfer", "card", "cheque", "other"].includes(normalized) ? normalized : "other";
};

const cleanStringArray = value => (
  Array.isArray(value)
    ? [...new Set(value.map(item => String(item || "").trim()).filter(Boolean))]
    : []
);

const escapeRegExp = value => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const identifierToLooseRegex = value => escapeRegExp(value)
  .replace(/[-_\s]+/g, "[-_\\s]*");


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





exports.uploadLogoHandler = async (req, res) => {
  try {
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. Please select a logo image.'
      });
    }

    
    const file = req.file;
    
    
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const logoUrl = `${baseUrl}/uploads/logos/${file.filename}`;

    
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
      planId,
      department = "Management",
    } = req.body;

    
    const validationErrors = [];

    
    const requiredFields = [
      { field: "companyName", label: "Company Name", value: companyName },
      { field: "companyEmail", label: "Company Email", value: companyEmail },
      { field: "companyAddress", label: "Company Address", value: companyAddress },
      { field: "companyPhone", label: "Company Phone", value: companyPhone },
      { field: "ownerName", label: "Owner Name", value: ownerName },
      { field: "ownerEmail", label: "Owner Email", value: ownerEmail },
      { field: "ownerPassword", label: "Owner Password", value: ownerPassword },
      { field: "planId", label: "Plan", value: planId },
    ];

    requiredFields.forEach(({ field, label, value }) => {
      if (!value || value.trim() === "") {
        validationErrors.push(`${label} is required`);
      }
    });

    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (companyEmail && !emailRegex.test(companyEmail)) {
      validationErrors.push("Invalid company email format");
    }
    if (ownerEmail && !emailRegex.test(ownerEmail)) {
      validationErrors.push("Invalid owner email format");
    }

    
    if (companyPhone && !/^[0-9+\-\s()]{10,15}$/.test(companyPhone)) {
      validationErrors.push("Phone number must be 10-15 digits");
    }

    
    if (ownerPassword && ownerPassword.length < 6) {
      validationErrors.push("Password must be at least 6 characters long");
    }

    let selectedPlan = null;
    if (planId && isValidObjectId(planId)) {
      selectedPlan = await Plan.findOne({ _id: planId, isActive: true });
    }

    if (!selectedPlan) {
      validationErrors.push("Please select a valid active plan");
    }

    
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: validationErrors,
        timestamp: new Date().toISOString()
      });
    }

    
    const trimmedCompanyName = companyName.trim();
    const lowerCompanyEmail = companyEmail.toLowerCase().trim();
    const lowerOwnerEmail = ownerEmail.toLowerCase().trim();
    const trimmedPhone = companyPhone.replace(/\D/g, '').slice(0, 10); 

    
    const generateCompanyCode = (name) => {
      
      const baseCode = name
        .replace(/[^a-zA-Z0-9]/g, '')
        .substring(0, 4)
        .toUpperCase();
      
      
      const timestamp = Date.now().toString().slice(-4);
      const random = Math.floor(10 + Math.random() * 90);
      
      return `${baseCode}${timestamp}${random}`;
    };

    let companyCode = generateCompanyCode(trimmedCompanyName);
    let isCodeUnique = false;
    let attempts = 0;
    const maxAttempts = 5;

    
    while (!isCodeUnique && attempts < maxAttempts) {
      const existingCode = await Company.findOne({ companyCode });
      if (!existingCode) {
        isCodeUnique = true;
      } else {
        companyCode = generateCompanyCode(trimmedCompanyName + attempts);
        attempts++;
      }
    }

    
    const dbIdentifier = `company_${companyCode}_${Date.now()}`;

    
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

    
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const frontendLoginUrl = `${"https://cds.ciisnetwork.in"}/company/${companyCode}/login`;
      const apiLoginUrl = `${baseUrl}/api/v1/auth/company/${companyCode}/login`;
      const subscriptionStartDate = new Date();
      const subscriptionExpiry = new Date(
        subscriptionStartDate.getTime() + selectedPlan.durationDays * 24 * 60 * 60 * 1000
      );
      const cleanAllowedPages = cleanStringArray(selectedPlan.allowedPages);
      const cleanFeatures = cleanStringArray(selectedPlan.features);
      
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
        deactivatedAt: null,
        selectedPlan: selectedPlan._id,
        subscriptionPlan: selectedPlan.name,
        subscriptionAmount: selectedPlan.price,
        subscriptionPaymentStatus: selectedPlan.price > 0 ? "unpaid" : "waived",
        subscriptionExpiry,
        planDurationDays: selectedPlan.durationDays,
        planFeatures: cleanFeatures,
        allowedPages: cleanAllowedPages,
        accessConfiguredAt: new Date(),
        subscriptionPayments: [{
          amount: selectedPlan.price,
          paymentDate: new Date(),
          paymentMode: "other",
          transactionId: "",
          status: selectedPlan.price > 0 ? "unpaid" : "waived",
          subscriptionStartDate,
          subscriptionExpiry,
          planName: selectedPlan.name,
          notes: "Selected during company registration",
        }],
      };

      const company = await Company.create([companyData], { session });
      createdCompany = company[0];
      companyCreated = true;

      
      const defaultBranchData = {
        name: "Head Office",
        branchCode: `${companyCode}-HQ`,
        company: createdCompany._id,
        companyCode: companyCode,
        address: companyAddress.trim(),
        phone: trimmedPhone,
        isDefault: true,
        isActive: true
      };

      const defaultBranch = await Branch.create([defaultBranchData], { session });
      const createdBranch = defaultBranch[0];

      
      const ownerUser = await User.create([{
        company: createdCompany._id,
        companyCode: companyCode,
        branch: createdBranch._id,
        branchCode: createdBranch.branchCode,
        name: ownerName.trim(),
        email: lowerOwnerEmail,
        password: ownerPassword,
        department: department,
        jobRole: "super_admin",
        companyRole: "Owner",
        
        phone: trimmedPhone,
        isActive: true,
        isVerified: true,
        createdBy: null,
        role: 'super_admin',
        permissions: ['all']
      }], { session });

      createdOwner = ownerUser[0];

      
      const loginToken = crypto.randomBytes(32).toString("hex");
      createdCompany.loginToken = loginToken;
      
      await createdCompany.save({ session });

      
      await session.commitTransaction();
      transactionCompleted = true;
      session.endSession();

      
      
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
          subscriptionExpiry: createdCompany.subscriptionExpiry,
          subscriptionPlan: createdCompany.subscriptionPlan,
        },
        {
          id: createdOwner._id,
          name: createdOwner.name,
          email: createdOwner.email,
          jobRole: createdOwner.jobRole,
          department: createdOwner.department,
          employeeId: createdOwner.employeeId,
          password: ownerPassword 
        }
      );

      
      emailPromise
        .then(emailResults => {
          void 0;
          if (process.env.NODE_ENV === 'development') {
            void 0;
          }
        })
        .catch(emailError => {
          console.error('❌ Background email sending failed:', emailError);
          
        });

      
      return res.status(201).json({
        success: true,
        message: "Company registered successfully with selected plan.",
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
          selectedPlan: createdCompany.selectedPlan,
          subscriptionPlan: createdCompany.subscriptionPlan,
          subscriptionAmount: createdCompany.subscriptionAmount,
          planDurationDays: createdCompany.planDurationDays,
          planFeatures: createdCompany.planFeatures,
          allowedPages: createdCompany.allowedPages,
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
          stepsCompleted: ["company_creation", "owner_creation", "token_generation", "plan_access_applied", "email_queued"]
        }
      });

    } catch (transactionError) {
      
      await session.abortTransaction();
      session.endSession();
      
      
      throw transactionError;
    }

  } catch (err) {
    console.error("❌ Create company error:", err);
    
    
    let statusCode = 500;
    let errorMessage = "Failed to create company";
    let errorDetails = null;
    let cleanupRequired = false;

    
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

    
    if (cleanupRequired && !transactionCompleted) {
      try {
        
        if (companyCreated && createdCompany) {
          await Company.findByIdAndDelete(createdCompany._id);
          if (createdOwner) {
            await User.findByIdAndDelete(createdOwner._id);
          }
          void 0;
        }
      } catch (cleanupError) {
        console.error("❌ Cleanup error:", cleanupError);
      }
    }

    
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





exports.getAllCompanies = async (req, res) => {
  try {
    const { page, limit, skip } = getPaginationOptions(req.query, { limit: 20, maxLimit: 100 });
    const filter = {};
    const search = String(req.query.search || req.query.q || "").trim();

    if (search) {
      const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { companyName: searchRegex },
        { companyEmail: searchRegex },
        { companyCode: searchRegex },
        { ownerName: searchRegex }
      ];
    }

    const [companies, total] = await Promise.all([
      Company.find(filter)
      .select(
        "_id companyName companyEmail companyAddress companyPhone ownerName logo companyDomain loginToken isActive deactivatedAt subscriptionExpiry createdAt updatedAt companyCode dbIdentifier loginUrl"
          + " allowedPages accessConfiguredAt accessUpdatedBy selectedPlan subscriptionPlan subscriptionAmount subscriptionPaymentStatus subscriptionPayments planDurationDays planFeatures"
      )
      .populate("selectedPlan", "name price durationDays features allowedPages")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Company.countDocuments(filter)
    ]);

    
    const companiesWithStats = await Promise.all(
      companies.map(async (company) => {
        const userCount = await User.countDocuments({
          company: company._id,
          isActive: true,
        });

        return {
          ...company,
          totalUsers: userCount,
        };
      })
    );
    const pagination = buildPaginationMeta({ page, limit, total });

    return res.status(200).json({
      success: true,
      count: companiesWithStats.length,
      total,
      pagination,
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





exports.getCompanyById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid company id",
      });
    }

    const company = await Company.findById(id)
      .select("-loginToken")
      .populate("selectedPlan", "name price durationDays features allowedPages")
      .lean();

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
        ...company,
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





exports.getCompanyDetailsByIdentifier = async (req, res) => {
  try {
    const { identifier } = req.params;
    const cleanIdentifier = identifier ? String(identifier).trim() : '';
    
    void 0;
    
    
    
    
    
    const company = await Company.findOne({
      $or: [
        { companyCode: cleanIdentifier.toUpperCase() },
        { dbIdentifier: cleanIdentifier.toLowerCase() },
        { loginUrl: { $regex: escapeRegExp(cleanIdentifier), $options: 'i' } },
        { 
          loginUrl: { 
            $regex: identifierToLooseRegex(cleanIdentifier), 
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

    
    if (!company.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Company account is deactivated'
      });
    }

    
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





exports.validateCompanyUrl = async (req, res) => {
  try {
    const { identifier } = req.params;
    const cleanIdentifier = identifier ? String(identifier).trim() : '';

    if (!cleanIdentifier) {
      return res.status(400).json({
        success: false,
        message: 'Company identifier is required'
      });
    }
    
    const company = await Company.findOne({
      $or: [
        { companyCode: cleanIdentifier.toUpperCase() },
        { dbIdentifier: cleanIdentifier.toLowerCase() },
        { loginUrl: { $regex: escapeRegExp(cleanIdentifier), $options: 'i' } }
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





exports.updateCompany = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid company id",
      });
    }

    
    const allowedFields = [
      "companyName",
      "companyEmail",
      "companyAddress",
      "companyPhone",
      "ownerName",
      "logo",
      "subscriptionExpiry",
      "subscriptionPlan",
      "subscriptionAmount",
      "subscriptionPaymentStatus",
    ];

    const updateData = {};
    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        updateData[key] = req.body[key];
      }
    }

    
    if (updateData.companyEmail) {
      updateData.companyEmail = updateData.companyEmail.toLowerCase();
    }

    if (updateData.subscriptionExpiry) {
      const expiry = new Date(updateData.subscriptionExpiry);
      if (Number.isNaN(expiry.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid subscription expiry date",
        });
      }
      updateData.subscriptionExpiry = expiry;
    }

    if (updateData.subscriptionAmount !== undefined) {
      const amount = Number(updateData.subscriptionAmount);
      if (!Number.isFinite(amount) || amount < 0) {
        return res.status(400).json({
          success: false,
          message: "Invalid subscription amount",
        });
      }
      updateData.subscriptionAmount = amount;
    }

    if (updateData.subscriptionPaymentStatus) {
      updateData.subscriptionPaymentStatus = normalizePaymentStatus(updateData.subscriptionPaymentStatus);
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





exports.updateCompanyAccess = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      allowedPages = [],
      activeDays = 30,
      isActive = true,
      subscriptionExpiry,
      updatedBy,
    } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid company id",
      });
    }

    if (!Array.isArray(allowedPages) || allowedPages.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please select at least one page for this company",
      });
    }

    const cleanAllowedPages = [...new Set(
      allowedPages
        .map(page => String(page || "").trim())
        .filter(Boolean)
    )];

    const days = Number(activeDays);
    const computedExpiry = subscriptionExpiry
      ? new Date(subscriptionExpiry)
      : new Date(Date.now() + Math.max(1, Number.isFinite(days) ? days : 30) * 24 * 60 * 60 * 1000);

    if (Number.isNaN(computedExpiry.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription expiry date",
      });
    }

    const updateData = {
      allowedPages: cleanAllowedPages,
      subscriptionExpiry: computedExpiry,
      isActive: Boolean(isActive),
      deactivatedAt: isActive ? null : new Date(),
      accessConfiguredAt: new Date(),
    };

    if (updatedBy && isValidObjectId(updatedBy)) {
      updateData.accessUpdatedBy = updatedBy;
    }

    const company = await Company.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select("-loginToken");

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    if (company.isActive) {
      await User.updateMany(
        { company: id, companyRole: "Owner" },
        {
          isActive: true,
          $unset: { lockUntil: 1 },
        }
      );
    } else {
      await User.updateMany(
        { company: id },
        {
          isActive: false,
          lockUntil: Date.now() + 365 * 24 * 60 * 60 * 1000,
        }
      );
    }

    return res.status(200).json({
      success: true,
      message: company.isActive ? "Company access activated successfully" : "Company access saved as inactive",
      company,
    });
  } catch (err) {
    console.error("❌ Update company access error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update company access",
    });
  }
};





exports.renewCompanySubscription = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      subscriptionExpiry,
      subscriptionStartDate,
      planId,
      planName = "Standard",
      amount = 0,
      paymentDate,
      paymentMode = "other",
      transactionId = "",
      paymentStatus = "paid",
      notes = "",
      isActive,
      recordedBy,
    } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid company id",
      });
    }

    if (!subscriptionExpiry) {
      return res.status(400).json({
        success: false,
        message: "Subscription expiry date is required",
      });
    }

    const expiryDate = new Date(subscriptionExpiry);
    if (Number.isNaN(expiryDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription expiry date",
      });
    }

    const startDate = subscriptionStartDate ? new Date(subscriptionStartDate) : new Date();
    if (Number.isNaN(startDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription start date",
      });
    }

    const paidOn = paymentDate ? new Date(paymentDate) : new Date();
    if (Number.isNaN(paidOn.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment date",
      });
    }

    let selectedPlan = null;
    if (planId) {
      if (!isValidObjectId(planId)) {
        return res.status(400).json({
          success: false,
          message: "Invalid plan id",
        });
      }
      selectedPlan = await Plan.findOne({ _id: planId, isActive: true });
      if (!selectedPlan) {
        return res.status(404).json({
          success: false,
          message: "Selected plan not found or inactive",
        });
      }
    }

    const paymentAmount = Number(selectedPlan ? selectedPlan.price : amount || 0);
    if (!Number.isFinite(paymentAmount) || paymentAmount < 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment amount",
      });
    }

    const cleanStatus = normalizePaymentStatus(paymentStatus);
    const cleanMode = normalizePaymentMode(paymentMode);
    const cleanPlanName = selectedPlan?.name || String(planName || "Standard").trim() || "Standard";
    const planFeatures = selectedPlan ? cleanStringArray(selectedPlan.features) : null;
    const planAllowedPages = selectedPlan ? cleanStringArray(selectedPlan.allowedPages) : null;

    const paymentRecord = {
      amount: paymentAmount,
      paymentDate: paidOn,
      paymentMode: cleanMode,
      transactionId: String(transactionId || "").trim(),
      status: cleanStatus,
      subscriptionStartDate: startDate,
      subscriptionExpiry: expiryDate,
      planName: cleanPlanName,
      notes: String(notes || "").trim(),
      recordedBy: recordedBy && isValidObjectId(recordedBy) ? recordedBy : req.user?._id || null,
    };

    const updateData = {
      subscriptionExpiry: expiryDate,
      subscriptionPlan: cleanPlanName,
      subscriptionAmount: paymentAmount,
      subscriptionPaymentStatus: cleanStatus,
      accessConfiguredAt: new Date(),
      $push: {
        subscriptionPayments: {
          $each: [paymentRecord],
          $position: 0,
        },
      },
    };

    if (selectedPlan) {
      updateData.selectedPlan = selectedPlan._id;
      updateData.planDurationDays = selectedPlan.durationDays;
      updateData.planFeatures = planFeatures;
      updateData.allowedPages = planAllowedPages;
    }

    if (isActive !== undefined) {
      updateData.isActive = Boolean(isActive);
      updateData.deactivatedAt = Boolean(isActive) ? null : new Date();
    }

    const company = await Company.findByIdAndUpdate(
      id,
      {
        $set: Object.fromEntries(
          Object.entries(updateData).filter(([key]) => key !== "$push")
        ),
        $push: updateData.$push,
      },
      { new: true, runValidators: true }
    )
      .select("-loginToken")
      .populate("selectedPlan", "name price durationDays features allowedPages");

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    if (company.isActive) {
      await User.updateMany(
        { company: id },
        {
          isActive: true,
          $unset: { lockUntil: 1 },
        }
      );
    }

    return res.status(200).json({
      success: true,
      message: "Company subscription updated successfully",
      company,
      payment: paymentRecord,
    });
  } catch (err) {
    console.error("❌ Renew company subscription error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to update company subscription",
    });
  }
};





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

    
    await User.updateMany(
      { company: id },
      {
        isActive: false,
        lockUntil: Date.now() + 365 * 24 * 60 * 60 * 1000, 
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

    const companyObjectId = new mongoose.Types.ObjectId(id);
    const companyCode = String(company.companyCode || "").trim();
    const escapedCompanyCode = escapeRegExp(companyCode);
    const companyCodePattern = companyCode
      ? new RegExp(`^${escapedCompanyCode}(?:-|$)`, "i")
      : null;
    const companyUsers = await User.find({
      $or: [
        { company: companyObjectId },
        ...(companyCodePattern ? [{ companyCode: companyCodePattern }] : [])
      ]
    }).select("_id").lean();
    const userIds = companyUsers.map(user => user._id);

    const protectedCollections = new Set([
      Company.collection.name,
      Plan.collection.name,
      "superadmins",
      "system.version"
    ]);
    const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
    const deletionSummary = {};

    const companyConditions = [
      { company: companyObjectId },
      { company: id },
      { companyId: companyObjectId },
      { companyId: id },
      ...(companyCodePattern ? [
        { companyCode: companyCodePattern },
        { companyIdentifier: companyCodePattern }
      ] : [])
    ];

    const userReferenceFields = [
      "user", "userId", "recipient", "sender", "requester", "requestedBy",
      "createdBy", "updatedBy", "employee", "employeeId", "assignedTo",
      "assigneeId", "approvedBy", "rejectedBy", "uploadedBy", "performedBy"
    ];

    for (const { name } of collections) {
      if (protectedCollections.has(name) || name.startsWith("system.")) continue;

      const conditions = [...companyConditions];
      if (userIds.length > 0) {
        userReferenceFields.forEach(field => {
          conditions.push({ [field]: { $in: userIds } });
        });
      }

      const result = await mongoose.connection.db
        .collection(name)
        .deleteMany({ $or: conditions });
      if (result.deletedCount > 0) deletionSummary[name] = result.deletedCount;
    }

    // Delete the company only after every related collection was cleaned.
    await Company.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: "Company, users and all related data deleted permanently",
      deletedUsers: userIds.length,
      deletedRecords: deletionSummary,
    });
  } catch (err) {
    console.error("❌ Delete company error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to delete company",
    });
  }
};





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
    if (limit > 100) limit = 100; 

    
    const companyExists = await Company.exists({ _id: id });
    if (!companyExists) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    
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
        .limit(limit)
        .lean(),

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

const normalizeCompanyForOverview = company => {
  if (!company) return null;
  return {
    ...company,
    companyName: company.companyName || company.name || "Company",
    companyEmail: company.companyEmail || company.email || "",
    companyPhone: company.companyPhone || company.phone || "",
    companyAddress: company.companyAddress || company.address || "",
    companyDomain: company.companyDomain || company.domain || "",
    loginUrl: company.loginUrl || (company.companyCode ? `/company/${company.companyCode}/login` : ""),
  };
};

exports.getCompanyOverview = async (req, res) => {
  try {
    const requestedCompanyId = req.query.companyId || req.params.id;
    const userCompanyId = req.user?.company?._id || req.user?.company || req.user?.companyId;
    const companyCode = String(req.query.companyCode || req.user?.companyCode || req.user?.company?.companyCode || "").trim().toUpperCase();
    const rawLimit = parseInt(req.query.limit || "100", 10);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 100, 5), 300);

    const companyQuery = {};
    if (requestedCompanyId && isValidObjectId(requestedCompanyId)) {
      companyQuery._id = requestedCompanyId;
    } else if (userCompanyId && isValidObjectId(userCompanyId)) {
      companyQuery._id = userCompanyId;
    } else if (companyCode) {
      companyQuery.companyCode = companyCode;
    } else {
      return res.status(400).json({
        success: false,
        message: "Company context missing",
      });
    }

    const company = await Company.findOne(companyQuery)
      .select("-loginToken")
      .populate("selectedPlan", "name price durationDays features allowedPages")
      .lean();

    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const userQuery = { company: company._id };
    const [users, totalUsers, activeUsers, departments, jobRoles] = await Promise.all([
      User.find(userQuery)
        .select("name email role companyRole jobRole department phone designation employeeId isActive createdAt")
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean(),
      User.countDocuments(userQuery),
      User.countDocuments({ ...userQuery, isActive: true }),
      Department.find({ company: company._id, isActive: true })
        .select("_id name departmentName title description")
        .sort({ name: 1 })
        .lean(),
      JobRole.find({ company: company._id, isActive: true })
        .select("_id name roleName jobRole title department")
        .sort({ name: 1 })
        .lean(),
    ]);

    const departmentIds = await User.distinct("department", userQuery);

    return res.status(200).json({
      success: true,
      company: normalizeCompanyForOverview(company),
      users,
      recentUsers: users.slice(0, 5),
      departments,
      jobRoles,
      stats: {
        totalUsers,
        activeUsers,
        departments: departments.length || departmentIds.filter(Boolean).length,
        todayLogins: 0,
      },
    });
  } catch (err) {
    console.error("❌ Get company overview error:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch company overview",
    });
  }
};





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

const getScopedCompanyId = (value) => {
  if (!value) return "";
  if (typeof value === "object") return String(value._id || value.id || "");
  return String(value);
};

const canManageDashboardConfig = (req, companyId) => {
  const userCompanyId = getScopedCompanyId(req.user?.company || req.user?.companyId);
  const userRole = String(req.user?.role || req.user?.jobRole || req.user?.companyRole || "").toLowerCase();
  const isPlatformAdmin = Boolean(req.user?.isSuperAdmin) || userRole === "super-admin" || userRole === "super_admin";

  return isPlatformAdmin || (userCompanyId && userCompanyId === String(companyId));
};

exports.getDashboardConfig = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid company id" });
    }
    if (!canManageDashboardConfig(req, id)) {
      return res.status(403).json({ success: false, message: "You can only manage settings for your company" });
    }
    const company = await Company.findById(id).select("dashboardConfig");
    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }
    return res.status(200).json({
      success: true,
      dashboardConfig: company.dashboardConfig || []
    });
  } catch (err) {
    console.error("❌ Get dashboard config error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch dashboard config" });
  }
};

exports.updateDashboardConfig = async (req, res) => {
  try {
    const { id } = req.params;
    const { dashboardConfig } = req.body;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid company id" });
    }
    if (!canManageDashboardConfig(req, id)) {
      return res.status(403).json({ success: false, message: "You can only manage settings for your company" });
    }
    if (!Array.isArray(dashboardConfig)) {
      return res.status(400).json({ success: false, message: "dashboardConfig must be an array" });
    }
    const company = await Company.findByIdAndUpdate(
      id,
      { $set: { dashboardConfig } },
      { new: true, runValidators: true }
    ).select("dashboardConfig");

    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }
    return res.status(200).json({
      success: true,
      message: "Dashboard configuration updated successfully",
      dashboardConfig: company.dashboardConfig
    });
  } catch (err) {
    console.error("❌ Update dashboard config error:", err);
    return res.status(500).json({ success: false, message: "Failed to update dashboard config" });
  }
};

const normalizeCoordinate = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : NaN;
};

const normalizeBoolean = (value, fallback = true) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true" || value.toLowerCase() === "yes";
  return Boolean(value);
};

exports.getCompanyLocation = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid company id" });
    }
    if (!canManageDashboardConfig(req, id)) {
      return res.status(403).json({ success: false, message: "You can only manage settings for your company" });
    }

    const company = await Company.findById(id).select("officeLocation");
    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }

    return res.status(200).json({
      success: true,
      officeLocation: company.officeLocation || {}
    });
  } catch (err) {
    console.error("Get company location error:", err);
    return res.status(500).json({ success: false, message: "Failed to fetch company location" });
  }
};

exports.updateCompanyLocation = async (req, res) => {
  try {
    const { id } = req.params;
    const latitude = normalizeCoordinate(req.body.latitude);
    const longitude = normalizeCoordinate(req.body.longitude);
    const allowedRadiusMeters = normalizeCoordinate(req.body.allowedRadiusMeters);
    const allowedRadiusEnabled = normalizeBoolean(req.body.allowedRadiusEnabled, true);

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, message: "Invalid company id" });
    }
    if (!canManageDashboardConfig(req, id)) {
      return res.status(403).json({ success: false, message: "You can only manage settings for your company" });
    }
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      return res.status(400).json({ success: false, message: "Latitude must be between -90 and 90" });
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return res.status(400).json({ success: false, message: "Longitude must be between -180 and 180" });
    }
    if (allowedRadiusEnabled && (!Number.isFinite(allowedRadiusMeters) || allowedRadiusMeters < 10 || allowedRadiusMeters > 10000)) {
      return res.status(400).json({ success: false, message: "Allowed radius must be between 10 and 10000 meters" });
    }

    const officeLocation = {
      latitude,
      longitude,
      allowedRadiusMeters: allowedRadiusEnabled ? allowedRadiusMeters : null,
      allowedRadiusEnabled,
      updatedAt: new Date()
    };

    const company = await Company.findByIdAndUpdate(
      id,
      { $set: { officeLocation } },
      { new: true, runValidators: true }
    ).select("officeLocation");

    if (!company) {
      return res.status(404).json({ success: false, message: "Company not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Company location updated successfully",
      officeLocation: company.officeLocation
    });
  } catch (err) {
    console.error("Update company location error:", err);
    return res.status(500).json({ success: false, message: "Failed to update company location" });
  }
};

void 0;
