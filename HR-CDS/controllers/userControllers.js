// HR-CDS/controllers/userControllers.js
const User = require('../../models/User');
const Department = require('../../models/Department');
const bcrypt = require('bcryptjs');
const { errorResponse, successResponse } = require('../utils/responseHelper.js');
const Task = require('../../HR-CDS/models/Task.js');

// All field names for consistent usage
const USER_FIELDS = {
  // Basic fields (required in registration)
  BASIC: ['name', 'email', 'password', 'department', 'jobRole'],
  
  // Personal information fields
  PERSONAL: ['phone', 'address', 'gender', 'maritalStatus', 'dob', 
             'fatherName', 'motherName', 'city', 'state', 'zipCode', 'country'],
  
  // Employment information fields
  EMPLOYMENT: ['employeeType', 'salary', 'properties', 'propertyOwned', 
               'additionalDetails', 'employeeId', 'companyRole', 'reportingManager',
               'dateOfJoining', 'workLocation'],
  
  // Banking information fields
  BANKING: ['accountNumber', 'ifsc', 'bankName', 'bankHolderName'],
  
  // Emergency contact fields
  EMERGENCY: ['emergencyName', 'emergencyPhone', 'emergencyRelation', 
              'emergencyAddress'],
  
  // Family fields
  FAMILY: ['children', 'spouseName'],
  
  // Document fields
  DOCUMENTS: ['documents'],
  
  // All fields combined (for reference)
  ALL: function() {
    return [
      ...this.BASIC,
      ...this.PERSONAL,
      ...this.EMPLOYMENT,
      ...this.BANKING,
      ...this.EMERGENCY,
      ...this.FAMILY,
      ...this.DOCUMENTS
    ];
  }
};

// Common validation function
const validateUserData = (data, isUpdate = false) => {
  const errors = [];
  
  if (!isUpdate) {
    // Registration validation
    USER_FIELDS.BASIC.forEach(field => {
      if (!data[field]) {
        errors.push(`${field} is required`);
      }
    });
  }

  // Email format validation
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim().toLowerCase())) {
    errors.push("Invalid email format");
  }

  // Job role validation - include super_admin
  if (data.jobRole && !['super_admin', 'admin', 'user', 'hr', 'manager'].includes(data.jobRole)) {
    errors.push("Invalid job role");
  }

  return errors;
};

