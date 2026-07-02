
const User = require('../../models/User');
const Department = require('../../models/Department');
const bcrypt = require('bcryptjs');
const { errorResponse, successResponse } = require('../utils/responseHelper.js');
const Task = require('../../HR-CDS/models/Task.js');
const { getPaginationOptions, buildPaginationMeta } = require('../../utils/pagination');

const getSocketOnlineUserIds = (companyId) => {
  const onlineIds = new Set();
  const companyKey = companyId?.toString();

  if (!global.io?.sockets?.sockets) return onlineIds;

  global.io.sockets.sockets.forEach(socket => {
    const socketUserId = socket.userId?.toString();
    const socketCompanyId = socket.companyId?.toString();

    if (!socketUserId) return;
    if (companyKey && socketCompanyId !== companyKey) return;

    onlineIds.add(socketUserId);
  });

  return onlineIds;
};

const isRecentlyOnlineInDb = (user) => {
  if (!user?.isOnline) return false;
  if (!user.lastSeen) return true;

  const lastSeenTime = new Date(user.lastSeen).getTime();
  if (Number.isNaN(lastSeenTime)) return true;

  return Date.now() - lastSeenTime < 30 * 1000;
};

const validateAssignableDepartment = async (departmentId, companyId) => {
  const department = await Department.findById(departmentId);

  if (!department) {
    return { status: 404, message: "Department not found" };
  }

  const departmentCompanyId = department.company?._id
    ? department.company._id.toString()
    : department.company?.toString();
  const targetCompanyId = companyId?._id ? companyId._id.toString() : companyId?.toString();

  if (departmentCompanyId && targetCompanyId && departmentCompanyId !== targetCompanyId) {
    return { status: 403, message: "Department belongs to a different company" };
  }

  return null;
};

const getUserPresence = (user, socketOnlineIds) => {
  const userId = user?._id?.toString() || user?.id?.toString();

  return {
    isOnline: Boolean(userId && socketOnlineIds.has(userId)) || isRecentlyOnlineInDb(user),
    lastSeen: user?.lastSeen || null,
  };
};

const shouldIncludeInactiveUsers = (query = {}) => {
  const value = query.includeInactive ?? query.withInactive;
  return value === true || value === 'true' || value === '1' || value === 'all';
};

const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getCompanyScope = (req) => {
  const company = req.user?.company;
  const companyId = company?._id || company?.id || company;
  const companyCode = req.user?.companyCode || company?.companyCode;
  const requestedCompanyCode = req.query?.companyCode?.trim();

  if (!companyId || !companyCode) {
    return { error: { status: 400, message: "User company information is incomplete" } };
  }

  if (requestedCompanyCode && requestedCompanyCode.toLowerCase() !== String(companyCode).toLowerCase()) {
    return { error: { status: 403, message: "You cannot access another company's users" } };
  }

  return {
    companyId,
    companyCode,
    filter: {
      company: companyId,
      companyCode: new RegExp(`^${escapeRegExp(companyCode)}$`, 'i')
    }
  };
};


const USER_FIELDS = {
  
  BASIC: ['name', 'email', 'password', 'department', 'jobRole'],
  
  
  PERSONAL: ['phone', 'address', 'gender', 'maritalStatus', 'dob', 
             'fatherName', 'motherName', 'city', 'state', 'zipCode', 'country'],
  
  
  EMPLOYMENT: ['employeeType', 'salary', 'properties', 'propertyOwned', 
               'additionalDetails', 'employeeId', 'companyRole', 'reportingManager',
               'dateOfJoining', 'workLocation'],
  
  
  BANKING: ['accountNumber', 'ifsc', 'bankName', 'bankHolderName'],
  
  
  EMERGENCY: ['emergencyName', 'emergencyPhone', 'emergencyRelation', 
              'emergencyAddress'],
  
  
  FAMILY: ['children', 'spouseName'],
  
  
  DOCUMENTS: ['documents'],
  
  
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


const validateUserData = (data, isUpdate = false) => {
  const errors = [];
  
  if (!isUpdate) {
    
    USER_FIELDS.BASIC.forEach(field => {
      if (!data[field]) {
        errors.push(`${field} is required`);
      }
    });
  }

  
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim().toLowerCase())) {
    errors.push("Invalid email format");
  }

  
  if (data.jobRole && typeof data.jobRole !== 'string') {
    errors.push("Invalid job role");
  }

  return errors;
};


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


