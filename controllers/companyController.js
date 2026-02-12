// controllers/companyController.js
const Company = require("../models/Company");
const User = require("../models/User");
const crypto = require("crypto");
const mongoose = require("mongoose");

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


exports.createCompany = async (req, res) => {
  let transactionCompleted = false;
  let companyCreated = false;
  let createdCompany = null;
  
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
    const trimmedPhone = companyPhone.trim();

    // Generate company code FIRST (before duplicate check)
    const generateCompanyCode = (name) => {
      // Take first 3-4 letters, remove spaces and special chars, make uppercase
      const code = name
        .replace(/[^a-zA-Z0-9]/g, '') // Remove special characters
        .substring(0, 6) // Increased to 6 for better uniqueness
        .toUpperCase();
      
      // If code is less than 3 chars, add some numbers
      if (code.length < 3) {
        return `${code}${Math.floor(100 + Math.random() * 900)}`;
      }
      
      return code;
    };

    const companyCode = generateCompanyCode(trimmedCompanyName);
    
    // ✅ Generate dbIdentifier for multi-tenancy
    const dbIdentifier = `company_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Check for duplicates including company code
    const [existingCompanyEmail, existingCompanyPhone, existingCompanyName, existingUserEmail, existingCompanyCode] = await Promise.all([
      Company.findOne({ companyEmail: lowerCompanyEmail }),
      Company.findOne({ companyPhone: trimmedPhone }),
      Company.findOne({ 
        companyName: { $regex: new RegExp(`^${trimmedCompanyName}$`, 'i') }
      }),
      User.findOne({ email: lowerOwnerEmail }),
      Company.findOne({ companyCode }) // Check if company code already exists
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

    if (existingCompanyCode) {
      // If company code exists, generate a new one with suffix
      const newCompanyCode = `${companyCode}${Math.floor(10 + Math.random() * 90)}`;
      return res.status(409).json({
        success: false,
        message: `Company code '${companyCode}' already exists`,
        field: "companyCode",
        value: companyCode,
        suggestion: `Please use '${newCompanyCode}' instead`,
        alternativeCode: newCompanyCode
      });
    }

    // ✅ 3. CREATE COMPANY IN TRANSACTION
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // ✅ CREATE COMPANY WITH ALL FIELDS INCLUDING loginUrl
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const frontendLoginUrl = `/company/${companyCode}/login`;
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
        loginUrl: frontendLoginUrl, // ✅ SET HERE with companyCode
        apiLoginUrl: apiLoginUrl, // ✅ SET HERE
        dbIdentifier: dbIdentifier,
        isActive: true,
        // Other fields...
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
      }], { session });

      const createdOwner = ownerUser[0];

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

      return res.status(201).json({
        success: true,
        message: "Company registered successfully 🎉",
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
        metadata: {
          timestamp: new Date().toISOString(),
          transactionId: createdCompany._id.toString(),
          stepsCompleted: ["company_creation", "owner_creation", "token_generation"]
        }
      });

    } catch (transactionError) {
      // Rollback transaction on error
      await session.abortTransaction();
      
      // Re-throw to be caught by outer catch block
      throw transactionError;
    } finally {
      session.endSession();
    }

  } catch (err) {
    console.error("❌ Create company error:", err);
    
    // ✅ 7. ENHANCED ERROR HANDLING WITH CLEANUP
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

    // ✅ 8. CLEANUP IF PARTIALLY CREATED
    if (cleanupRequired && !transactionCompleted) {
      try {
        // Attempt to clean up partially created data
        if (companyCreated && createdCompany) {
          await Company.findByIdAndDelete(createdCompany._id);
          await User.deleteMany({ company: createdCompany._id });
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