// Get current user profile
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-password -resetToken -resetTokenExpiry')
      .populate('department', 'name description')
      .populate('createdBy', 'name email')
      .populate('company', 'name companyCode');

    if (!user) {
      return errorResponse(res, 404, "User not found");
    }

    return successResponse(res, 200, {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        company: user.company,
        department: user.department,
        jobRole: user.jobRole,
        phone: user.phone,
        address: user.address,
        gender: user.gender,
        maritalStatus: user.maritalStatus,
        dob: user.dob,
        employeeType: user.employeeType,
        salary: user.salary,
        accountNumber: user.accountNumber,
        ifsc: user.ifsc,
        bankName: user.bankName,
        bankHolderName: user.bankHolderName,
        fatherName: user.fatherName,
        motherName: user.motherName,
        spouseName: user.spouseName,
        children: user.children,
        documents: user.documents,
        emergencyName: user.emergencyName,
        emergencyPhone: user.emergencyPhone,
        emergencyRelation: user.emergencyRelation,
        emergencyAddress: user.emergencyAddress,
        properties: user.properties,
        propertyOwned: user.propertyOwned,
        additionalDetails: user.additionalDetails,
        employeeId: user.employeeId,
        companyRole: user.companyRole,
        reportingManager: user.reportingManager,
        dateOfJoining: user.dateOfJoining,
        workLocation: user.workLocation,
        city: user.city,
        state: user.state,
        zipCode: user.zipCode,
        country: user.country,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (err) {
    console.error("❌ Get me error:", err);
    return errorResponse(res, 500, "Failed to fetch profile");
  }
};

// Update current user profile
exports.updateMe = async (req, res) => {
  try {
    const userId = req.user.id;
    const updateData = {};
    
    // Allow more fields for self-update including family and emergency info
    const allowedFields = [
      'name', 'phone', 'address', 'gender', 'maritalStatus', 'dob',
      'fatherName', 'motherName', 'spouseName', 'children', 'documents',
      'accountNumber', 'ifsc', 'bankName', 'bankHolderName', 
      'emergencyName', 'emergencyPhone', 'emergencyRelation', 'emergencyAddress',
      'city', 'state', 'zipCode', 'country'
    ];
    
    // Extract only allowed fields
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });
    
    // Handle nested objects like children array
    if (req.body.children !== undefined) {
      updateData.children = req.body.children;
    }
    
    if (req.body.documents !== undefined) {
      updateData.documents = req.body.documents;
    }
    
    // Normal users cannot update these restricted fields
    const restrictedFields = ['jobRole', 'department', 'employeeType', 'salary', 'company', 'employeeId', 'companyRole'];
    const hasRestrictedField = restrictedFields.some(field => req.body[field] !== undefined);
    
    if (hasRestrictedField) {
      // Check if user is super_admin - allow restricted fields for super_admin
      const isSuperAdmin = req.user.jobRole === 'super_admin';
      if (!isSuperAdmin) {
        return errorResponse(res, 403, "You cannot update restricted fields (jobRole, department, employeeType, salary, company, employeeId, companyRole)");
      }
      // If super_admin, add restricted fields to updateData
      restrictedFields.forEach(field => {
        if (req.body[field] !== undefined) {
          updateData[field] = req.body[field];
        }
      });
    }
    
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { 
        new: true, 
        runValidators: true 
      }
    )
    .select('-password -resetToken -resetTokenExpiry')
    .populate('department', 'name description')
    .populate('company', 'name companyCode');
    
    return successResponse(res, 200, {
      message: "Profile updated successfully",
      user: updatedUser
    });
  } catch (err) {
    console.error("❌ Update me error:", err);
    if (err.name === 'ValidationError') {
      return errorResponse(res, 400, err.message);
    }
    return errorResponse(res, 500, "Failed to update profile");
  }
};

// Change password
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return errorResponse(res, 400, "Current password and new password are required");
    }
    
    if (newPassword.length < 6) {
      return errorResponse(res, 400, "New password must be at least 6 characters");
    }

    const user = await User.findById(req.user.id).select('+password');
    
    // Check current password
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return errorResponse(res, 400, "Current password is incorrect");
    }
    
    // Update password
    user.password = newPassword;
    await user.save();
    
    return successResponse(res, 200, {
      message: "Password changed successfully"
    });
  } catch (err) {
    console.error("❌ Change password error:", err);
    return errorResponse(res, 500, "Failed to change password");
  }
};

// Create user (Registration)
exports.register = async (req, res) => {
  try {
    // Extract all fields from request body
    const userData = {};
    USER_FIELDS.ALL().forEach(field => {
      if (req.body[field] !== undefined) {
        userData[field] = req.body[field];
      }
    });
    
    // Add additional fields that might not be in USER_FIELDS
    const extraFields = ['city', 'state', 'zipCode', 'country', 'spouseName', 'children', 'documents', 'employeeId', 'companyRole', 'reportingManager', 'dateOfJoining', 'workLocation'];
    extraFields.forEach(field => {
      if (req.body[field] !== undefined) {
        userData[field] = req.body[field];
      }
    });

    // Add createdBy if user is authenticated
    if (req.user?.id) {
      userData.createdBy = req.user.id;
    }

    // Add company from authenticated user's company
    if (req.user?.company) {
      userData.company = req.user.company;
    }

    // Validate required fields
    const validationErrors = validateUserData(userData);
    if (validationErrors.length > 0) {
      return errorResponse(res, 400, validationErrors.join(', '));
    }

    // Clean email
    if (userData.email) {
      userData.email = userData.email.trim().toLowerCase();
    }

    // Check existing user
    const existingUser = await User.findOne({ 
      email: userData.email,
      company: userData.company 
    });
    if (existingUser) {
      return errorResponse(res, 409, "Email already in use in this company");
    }

    // Check if department exists
    if (userData.department) {
      const departmentExists = await Department.findById(userData.department);
      if (!departmentExists) {
        return errorResponse(res, 404, "Department not found");
      }
    }

    // Create user
    const user = await User.create(userData);

    return successResponse(res, 201, {
      message: "User registered successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        company: user.company,
        department: user.department,
        jobRole: user.jobRole,
        phone: user.phone,
        createdAt: user.createdAt,
      },
    });
  } catch (err) {
    console.error("❌ Registration error:", err);
    return errorResponse(res, 500, "Registration failed");
  }
};

