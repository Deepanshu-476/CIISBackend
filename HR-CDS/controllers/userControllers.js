// HR-CDS/controllers/userControllers.js
const User = require('../../models/User');
const Department = require('../../models/Department');
const bcrypt = require('bcryptjs');
const { errorResponse, successResponse } = require('../utils/responseHelper.js');

// All field names for consistent usage
const USER_FIELDS = {
  // Basic fields (required in registration)
  BASIC: ['name', 'email', 'password', 'department', 'jobRole'],
  
  // Personal information fields
  PERSONAL: ['phone', 'address', 'gender', 'maritalStatus', 'dob', 
             'fatherName', 'motherName'],
  
  // Employment information fields
  EMPLOYMENT: ['employeeType', 'salary', 'properties', 'propertyOwned', 
               'additionalDetails'],
  
  // Banking information fields
  BANKING: ['accountNumber', 'ifsc', 'bankName', 'bankHolderName'],
  
  // Emergency contact fields
  EMERGENCY: ['emergencyName', 'emergencyPhone', 'emergencyRelation', 
              'emergencyAddress'],
  
  // All fields combined (for reference)
  ALL: function() {
    return [
      ...this.BASIC,
      ...this.PERSONAL,
      ...this.EMPLOYMENT,
      ...this.BANKING,
      ...this.EMERGENCY
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

  // Job role validation
  if (data.jobRole && !['admin', 'user', 'hr', 'manager'].includes(data.jobRole)) {
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
      .populate('createdBy', 'name email');

    if (!user) {
      return errorResponse(res, 404, "User not found");
    }

    return successResponse(res, 200, {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
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
        emergencyName: user.emergencyName,
        emergencyPhone: user.emergencyPhone,
        emergencyRelation: user.emergencyRelation,
        emergencyAddress: user.emergencyAddress,
        properties: user.properties,
        propertyOwned: user.propertyOwned,
        additionalDetails: user.additionalDetails,
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
    
    // Fields that normal users can update
    const allowedFields = [
      'name', 'phone', 'address', 'gender', 'maritalStatus', 'dob',
      'fatherName', 'motherName', 'accountNumber', 'ifsc', 'bankName',
      'bankHolderName', 'emergencyName', 'emergencyPhone', 
      'emergencyRelation', 'emergencyAddress'
    ];
    
    // Extract only allowed fields
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });

    // Normal users cannot update these fields
    if (req.body.jobRole || req.body.department || req.body.employeeType || req.body.salary) {
      return errorResponse(res, 403, "You cannot update restricted fields");
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
    .populate('department', 'name description');

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

    // Add createdBy if user is authenticated
    if (req.user?.id) {
      userData.createdBy = req.user.id;
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
    const existingUser = await User.findOne({ email: userData.email });
    if (existingUser) {
      return errorResponse(res, 409, "Email already in use");
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

// Get all users
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({ isActive: true })
      .select('-password -resetToken -resetTokenExpiry')
      .populate('department', 'name description')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    // Format response with consistent field structure
    const formattedUsers = users.map(user => ({
      id: user._id,
      name: user.name,
      email: user.email,
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
      emergencyName: user.emergencyName,
      emergencyPhone: user.emergencyPhone,
      emergencyRelation: user.emergencyRelation,
      emergencyAddress: user.emergencyAddress,
      properties: user.properties,
      propertyOwned: user.propertyOwned,
      additionalDetails: user.additionalDetails,
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

// Get single user by ID
exports.getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -resetToken -resetTokenExpiry')
      .populate('department', 'name description')
      .populate('createdBy', 'name email');

    if (!user) {
      return errorResponse(res, 404, "User not found");
    }

    // Format response with all fields
    const formattedUser = {
      id: user._id,
      name: user.name,
      email: user.email,
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
      emergencyName: user.emergencyName,
      emergencyPhone: user.emergencyPhone,
      emergencyRelation: user.emergencyRelation,
      emergencyAddress: user.emergencyAddress,
      properties: user.properties,
      propertyOwned: user.propertyOwned,
      additionalDetails: user.additionalDetails,
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

// Update user by ID
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Use authenticated user from middleware
    const requestingUser = req.user;
    
    if (!requestingUser) {
      return errorResponse(res, 401, "Authentication required");
    }

    const updateData = {};
    
    // Extract only valid user fields from request body
    USER_FIELDS.ALL().forEach(field => {
      if (req.body[field] !== undefined && field !== 'password' && field !== 'email') {
        updateData[field] = req.body[field];
      }
    });

    // Find user to update
    const user = await User.findById(id);
    if (!user) {
      return errorResponse(res, 404, "User not found");
    }

    // Admin, HR, Manager roles
    const adminRoles = ['admin', 'hr', 'manager'];
    
    // Check if requesting user has admin rights
    const isAdmin = adminRoles.includes(requestingUser.jobRole);
    
    // IMPORTANT: Check if normal user is trying to update someone else's profile
    if (!isAdmin) {
      // User ID comparison
      const requestingUserId = requestingUser._id || requestingUser.id;
      const targetUserId = user._id || id;
      
      if (requestingUserId.toString() !== targetUserId.toString()) {
        return errorResponse(res, 403, "You can only update your own profile");
      }
      
      // Normal users cannot update jobRole or department
      if (updateData.jobRole || updateData.department) {
        return errorResponse(res, 403, "You cannot update job role or department");
      }
    }

    // If updating department, validate it exists
    if (updateData.department) {
      const departmentExists = await Department.findById(updateData.department);
      if (!departmentExists) {
        return errorResponse(res, 404, "Department not found");
      }
    }

    // Validate job role if being updated
    if (updateData.jobRole && !['admin', 'user', 'hr', 'manager'].includes(updateData.jobRole)) {
      return errorResponse(res, 400, "Invalid job role");
    }

    // Handle password update separately
    if (req.body.password) {
      updateData.password = req.body.password;
    }

    // Update user
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
    return errorResponse(res, 500, "Failed to update user");
  }
};

// Delete user by ID (Soft delete)
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Use authenticated user from middleware
    const requestingUser = req.user;
    
    if (!requestingUser) {
      return errorResponse(res, 401, "Authentication required");
    }

    // Check if user exists
    const user = await User.findById(id);
    if (!user) {
      return errorResponse(res, 404, "User not found");
    }
    
    // Check permissions - only admin or can delete
    const canDelete = ['admin'].includes(requestingUser.jobRole);
    if (!canDelete) {
      return errorResponse(res, 403, "You don't have permission to delete users");
    }
    
    // Prevent self-deletion
    const requestingUserId = requestingUser._id || requestingUser.id;
    const targetUserId = user._id || id;
    
    if (requestingUserId.toString() === targetUserId.toString()) {
      return errorResponse(res, 400, "You cannot delete your own account");
    }

    // Soft delete (deactivate)
    await User.findByIdAndUpdate(id, { 
      isActive: false,
      deletedAt: new Date(),
      // Append timestamp to email to allow reuse
      email: `${user.email}_deleted_${Date.now()}@deleted.com`
    });

    return successResponse(res, 200, {
      message: "User deleted successfully"
    });
  } catch (err) {
    console.error("❌ Delete user error:", err);
    return errorResponse(res, 500, "Failed to delete user");
  }
};

// Restore soft-deleted user
exports.restoreUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      return errorResponse(res, 404, "User not found");
    }

    // Restore original email (remove deleted suffix)
    const originalEmail = user.email.split('_deleted_')[0];
    
    await User.findByIdAndUpdate(id, { 
      isActive: true,
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

// Get deleted users
exports.getDeletedUsers = async (req, res) => {
  try {
    const users = await User.find({ isActive: false })
      .select('-password -resetToken -resetTokenExpiry')
      .populate('department', 'name description')
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

// Search users with filters
exports.searchUsers = async (req, res) => {
  try {
    const { 
      name, email, department, jobRole, employeeType,
      gender, maritalStatus, isActive 
    } = req.query;

    const filter = {};

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