exports.updateMe = async (req, res) => {
  try {
    const userId = req.user.id;
    const updateData = {};
    
    
    Object.keys(req.body).forEach(key => {
      
      if (key !== 'password' && key !== 'resetToken' && key !== 'resetTokenExpiry' && key !== '__v') {
        updateData[key] = req.body[key];
      }
    });
    
    
    if (req.body.children !== undefined) {
      updateData.children = req.body.children;
    }
    
    if (req.body.documents !== undefined) {
      updateData.documents = req.body.documents;
    }
    
    if (req.body.properties !== undefined) {
      updateData.properties = req.body.properties;
    }

    if (updateData.department) {
      const departmentError = await validateAssignableDepartment(updateData.department, req.user.company);
      if (departmentError) {
        return errorResponse(res, departmentError.status, departmentError.message);
      }
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
    
    
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return errorResponse(res, 400, "Current password is incorrect");
    }
    
    
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


exports.register = async (req, res) => {
  try {
    
    const userData = {};
    USER_FIELDS.ALL().forEach(field => {
      if (req.body[field] !== undefined) {
        userData[field] = req.body[field];
      }
    });
    
    
    const extraFields = ['city', 'state', 'zipCode', 'country', 'spouseName', 'children', 'documents', 'employeeId', 'companyRole', 'reportingManager', 'dateOfJoining', 'workLocation'];
    extraFields.forEach(field => {
      if (req.body[field] !== undefined) {
        userData[field] = req.body[field];
      }
    });

    
    if (req.user?.id) {
      userData.createdBy = req.user.id;
    }

    
    if (req.user?.company) {
      userData.company = req.user.company;
    }

    
    const validationErrors = validateUserData(userData);
    if (validationErrors.length > 0) {
      return errorResponse(res, 400, validationErrors.join(', '));
    }

    
    if (userData.email) {
      userData.email = userData.email.trim().toLowerCase();
    }

    
    const existingUser = await User.findOne({ 
      email: userData.email,
      company: userData.company 
    });
    if (existingUser) {
      return errorResponse(res, 409, "Email already in use in this company");
    }

    
    if (userData.department) {
      const departmentExists = await Department.findById(userData.department);
      if (!departmentExists) {
        return errorResponse(res, 404, "Department not found");
      }
    }

    
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


exports.getAllUsers = async (req, res) => {
  try {
    const { page, limit, skip } = getPaginationOptions(req.query, { limit: 25, maxLimit: 100 });
    
    const userCompany = req.user.company;
    const userDepartment = req.user.department;
    
    if (!userCompany) {
      return errorResponse(res, 400, "Company information is required");
    }

    
    let filter = { 
      company: userCompany  
    };

    
    
    const authorizedRoles = ['admin', 'super_admin', 'hr', 'manager', 'employee'];
    const isAuthorized = authorizedRoles.includes(req.user.jobRole);
    
    if (!isAuthorized && userDepartment) {
      filter.department = userDepartment;
    }

    const search = String(req.query.search || req.query.q || '').trim();
    if (search) {
      const searchRegex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { employeeId: searchRegex },
        { phone: searchRegex }
      ];
    }

    const [users, total] = await Promise.all([
      User.find(filter)
      .select('-password -resetToken -resetTokenExpiry')
      .populate('department', 'name description')
        .populate('company', 'companyName companyCode')
      .populate('createdBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter)
    ]);

    
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
      total,
      pagination: buildPaginationMeta({ page, limit, total }),
      users: formattedUsers,
      data: formattedUsers
    });
  } catch (err) {
    console.error("❌ Get users error:", err);
    return errorResponse(res, 500, "Failed to fetch users");
  }
};


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

    
    if (user.company && req.user.company) {
      const userCompanyId = user.company._id ? user.company._id.toString() : user.company.toString();
      const reqCompanyId = req.user.company._id ? req.user.company._id.toString() : req.user.company.toString();
      
      if (userCompanyId !== reqCompanyId) {
        return errorResponse(res, 403, "Access denied. User belongs to a different company.");
      }
    }

    
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


exports.updateUser = async (req, res) => {
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

    
    if (user.company && requestingUser.company) {
      const userCompanyId = user.company._id ? user.company._id.toString() : user.company.toString();
      const reqCompanyId = requestingUser.company._id ? requestingUser.company._id.toString() : requestingUser.company.toString();
      
      if (userCompanyId !== reqCompanyId) {
        return errorResponse(res, 403, "Access denied. User belongs to a different company.");
      }
    }

    
    
    const isSelfUpdate = requestingUser.id.toString() === id;
    
    
    

    
    const updateData = {};
    
    
    Object.keys(req.body).forEach(key => {
      
      if (key !== 'password' && key !== 'resetToken' && key !== 'resetTokenExpiry' && key !== '__v') {
        updateData[key] = req.body[key];
      }
    });
    
    
    if (req.body.children !== undefined) {
      updateData.children = req.body.children;
    }
    
    if (req.body.documents !== undefined) {
      updateData.documents = req.body.documents;
    }
    
    if (req.body.properties !== undefined) {
      updateData.properties = req.body.properties;
    }
    
    
    
    

    
    if (updateData.department) {
      const departmentError = await validateAssignableDepartment(updateData.department, user.company || requestingUser.company);
      if (departmentError) {
        return errorResponse(res, departmentError.status, departmentError.message);
      }
    }

    
    if (req.body.password) {
      updateData.password = req.body.password;
    }

    
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

    
    const requestingUserId = requestingUser._id || requestingUser.id;
    const targetUserId = user._id || id;
    
    if (requestingUserId.toString() !== targetUserId.toString()) {
      return errorResponse(res, 403, "You can only update your own profile");
    }

    const updateData = {};
    
    
    Object.keys(req.body).forEach(key => {
      if (key !== 'password' && key !== 'resetToken' && key !== 'resetTokenExpiry' && key !== '__v') {
        updateData[key] = req.body[key];
      }
    });
    
    
    if (req.body.children !== undefined) {
      updateData.children = req.body.children;
    }
    
    if (req.body.documents !== undefined) {
      updateData.documents = req.body.documents;
    }
    
    if (req.body.properties !== undefined) {
      updateData.properties = req.body.properties;
    }
    
    
    

    if (updateData.department) {
      const departmentError = await validateAssignableDepartment(updateData.department, user.company || requestingUser.company);
      if (departmentError) {
        return errorResponse(res, departmentError.status, departmentError.message);
      }
    }

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


exports.deleteUser = async (req, res) => {
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

    
    if (user.company && requestingUser.company) {
      const userCompanyId = user.company._id ? user.company._id.toString() : user.company.toString();
      const reqCompanyId = requestingUser.company._id ? requestingUser.company._id.toString() : requestingUser.company.toString();
      
      if (userCompanyId !== reqCompanyId) {
        return errorResponse(res, 403, "Access denied. User belongs to a different company.");
      }
    }
    
    
    
    const authorizedRoles = ['super_admin', 'admin', 'hr', 'manager'];
    const canDelete = authorizedRoles.includes(requestingUser.jobRole) || 
                      authorizedRoles.includes(requestingUser.companyRole);
    
    if (!canDelete) {
      return errorResponse(res, 403, "You don't have permission to delete users. Only HR, Manager, Admin, or Super Admin can delete users.");
    }
    
    
    const requestingUserId = requestingUser._id || requestingUser.id;
    const targetUserId = user._id || id;
    
    if (requestingUserId.toString() === targetUserId.toString()) {
      return errorResponse(res, 400, "You cannot delete your own account");
    }

    
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


exports.restoreUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      return errorResponse(res, 404, "User not found");
    }

    
    if (user.company && req.user.company) {
      const userCompanyId = user.company._id ? user.company._id.toString() : user.company.toString();
      const reqCompanyId = req.user.company._id ? req.user.company._id.toString() : req.user.company.toString();
      
      if (userCompanyId !== reqCompanyId) {
        return errorResponse(res, 403, "Access denied. User belongs to a different company.");
      }
    }

    
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


exports.getDeletedUsers = async (req, res) => {
  try {
    const userCompany = req.user.company;
    
    if (!userCompany) {
      return errorResponse(res, 400, "Company information is required");
    }

    const users = await User.find({ 
      isActive: false,
      company: userCompany  
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


exports.getCompanydepartmentUsers = async (req, res) => {
  try {
    void 0;
    
    if (req.params.id && req.params.id === 'department-users') {
      return errorResponse(res, 400, "Invalid endpoint. Use GET /users/department-users");
    }
    
    const currentUser = req.user;
    
    if (!currentUser) {
      return errorResponse(res, 401, "Authentication required");
    }
    
    const companyScope = getCompanyScope(req);
    if (companyScope.error) {
      return errorResponse(res, companyScope.error.status, companyScope.error.message);
    }
    const { companyId, companyCode } = companyScope;
    
    void 0;
    
    const requestedDepartment = req.query.department || req.query.departmentId;

    const filter = { 
      ...companyScope.filter,
      companyRole: { $not: /^client$/i }
    };

    if (!shouldIncludeInactiveUsers(req.query)) {
      filter.isActive = { $ne: false };
    }

    if (requestedDepartment) {
      filter.department = requestedDepartment;
    }
    
    
    const authorizedRoles = ['admin', 'hr', 'manager', 'super_admin', 'employee'];
    if (!requestedDepartment && !authorizedRoles.includes(currentUser.jobRole) && currentUser.department) {
      filter.department = currentUser.department;
    }
    
    const users = await User.find(filter)
      .select('-password -resetToken -resetTokenExpiry')
      .populate('department', 'name description')
      .populate('company', 'name companyCode companyEmail companyPhone companyAddress logo')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });
    const socketOnlineIds = getSocketOnlineUserIds(companyId);
    
    void 0;
    
    return successResponse(res, 200, {
      company: {
        id: companyId,
        code: companyCode,
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
        ...getUserPresence(user, socketOnlineIds),
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }))
    });
    
  } catch (err) {
    console.error("❌ Get company users error:", err.message);
    return errorResponse(res, 500, "Failed to fetch company users");
  }
};


exports.getCompanyUsers = async (req, res) => {
  try {
    const currentUser = req.user;

    if (!currentUser) {
      return errorResponse(res, 401, "Authentication required");
    }

    const companyScope = getCompanyScope(req);
    if (companyScope.error) {
      return errorResponse(res, companyScope.error.status, companyScope.error.message);
    }
    const { companyId, companyCode } = companyScope;

    const filter = {
      ...companyScope.filter,
      companyRole: { $not: /^client$/i }
    };

    if (!shouldIncludeInactiveUsers(req.query)) {
      filter.isActive = { $ne: false };
    }

    const users = await User.find(filter)
      .select("-password -resetToken -resetTokenExpiry")
      .populate("department", "name description")
      .populate("company", "name companyCode")
      .lean();
    const socketOnlineIds = getSocketOnlineUserIds(companyId);

    
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
          ...getUserPresence(user, socketOnlineIds),
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


exports.getCompanyUsersPaginated = async (req, res) => {
  try {
    void 0;
    
    const currentUser = req.user;
    
    if (!currentUser) {
      return errorResponse(res, 401, "Authentication required");
    }
    
    const companyId = currentUser.company;
    
    if (!companyId) {
      return errorResponse(res, 400, "User does not belong to any company");
    }
    
    void 0;
    
    const filter = { 
      company: companyId,
      companyRole: { 
        $exists: true,
        $not: /^client$/i 
      }
    };
    
    
    const authorizedRoles = ['admin', 'hr', 'manager', 'super_admin', 'employee'];
    if (!authorizedRoles.includes(currentUser.jobRole) && currentUser.department) {
      filter.department = currentUser.department;
      void 0;
    }
    
    void 0;
    
    const users = await User.find(filter)
      .select('-password -resetToken -resetTokenExpiry')
      .populate('department', 'name description')
      .populate('company', 'name companyCode companyEmail companyPhone companyAddress logo')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });
    
    void 0;
    
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

    
    const authorizedRoles = ['admin', 'super_admin', 'hr', 'manager', 'employee'];
    const isAuthorized = authorizedRoles.includes(req.user.jobRole);
    
    if (!isAuthorized && userDepartment) {
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

void 0;