// Get all users - FILTERED BY COMPANY AND DEPARTMENT
exports.getAllUsers = async (req, res) => {
  try {
    // Get authenticated user's company and department from token
    const userCompany = req.user.company;
    const userDepartment = req.user.department;
    
    if (!userCompany) {
      return errorResponse(res, 400, "Company information is required");
    }

    // Build filter based on user role
    let filter = { 
      company: userCompany  // Always filter by company
    };

    // If user is not admin, filter by department as well
    const adminRoles = ['admin', 'super_admin'];
    const isAdmin = adminRoles.includes(req.user.jobRole);
    
    if (!isAdmin && userDepartment) {
      filter.department = userDepartment;
    }

    const users = await User.find(filter)
      .select('-password -resetToken -resetTokenExpiry')
      .populate('department', 'name description')
      .populate('company', 'name companyCode')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    // Format response with complete field structure
    const formattedUsers = users.map(user => ({
      id: user._id,
      name: user.name,
      email: user.email,
      company: user.company,
      department: user.department,
      jobRole: user.jobRole,
      phone: user.phone,
      address: user.address,
      gender: user.gender,
      maritalStatus: user.maritalStatus,
      dob: user.dob,
      employeeType: user.employeeType,
      salary: user.salary,
      accountNumber: user.accountNumber,
      ifsc: user.ifsc,
      bankName: user.bankName,
      bankHolderName: user.bankHolderName,
      fatherName: user.fatherName,
      motherName: user.motherName,
      spouseName: user.spouseName,
      children: user.children,
      documents: user.documents,
      emergencyName: user.emergencyName,
      emergencyPhone: user.emergencyPhone,
      emergencyRelation: user.emergencyRelation,
      emergencyAddress: user.emergencyAddress,
      properties: user.properties,
      propertyOwned: user.propertyOwned,
      additionalDetails: user.additionalDetails,
      employeeId: user.employeeId,
      companyRole: user.companyRole,
      reportingManager: user.reportingManager,
      dateOfJoining: user.dateOfJoining,
      workLocation: user.workLocation,
      city: user.city,
      state: user.state,
      zipCode: user.zipCode,
      country: user.country,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    }));

    return successResponse(res, 200, {
      count: formattedUsers.length,
      users: formattedUsers
    });
  } catch (err) {
    console.error("❌ Get users error:", err);
    return errorResponse(res, 500, "Failed to fetch users");
  }
};

// Get single user by ID - WITH COMPANY CHECK
exports.getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -resetToken -resetTokenExpiry')
      .populate('department', 'name description')
      .populate('company', 'name companyCode')
      .populate('createdBy', 'name email');

    if (!user) {
      return errorResponse(res, 404, "User not found");
    }

    // Check if user belongs to the same company
    if (user.company && req.user.company) {
      const userCompanyId = user.company._id ? user.company._id.toString() : user.company.toString();
      const reqCompanyId = req.user.company._id ? req.user.company._id.toString() : req.user.company.toString();
      
      if (userCompanyId !== reqCompanyId) {
        return errorResponse(res, 403, "Access denied. User belongs to a different company.");
      }
    }

    // Format response with all fields
    const formattedUser = {
      id: user._id,
      name: user.name,
      email: user.email,
      company: user.company,
      department: user.department,
      jobRole: user.jobRole,
      phone: user.phone,
      address: user.address,
      gender: user.gender,
      maritalStatus: user.maritalStatus,
      dob: user.dob,
      employeeType: user.employeeType,
      salary: user.salary,
      accountNumber: user.accountNumber,
      ifsc: user.ifsc,
      bankName: user.bankName,
      bankHolderName: user.bankHolderName,
      fatherName: user.fatherName,
      motherName: user.motherName,
      spouseName: user.spouseName,
      children: user.children,
      documents: user.documents,
      emergencyName: user.emergencyName,
      emergencyPhone: user.emergencyPhone,
      emergencyRelation: user.emergencyRelation,
      emergencyAddress: user.emergencyAddress,
      properties: user.properties,
      propertyOwned: user.propertyOwned,
      additionalDetails: user.additionalDetails,
      employeeId: user.employeeId,
      companyRole: user.companyRole,
      reportingManager: user.reportingManager,
      dateOfJoining: user.dateOfJoining,
      workLocation: user.workLocation,
      city: user.city,
      state: user.state,
      zipCode: user.zipCode,
      country: user.country,
      isActive: user.isActive,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      createdBy: user.createdBy
    };

    return successResponse(res, 200, {
      user: formattedUser
    });
  } catch (err) {
    console.error("❌ Get user error:", err);
    return errorResponse(res, 500, "Failed to fetch user");
  }
};

// ✅ UPDATED: Update user by ID - Saves ALL fields including children, documents, etc.
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Use authenticated user from middleware
    const requestingUser = req.user;
    
    if (!requestingUser) {
      return errorResponse(res, 401, "Authentication required");
    }

    // First, get the user to check company
    const user = await User.findById(id);
    if (!user) {
      return errorResponse(res, 404, "User not found");
    }

    // Check if user belongs to the same company
    if (user.company && requestingUser.company) {
      const userCompanyId = user.company._id ? user.company._id.toString() : user.company.toString();
      const reqCompanyId = requestingUser.company._id ? requestingUser.company._id.toString() : requestingUser.company.toString();
      
      if (userCompanyId !== reqCompanyId) {
        return errorResponse(res, 403, "Access denied. User belongs to a different company.");
      }
    }

    // Check permissions - Only super_admin or admin can update other users
    const isSuperAdmin = requestingUser.jobRole === 'super_admin';
    const isAdmin = requestingUser.jobRole === 'admin';
    const isSelfUpdate = requestingUser.id.toString() === id;
    
    if (!isSelfUpdate && !isSuperAdmin && !isAdmin) {
      return errorResponse(res, 403, "You don't have permission to update other users");
    }

    // Create update data from entire request body (NO RESTRICTIONS!)
    const updateData = {};
    
    // Get all fields from request body
    Object.keys(req.body).forEach(key => {
      // Skip sensitive fields that shouldn't be updated directly
      if (key !== 'password' && key !== 'resetToken' && key !== 'resetTokenExpiry' && key !== '__v') {
        updateData[key] = req.body[key];
      }
    });
    
    // Special handling for arrays
    if (req.body.children !== undefined) {
      updateData.children = req.body.children;
    }
    
    if (req.body.documents !== undefined) {
      updateData.documents = req.body.documents;
    }
    
    if (req.body.properties !== undefined) {
      updateData.properties = req.body.properties;
    }
    
    // For non-super_admin updating others, restrict certain fields
    if (!isSelfUpdate && !isSuperAdmin) {
      // Admin can update but not change jobRole to super_admin
      if (updateData.jobRole === 'super_admin') {
        delete updateData.jobRole;
      }
    }
    
    // For self-update (non-super_admin), restrict sensitive fields
    // For self-update (non-super_admin), restrict limited fields only
      if (isSelfUpdate && !isSuperAdmin) {
        const restrictedForSelf = ['employeeId', 'companyRole', 'salary', 'employeeType'];
        restrictedForSelf.forEach(field => {
          delete updateData[field];
        });
      }

    // Validate department if being updated
    if (updateData.department) {
      const departmentExists = await Department.findById(updateData.department);
      if (!departmentExists) {
        return errorResponse(res, 404, "Department not found");
      }
    }

    // Validate job role if being updated
    if (updateData.jobRole && !['super_admin', 'admin', 'user', 'hr', 'manager'].includes(updateData.jobRole)) {
      return errorResponse(res, 400, "Invalid job role");
    }

    // Handle password update separately
    if (req.body.password) {
      updateData.password = req.body.password;
    }

    // Update user - save ALL fields
    const updatedUser = await User.findByIdAndUpdate(
      id,
      { $set: updateData },
      { 
        new: true, 
        runValidators: true,
        context: 'query'
      }
    )
    .select('-password -resetToken -resetTokenExpiry')
    .populate('department', 'name description')
    .populate('company', 'name companyCode')
    .populate('createdBy', 'name email');

    return successResponse(res, 200, {
      message: "User updated successfully",
      user: updatedUser
    });
  } catch (err) {
    console.error("❌ Update user error:", err);
    if (err.name === 'ValidationError') {
      return errorResponse(res, 400, err.message);
    }
    return errorResponse(res, 500, "Failed to update user: " + err.message);
  }
};

// Update self user (deprecated - use updateUser instead)
exports.updateSelfUser = async (req, res) => {
  try {
    const { id } = req.params;
    const requestingUser = req.user;
    
    if (!requestingUser) {
      return errorResponse(res, 401, "Authentication required");
    }

    const user = await User.findById(id);
    if (!user) {
      return errorResponse(res, 404, "User not found");
    }

    // Check if user is updating themselves
    const requestingUserId = requestingUser._id || requestingUser.id;
    const targetUserId = user._id || id;
    
    if (requestingUserId.toString() !== targetUserId.toString()) {
      return errorResponse(res, 403, "You can only update your own profile");
    }

    const updateData = {};
    
    // Get all fields from request body
    Object.keys(req.body).forEach(key => {
      if (key !== 'password' && key !== 'resetToken' && key !== 'resetTokenExpiry' && key !== '__v') {
        updateData[key] = req.body[key];
      }
    });
    
    // Restrict sensitive fields for self-update
    const restrictedForSelf = ['jobRole', 'department', 'employeeId', 'companyRole', 'salary', 'employeeType'];
    restrictedForSelf.forEach(field => {
      delete updateData[field];
    });

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    )
    .select('-password -resetToken -resetTokenExpiry')
    .populate('department', 'name description')
    .populate('company', 'name companyCode');

    return successResponse(res, 200, {
      message: "Profile updated successfully",
      user: updatedUser
    });
  } catch (err) {
    console.error("❌ Update self user error:", err);
    return errorResponse(res, 500, "Failed to update profile");
  }
};

// ✅ UPDATED: Delete user by ID (Permanent Hard Delete) - WITH COMPANY CHECK
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Use authenticated user from middleware
    const requestingUser = req.user;
    
    if (!requestingUser) {
      return errorResponse(res, 401, "Authentication required");
    }

    // Check if user exists before deletion
    const user = await User.findById(id);
    if (!user) {
      return errorResponse(res, 404, "User not found");
    }

    // Check if user belongs to the same company
    if (user.company && requestingUser.company) {
      const userCompanyId = user.company._id ? user.company._id.toString() : user.company.toString();
      const reqCompanyId = requestingUser.company._id ? requestingUser.company._id.toString() : requestingUser.company.toString();
      
      if (userCompanyId !== reqCompanyId) {
        return errorResponse(res, 403, "Access denied. User belongs to a different company.");
      }
    }
    
    // Check permissions - only super_admin can delete
    const canDelete = ['super_admin'].includes(requestingUser.jobRole);
    if (!canDelete) {
      return errorResponse(res, 403, "You don't have permission to delete users. Only super_admin can delete users.");
    }
    
    // Prevent self-deletion
    const requestingUserId = requestingUser._id || requestingUser.id;
    const targetUserId = user._id || id;
    
    if (requestingUserId.toString() === targetUserId.toString()) {
      return errorResponse(res, 400, "You cannot delete your own account");
    }

    // 🔥 PERMANENT HARD DELETE - Remove user completely from database
    await User.findByIdAndDelete(id);

    return successResponse(res, 200, {
      message: "User deleted permanently from database",
      deletedUser: {
        id: user._id,
        name: user.name,
        email: user.email,
        company: user.company,
        department: user.department
      }
    });
  } catch (err) {
    console.error("❌ Delete user error:", err);
    return errorResponse(res, 500, "Failed to delete user permanently: " + err.message);
  }
};

// Restore soft-deleted user - WITH COMPANY CHECK
exports.restoreUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      return errorResponse(res, 404, "User not found");
    }

    // Check if user belongs to the same company
    if (user.company && req.user.company) {
      const userCompanyId = user.company._id ? user.company._id.toString() : user.company.toString();
      const reqCompanyId = req.user.company._id ? req.user.company._id.toString() : req.user.company.toString();
      
      if (userCompanyId !== reqCompanyId) {
        return errorResponse(res, 403, "Access denied. User belongs to a different company.");
      }
    }

    // Restore original email (remove deleted suffix)
    const originalEmail = user.email.split('_deleted_')[0];
    
    await User.findByIdAndUpdate(id, { 
    
      deletedAt: null,
      email: originalEmail
    });

    return successResponse(res, 200, {
      message: "User restored successfully"
    });
  } catch (err) {
    console.error("❌ Restore user error:", err);
    return errorResponse(res, 500, "Failed to restore user");
  }
};

// Get deleted users - FILTERED BY COMPANY
exports.getDeletedUsers = async (req, res) => {
  try {
    const userCompany = req.user.company;
    
    if (!userCompany) {
      return errorResponse(res, 400, "Company information is required");
    }

    const users = await User.find({ 
      isActive: false,
      company: userCompany  // Filter by company
    })
      .select('-password -resetToken -resetTokenExpiry')
      .populate('department', 'name description')
      .populate('company', 'name companyCode')
      .sort({ deletedAt: -1 });

    return successResponse(res, 200, {
      count: users.length,
      users
    });
  } catch (err) {
    console.error("❌ Get deleted users error:", err);
    return errorResponse(res, 500, "Failed to fetch deleted users");
  }
};

// Get company users with department filter
exports.getCompanydepartmentUsers = async (req, res) => {
  try {
    console.log("📊 GET request received for company users");
    
    if (req.params.id && req.params.id === 'department-users') {
      return errorResponse(res, 400, "Invalid endpoint. Use GET /users/department-users");
    }
    
    const currentUser = req.user;
    
    if (!currentUser) {
      return errorResponse(res, 401, "Authentication required");
    }
    
    const companyId = currentUser.company;
    
    if (!companyId) {
      return errorResponse(res, 400, "User does not belong to any company");
    }
    
    console.log("🔍 Fetching users for company ID:", companyId);
    
    const filter = { 
     
      company: companyId,
      companyRole: { 
        $exists: true,
        $not: /^client$/i 
      }
    };
    
    const adminRoles = ['admin', 'hr', 'manager', 'super_admin'];
    if (!adminRoles.includes(currentUser.jobRole) && currentUser.department) {
      filter.department = currentUser.department;
    }
    
    const users = await User.find(filter)
      .select('-password -resetToken -resetTokenExpiry')
      .populate('department', 'name description')
      .populate('company', 'name companyCode companyEmail companyPhone companyAddress logo')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });
    
    console.log(`✅ Found ${users.length} users`);
    
    return successResponse(res, 200, {
      company: {
        id: companyId,
        name: currentUser.companyName || 'Company'
      },
      count: users.length,
      users: users.map(user => ({
        id: user._id,
        name: user.name,
        email: user.email,
        company: user.company,
        department: user.department,
        jobRole: user.jobRole,
        phone: user.phone,
        address: user.address,
        gender: user.gender,
        maritalStatus: user.maritalStatus,
        dob: user.dob,
        employeeType: user.employeeType,
        salary: user.salary,
        accountNumber: user.accountNumber,
        ifsc: user.ifsc,
        bankName: user.bankName,
        bankHolderName: user.bankHolderName,
        fatherName: user.fatherName,
        motherName: user.motherName,
        spouseName: user.spouseName,
        children: user.children,
        documents: user.documents,
        emergencyName: user.emergencyName,
        emergencyPhone: user.emergencyPhone,
        emergencyRelation: user.emergencyRelation,
        emergencyAddress: user.emergencyAddress,
        properties: user.properties,
        propertyOwned: user.propertyOwned,
        additionalDetails: user.additionalDetails,
        employeeId: user.employeeId,
        companyRole: user.companyRole,
        reportingManager: user.reportingManager,
        dateOfJoining: user.dateOfJoining,
        workLocation: user.workLocation,
        city: user.city,
        state: user.state,
        zipCode: user.zipCode,
        country: user.country,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }))
    });
    
  } catch (err) {
    console.error("❌ Get company users error:", err.message);
    return errorResponse(res, 500, "Failed to fetch company users");
  }
};

// Get company users with complete data
exports.getCompanyUsers = async (req, res) => {
  try {
    const currentUser = req.user;

    if (!currentUser) {
      return errorResponse(res, 401, "Authentication required");
    }

    const companyId = currentUser.company;

    if (!companyId) {
      return errorResponse(res, 400, "User does not belong to any company");
    }

    const filter = {
      
      company: companyId,
      companyRole: { 
        $exists: true,
        $not: /^client$/i 
      }
    };

    const users = await User.find(filter)
      .select("-password -resetToken -resetTokenExpiry")
      .populate("department", "name description")
      .populate("company", "name companyCode");

    // Format users with complete data and task stats
    const usersWithStats = await Promise.all(
      users.map(async (user) => {
        const total = await Task.countDocuments({
          assignedTo: user._id,
          company: companyId
        });

        const completed = await Task.countDocuments({
          assignedTo: user._id,
          company: companyId,
          status: "completed"
        });

        const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

        return {
          id: user._id,
          name: user.name,
          email: user.email,
          company: user.company,
          department: user.department,
          jobRole: user.jobRole,
          phone: user.phone,
          address: user.address,
          gender: user.gender,
          maritalStatus: user.maritalStatus,
          dob: user.dob,
          employeeType: user.employeeType,
          salary: user.salary,
          accountNumber: user.accountNumber,
          ifsc: user.ifsc,
          bankName: user.bankName,
          bankHolderName: user.bankHolderName,
          fatherName: user.fatherName,
          motherName: user.motherName,
          spouseName: user.spouseName,
          children: user.children,
          documents: user.documents,
          emergencyName: user.emergencyName,
          emergencyPhone: user.emergencyPhone,
          emergencyRelation: user.emergencyRelation,
          emergencyAddress: user.emergencyAddress,
          properties: user.properties,
          propertyOwned: user.propertyOwned,
          additionalDetails: user.additionalDetails,
          employeeId: user.employeeId,
          companyRole: user.companyRole,
          reportingManager: user.reportingManager,
          dateOfJoining: user.dateOfJoining,
          workLocation: user.workLocation,
          city: user.city,
          state: user.state,
          zipCode: user.zipCode,
          country: user.country,
          isActive: user.isActive,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          taskStats: {
            total,
            completed,
            completionRate
          }
        };
      })
    );

    return successResponse(res, 200, {
      count: usersWithStats.length,
      users: usersWithStats
    });

  } catch (err) {
    console.error("❌ Get company users error:", err);
    return errorResponse(res, 500, "Failed to fetch company users");
  }
};

// Get company users with pagination
exports.getCompanyUsersPaginated = async (req, res) => {
  try {
    console.log("📊 GET request received for company users");
    
    const currentUser = req.user;
    
    if (!currentUser) {
      return errorResponse(res, 401, "Authentication required");
    }
    
    const companyId = currentUser.company;
    
    if (!companyId) {
      return errorResponse(res, 400, "User does not belong to any company");
    }
    
    console.log("🔍 Current User:", {
      id: currentUser.id,
      name: currentUser.name,
      company: companyId,
      jobRole: currentUser.jobRole,
      department: currentUser.department,
      companyRole: currentUser.companyRole,
    });
    
    const filter = { 
     
      company: companyId,
      companyRole: { 
        $exists: true,
        $not: /^client$/i 
      }
    };
    
    const adminRoles = ['admin', 'hr', 'manager', 'super_admin'];
    if (!adminRoles.includes(currentUser.jobRole) && currentUser.department) {
      filter.department = currentUser.department;
      console.log("🔍 Filtering by department:", currentUser.department);
    }
    
    console.log("🔍 Database filter:", filter);
    
    const users = await User.find(filter)
      .select('-password -resetToken -resetTokenExpiry')
      .populate('department', 'name description')
      .populate('company', 'name companyCode companyEmail companyPhone companyAddress logo')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });
    
    console.log(`✅ Found ${users.length} users`);
    
    return successResponse(res, 200, {
      company: {
        id: companyId,
        name: currentUser.companyName || currentUser.company?.name || 'Company',
        companyCode: currentUser.companyCode || currentUser.company?.companyCode
      },
      currentUser: {
        id: currentUser.id,
        name: currentUser.name,
        jobRole: currentUser.jobRole
      },
      count: users.length,
      users: users.map(user => ({
        id: user._id,
        name: user.name,
        email: user.email,
        company: user.company,
        department: user.department,
        jobRole: user.jobRole,
        phone: user.phone,
        address: user.address,
        gender: user.gender,
        maritalStatus: user.maritalStatus,
        dob: user.dob,
        employeeType: user.employeeType,
        salary: user.salary,
        accountNumber: user.accountNumber,
        ifsc: user.ifsc,
        bankName: user.bankName,
        bankHolderName: user.bankHolderName,
        fatherName: user.fatherName,
        motherName: user.motherName,
        spouseName: user.spouseName,
        children: user.children,
        documents: user.documents,
        emergencyName: user.emergencyName,
        emergencyPhone: user.emergencyPhone,
        emergencyRelation: user.emergencyRelation,
        emergencyAddress: user.emergencyAddress,
        properties: user.properties,
        propertyOwned: user.propertyOwned,
        additionalDetails: user.additionalDetails,
        employeeId: user.employeeId,
        companyRole: user.companyRole,
        reportingManager: user.reportingManager,
        dateOfJoining: user.dateOfJoining,
        workLocation: user.workLocation,
        city: user.city,
        state: user.state,
        zipCode: user.zipCode,
        country: user.country,
        isActive: user.isActive,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }))
    });
    
  } catch (err) {
    console.error("❌ Get company users error:", err.message);
    console.error("❌ Error stack:", err.stack);
    return errorResponse(res, 500, "Failed to fetch company users: " + err.message);
  }
};

// Search users with filters - FILTERED BY COMPANY AND DEPARTMENT
exports.searchUsers = async (req, res) => {
  try {
    const { 
      name, email, department, jobRole, employeeType,
      gender, maritalStatus, isActive 
    } = req.query;

    const userCompany = req.user.company;
    const userDepartment = req.user.department;
    
    if (!userCompany) {
      return errorResponse(res, 400, "Company information is required");
    }

    const filter = { company: userCompany };

    const adminRoles = ['admin', 'super_admin'];
    const isAdmin = adminRoles.includes(req.user.jobRole);
    
    if (!isAdmin && userDepartment) {
      filter.department = userDepartment;
    }

    if (name) filter.name = { $regex: name, $options: 'i' };
    if (email) filter.email = { $regex: email, $options: 'i' };
    if (department) filter.department = department;
    if (jobRole) filter.jobRole = jobRole;
    if (employeeType) filter.employeeType = employeeType;
    if (gender) filter.gender = gender;
    if (maritalStatus) filter.maritalStatus = maritalStatus;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const users = await User.find(filter)
      .select('-password -resetToken -resetTokenExpiry')
      .populate('department', 'name description')
      .populate('company', 'name companyCode')
      .sort({ createdAt: -1 });

    return successResponse(res, 200, {
      count: users.length,
      users
    });
  } catch (err) {
    console.error("❌ Search users error:", err);
    return errorResponse(res, 500, "Failed to search users");
  }
};

console.log("✅ userControllers.js loaded successfully");