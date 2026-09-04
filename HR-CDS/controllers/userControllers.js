
const User = require('../../models/User');
const Department = require('../../models/Department');
const JobRole = require('../../models/JobRole');
const Branch = require('../../models/Branch');
const PagePermission = require('../../models/PagePermission');
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

const resolveAssignableShift = async ({ jobRole, shiftId, company, department }) => {
  if (!jobRole || !shiftId) return null;

  const roleQuery = {
    company,
    isActive: true
  };

  if (department) {
    roleQuery.department = department;
  }

  if (String(jobRole).match(/^[0-9a-fA-F]{24}$/)) {
    roleQuery._id = jobRole;
  } else {
    roleQuery.name = { $regex: new RegExp(`^${String(jobRole)}$`, 'i') };
  }

  const role = await JobRole.findOne(roleQuery);
  if (!role) {
    return { error: { status: 404, message: "Job role not found for selected department" } };
  }

  const shifts = Array.isArray(role.shifts) && role.shifts.length > 0
    ? role.shifts
    : (role.shiftSettings ? [role.shiftSettings] : []);
  const selectedShift = shifts.find(shift =>
    String(shift.shiftId || shift._id || shift.id) === String(shiftId)
  );

  if (!selectedShift) {
    return { error: { status: 404, message: "Shift not found for selected job role" } };
  }

  return {
    role,
    shift: selectedShift
  };
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
      // The company reference is the authoritative tenant boundary. Requiring
      // the duplicated companyCode field here hides valid legacy/self-register
      // records when that denormalized value is missing or was later changed.
      company: companyId
    }
  };
};

const normalizeIdList = (value) => {
  const input = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : value
        ? [value]
        : [];

  return [...new Set(input
    .map(item => {
      if (!item) return '';
      if (typeof item === 'object') return String(item._id || item.id || item.value || '');
      return String(item);
    })
    .map(item => item.trim())
    .filter(Boolean)
  )];
};

const isObjectIdLike = value => /^[a-f\d]{24}$/i.test(String(value || '').trim());

const getUserBranchIds = (user = {}) => normalizeIdList([
  user.branch,
  user.branchId,
  user.branchDetails,
  ...(Array.isArray(user.assignedBranches) ? user.assignedBranches : []),
  ...(Array.isArray(user.branchIds) ? user.branchIds : [])
]);

const canViewAllCompanyBranches = (user = {}) => {
  const roleText = String(user.companyRole || user.jobRole || user.role || '').trim().toLowerCase();
  return ['owner', 'company_owner', 'companyowner', 'super_admin', 'superadmin'].includes(roleText);
};

const appendAndCondition = (filter, condition) => {
  if (!condition || Object.keys(condition).length === 0) return filter;
  filter.$and = Array.isArray(filter.$and) ? [...filter.$and, condition] : [condition];
  return filter;
};

const applyBranchAccessFilter = (filter, req) => {
  const bypassBranchRestriction = ['true', '1', 'all', 'yes'].includes(
    String(req.query?.ignoreBranchRestriction || req.query?.allBranches || '').toLowerCase()
  );
  if (bypassBranchRestriction && canViewAllCompanyBranches(req.user || {})) {
    return filter;
  }

  const requestedBranch = req.query?.branch || req.query?.branchId;
  const currentUser = req.user || {};
  const accessibleBranchIds = getUserBranchIds(currentUser);

  if (requestedBranch) {
    const requestedBranchId = String(requestedBranch);
    if (!canViewAllCompanyBranches(currentUser) && !accessibleBranchIds.includes(requestedBranchId)) {
      filter._id = null;
      return filter;
    }

    appendAndCondition(filter, { $or: [
      { branch: requestedBranchId },
      { assignedBranches: requestedBranchId }
    ] });
    return filter;
  }

  if (!canViewAllCompanyBranches(currentUser) && accessibleBranchIds.length > 0) {
    appendAndCondition(filter, { $or: [
      { branch: { $in: accessibleBranchIds } },
      { assignedBranches: { $in: accessibleBranchIds } }
    ] });
  }

  return filter;
};

const userMatchesBranchScope = (targetUser, currentUser = {}) => {
  if (canViewAllCompanyBranches(currentUser)) return true;
  const accessibleBranchIds = getUserBranchIds(currentUser);
  if (!accessibleBranchIds.length) return true;
  const targetBranchIds = getUserBranchIds(targetUser);
  return targetBranchIds.some(branchId => accessibleBranchIds.includes(branchId));
};

const validateAssignedBranches = async (branchIds, companyId) => {
  if (branchIds.length === 0) return null;

  const count = await Branch.countDocuments({
    _id: { $in: branchIds },
    company: companyId,
    isActive: { $ne: false }
  });

  if (count !== branchIds.length) {
    return { status: 403, message: "One or more assigned branches are invalid for this company" };
  }

  return null;
};


const USER_FIELDS = {
  
  BASIC: ['name', 'email', 'password', 'department', 'jobRole'],
  
  
  PERSONAL: ['phone', 'address', 'gender', 'maritalStatus', 'dob', 
             'fatherName', 'motherName', 'city', 'state', 'pinCode', 'country'],
  
  
  EMPLOYMENT: ['employeeType', 'salary', 'properties', 'propertyOwned', 
               'additionalDetails', 'employeeId', 'companyRole', 'reportingManager',
               'dateOfJoining'],
  
  
  BANKING: ['accountNumber', 'ifsc', 'bankName', 'bankHolderName'],
  
  
  EMERGENCY: ['emergencyName', 'emergencyPhone', 'emergencyRelation', 
              'emergencyAddress'],
  
  
  DOCUMENTS: ['documents'],
  
  
  ALL: function() {
    return [
      ...this.BASIC,
      ...this.PERSONAL,
      ...this.EMPLOYMENT,
      ...this.BANKING,
      ...this.EMERGENCY,
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

const normalizeEmployeeType = (value) => String(value || '').trim().toLowerCase();

const isWorkFromHomeEmployeeType = (value) => {
  const normalized = normalizeEmployeeType(value);
  return ['work-from-home', 'work from home', 'wfh'].includes(normalized);
};

const normalizeEmploymentLocationFields = (updateData, existingUser = {}) => {
  return null;
};

const parseFlexibleDate = (value) => {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === '') return { ok: true, value: null };
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? { ok: false } : { ok: true, value };
  }

  const raw = String(value).trim();
  if (!raw) return { ok: true, value: null };

  let year;
  let month;
  let day;

  const isoMatch = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  const indianMatch = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);

  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else if (indianMatch) {
    day = Number(indianMatch[1]);
    month = Number(indianMatch[2]);
    year = Number(indianMatch[3]);
  } else {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return { ok: false };
    return { ok: true, value: parsed };
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  const isSameDate = parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;

  return isSameDate ? { ok: true, value: parsed } : { ok: false };
};

const normalizeUserDateFields = (data = {}) => {
  for (const field of ['dob', 'dateOfJoining']) {
    if (data[field] !== undefined) {
      const parsed = parseFlexibleDate(data[field]);
      if (!parsed.ok) {
        return `${field === 'dob' ? 'Date of Birth' : 'Date of Joining'} must be a valid date`;
      }
      data[field] = parsed.value;
    }
  }

  return null;
};

const hasChangedValue = (nextValue, currentValue) => {
  if (nextValue === undefined) return false;
  return String(nextValue ?? '').trim() !== String(currentValue ?? '').trim();
};

const REGISTER_REQUEST_PATH = '/ciisUser/register-request';

const REGISTER_REQUEST_SECTIONS = [
  'applicationReview',
  'personalInformation',
  'companyAssignment',
  'additionalDetails',
  'workDetails',
  'addressInformation',
  'identityDocuments',
  'salaryBankDetails',
  'familyDetails',
  'emergencyContact',
  'assetsExtraDetails'
];

const REGISTER_REQUEST_EDITABLE_FIELDS = new Set([
  'name', 'email', 'phone', 'dob', 'gender', 'maritalStatus',
  'branch', 'assignedBranches', 'department', 'jobRole', 'shiftId', 'shiftName', 'shiftType', 'companyRole',
  'employeeType', 'dateOfJoining', 'experienceType', 'additionalDocumentDetails',
  'address', 'city', 'state', 'country', 'pinCode',
  'aadharCard', 'panCard',
  'salary', 'accountNumber', 'ifsc', 'bankName', 'bankHolderName',
  'fatherName', 'motherName',
  'emergencyName', 'emergencyPhone', 'emergencyRelation', 'emergencyAddress',
  'properties', 'propertyOwned', 'additionalDetails'
]);

const getRequestUserId = (user = {}) => String(user._id || user.id || '');

const getRequestUserName = (user = {}) => String(user.name || user.email || 'Unknown User');

const isRegisterRequestAdmin = (user = {}) => {
  const role = String(user.companyRole || user.jobRole || user.role || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ['owner', 'admin', 'hr', 'super_admin', 'superadmin', 'company_owner', 'companyowner'].includes(role);
};

const getRegisterRequestPagePermission = async req => {
  const company = req.user?.company;
  const companyId = company?._id || company?.id || company;
  if (!companyId) return null;
  return PagePermission.findOne({ company: companyId, path: REGISTER_REQUEST_PATH }).lean();
};

const pageUserIds = (page, key) => (page?.[key] || [])
  .map(item => String(item?.user?._id || item?.user || ''))
  .filter(Boolean);

const hasRegisterRequestViewAccess = async req => {
  if (isRegisterRequestAdmin(req.user)) return true;
  const page = await getRegisterRequestPagePermission(req);
  if (!page) return false;
  const currentUserId = getRequestUserId(req.user);
  const ids = new Set([
    ...pageUserIds(page, 'viewUsers'),
    ...pageUserIds(page, 'editUsers'),
    ...pageUserIds(page, 'approvers'),
    ...pageUserIds(page, 'deleteUsers')
  ]);
  return ids.has(currentUserId);
};

const hasRegisterRequestVerifyAccess = async req => {
  if (isRegisterRequestAdmin(req.user)) return true;
  const page = await getRegisterRequestPagePermission(req);
  if (!page) return false;
  const currentUserId = getRequestUserId(req.user);
  return pageUserIds(page, 'approvers').includes(currentUserId);
};

const buildDocumentUrl = (userId, doc, action = 'view') => (
  `/users/${userId}/documents/${doc._id}/${action}`
);

const serializeRegisterRequest = user => {
  const item = typeof user.toObject === 'function' ? user.toObject() : user;
  const registrationStatus = item.registrationStatus || (item.isActive ? 'active' : 'pending');
  const documents = (item.documents || []).map(doc => ({
    ...doc,
    viewUrl: buildDocumentUrl(item._id, doc, 'view'),
    downloadUrl: buildDocumentUrl(item._id, doc, 'download')
  }));

  return {
    ...item,
    registrationSource: item.registrationSource || 'self_register',
    registrationStatus,
    documents,
    verificationSections: REGISTER_REQUEST_SECTIONS.map(key => ({
      key,
      ...(item.registrationVerification?.sections?.[key] || {})
    })),
    canActivate: REGISTER_REQUEST_SECTIONS.every(key => (
      Boolean(item.registrationVerification?.sections?.[key]?.verified)
    ))
  };
};

const findScopedRegisterRequest = async (req, id) => {
  const companyScope = getCompanyScope(req);
  if (companyScope.error) return { error: companyScope.error };
  const companyFilter = companyScope.filter;
  const user = await User.findOne({
    _id: id,
    ...companyFilter,
    $or: [
      { registrationSource: 'self_register' },
      {
        registrationSource: { $exists: false },
        registrationStatus: { $exists: false },
        isActive: false
      },
      {
        registrationSource: { $exists: false },
        registrationStatus: 'active',
        isActive: true,
        'registrationVerification.activatedAt': { $ne: null }
      }
    ]
  });
  if (!user) return { error: { status: 404, message: 'Register request not found' } };
  const rawStatus = await User.collection.findOne(
    { _id: user._id },
    { projection: { registrationSource: 1, registrationStatus: 1, isActive: 1 } }
  );
  const isLegacyPending = Boolean(
    rawStatus &&
    !Object.prototype.hasOwnProperty.call(rawStatus, 'registrationSource') &&
    !Object.prototype.hasOwnProperty.call(rawStatus, 'registrationStatus') &&
    rawStatus.isActive === false
  );
  return { user, isLegacyPending };
};

const getScopedRegisterRequestStatus = (user, isLegacyPending = false) => (
  isLegacyPending ? 'pending' : (user.registrationStatus || (user.isActive ? 'active' : 'pending'))
);

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
      profileImage: user.profileImage,
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
        aadharCard: user.aadharCard,
        panCard: user.panCard,
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
        city: user.city,
        state: user.state,
        pinCode: user.pinCode,
        country: user.country,
        chatSettings: user.chatSettings,
        notificationPreferences: user.notificationPreferences,
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
    const existingUser = await User.findById(userId).lean();
    if (!existingUser) return errorResponse(res, 404, "User not found");

    const currentAadhaar = existingUser.aadharCard || '';
    const currentPan = existingUser.panCard || '';
    const requiredProfileFields = [
      ['name', 'Full Name', existingUser.name],
      ['phone', 'Mobile Number', existingUser.phone],
      ['bankHolderName', 'Account Holder Name', existingUser.bankHolderName],
      ['accountNumber', 'Account Number', existingUser.accountNumber],
      ['ifsc', 'IFSC Code', existingUser.ifsc],
      ['bankName', 'Bank Name', existingUser.bankName],
      ['fatherName', "Father's Name", existingUser.fatherName],
      ['motherName', "Mother's Name", existingUser.motherName],
      ['aadharCard', 'Aadhar Card Number', currentAadhaar],
      ['panCard', 'PAN Number', currentPan],
    ];
    const missingFields = requiredProfileFields
      .filter(([field]) => req.body[field] !== undefined && !String(req.body[field] || '').trim())
      .map(([, label]) => label);

    if (missingFields.length) {
      return errorResponse(res, 400, `Please complete all required profile fields: ${missingFields.join(', ')}`);
    }

    if (req.body.accountNumber !== undefined) {
      const nextAccountNumber = String(req.body.accountNumber).trim();
      const accountChanged = nextAccountNumber !== String(existingUser.accountNumber || '').trim();
      if (accountChanged && String(req.body.confirmAccountNumber || '').trim() !== nextAccountNumber) {
        return errorResponse(res, 400, "Account Number and Confirm Account Number do not match");
      }
    }

    if (req.body.accountNumber !== undefined && !/^\d{9,18}$/.test(String(req.body.accountNumber).trim())) {
      return errorResponse(res, 400, "Account Number must contain 9 to 18 digits");
    }
    if (req.body.ifsc !== undefined && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(String(req.body.ifsc).trim().toUpperCase())) {
      return errorResponse(res, 400, "Invalid IFSC Code format");
    }
    if (req.body.aadharCard !== undefined && !/^\d{12}$/.test(String(req.body.aadharCard).trim())) {
      return errorResponse(res, 400, "Aadhar Card Number must contain exactly 12 digits");
    }
    if (req.body.panCard !== undefined && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(String(req.body.panCard).trim().toUpperCase())) {
      return errorResponse(res, 400, "Invalid PAN Number format");
    }
    if (
      req.body.pinCode !== undefined &&
      String(req.body.pinCode).trim() &&
      !/^\d{6}$/.test(String(req.body.pinCode).trim())
    ) {
      return errorResponse(res, 400, "PIN Code must contain exactly 6 digits");
    }
    
    
    const selfEditableFields = new Set([
      'name', 'phone', 'dob', 'gender', 'maritalStatus',
      'address', 'city', 'state', 'pinCode', 'country',
      'bankHolderName', 'accountNumber', 'ifsc', 'bankName',
      'fatherName', 'motherName',
      'emergencyName', 'emergencyPhone', 'emergencyRelation', 'emergencyAddress',
      'aadharCard', 'panCard',
      'chatSettings', 'notificationPreferences', 'properties',
      'propertyOwned', 'additionalDetails',
      'employeeType',
      'profileImage'
    ]);

    Object.keys(req.body).forEach(key => {
      if (selfEditableFields.has(key)) updateData[key] = req.body[key];
    });

    if (req.body.profileImage !== undefined) {
      updateData.profileImage = req.body.profileImage ? String(req.body.profileImage).trim() : "";
    }

    ['bankHolderName', 'accountNumber', 'bankName'].forEach((field) => {
      if (updateData[field] !== undefined) updateData[field] = String(updateData[field]).trim();
    });
    if (updateData.ifsc) updateData.ifsc = String(updateData.ifsc).trim().toUpperCase();
    if (updateData.panCard) updateData.panCard = String(updateData.panCard).trim().toUpperCase();
    if (updateData.pinCode) {
      updateData.pinCode = String(updateData.pinCode).trim();
    }
    
    
    if (req.body.properties !== undefined) {
      updateData.properties = req.body.properties;
    }

    const dateFieldError = normalizeUserDateFields(updateData);
    if (dateFieldError) {
      return errorResponse(res, 400, dateFieldError);
    }

    const employmentLocationError = normalizeEmploymentLocationFields(updateData, existingUser);
    if (employmentLocationError) {
      return errorResponse(res, 400, employmentLocationError);
    }

    if (updateData.department && /^[a-f\d]{24}$/i.test(String(updateData.department))) {
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
    
    
    const extraFields = ['city', 'state', 'pinCode', 'country', 'documents', 'employeeId', 'companyRole', 'reportingManager', 'dateOfJoining'];
    extraFields.forEach(field => {
      if (req.body[field] !== undefined) {
        userData[field] = req.body[field];
      }
    });

    const dateFieldError = normalizeUserDateFields(userData);
    if (dateFieldError) {
      return errorResponse(res, 400, dateFieldError);
    }

    
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

exports.getRegisterRequests = async (req, res) => {
  try {
    const canView = await hasRegisterRequestViewAccess(req);
    if (!canView) {
      return errorResponse(res, 403, "You do not have access to Register Request page");
    }

    const companyScope = getCompanyScope(req);
    if (companyScope.error) {
      return errorResponse(res, companyScope.error.status, companyScope.error.message);
    }
    const companyFilter = companyScope.filter;

    const status = String(req.query.status || 'pending').trim().toLowerCase();
    const legacyPendingFilter = {
      registrationSource: { $exists: false },
      registrationStatus: { $exists: false },
      isActive: false
    };
    const legacyActivatedFilter = {
      registrationSource: { $exists: false },
      registrationStatus: 'active',
      isActive: true,
      'registrationVerification.activatedAt': { $ne: null }
    };
    const filter = { ...companyFilter };

    if (status === 'all') {
      filter.$or = [
        {
          registrationSource: 'self_register',
          registrationStatus: { $in: ['pending', 'active', 'rejected'] }
        },
        legacyPendingFilter,
        legacyActivatedFilter
      ];
    } else if (status === 'pending') {
      filter.$or = [
        { registrationSource: 'self_register', registrationStatus: 'pending' },
        legacyPendingFilter
      ];
    } else if (status === 'active') {
      filter.$or = [
        { registrationSource: 'self_register', registrationStatus: 'active' },
        legacyActivatedFilter
      ];
    } else if (status === 'rejected') {
      filter.registrationSource = 'self_register';
      filter.registrationStatus = 'rejected';
    } else {
      filter.$or = [
        { registrationSource: 'self_register', registrationStatus: 'pending' },
        legacyPendingFilter
      ];
    }

    const requests = await User.find(filter)
      .select('-password -resetToken -resetTokenExpiry')
      .populate('company', 'companyName companyCode name')
      .populate('branch', 'name branchCode')
      .populate('assignedBranches', 'name branchCode')
      .populate('department', 'name description branch')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .lean();

    const jobRoleIds = [...new Set(requests
      .map(request => String(request.jobRole || '').trim())
      .filter(isObjectIdLike))];
    const jobRoleRecords = jobRoleIds.length
      ? await JobRole.find({ _id: { $in: jobRoleIds } }).select('name').lean()
      : [];
    const jobRoleNames = new Map(jobRoleRecords.map(role => [String(role._id), role.name]));
    const departmentIds = [...new Set(requests
      .map(request => String(request.department?._id || request.department || '').trim())
      .filter(isObjectIdLike))];
    const departmentRecords = departmentIds.length
      ? await Department.find({ _id: { $in: departmentIds } }).select('name').lean()
      : [];
    const departmentNames = new Map(departmentRecords.map(department => [String(department._id), department.name]));
    const enrichedRequests = requests.map(request => ({
      ...request,
      jobRoleName: jobRoleNames.get(String(request.jobRole || '')) || String(request.jobRole || '').trim() || 'Unassigned Role',
      departmentName: request.department?.name || departmentNames.get(String(request.department?._id || request.department || '')) || String(request.department || '').trim() || 'Not provided'
    }));

    const canVerify = await hasRegisterRequestVerifyAccess(req);

    return res.status(200).json({
      success: true,
      requests: enrichedRequests.map(serializeRegisterRequest),
      sections: REGISTER_REQUEST_SECTIONS,
      canVerify
    });
  } catch (err) {
    console.error("❌ Get register requests error:", err);
    return errorResponse(res, 500, "Failed to load register requests");
  }
};

exports.updateRegisterRequest = async (req, res) => {
  try {
    const canVerify = await hasRegisterRequestVerifyAccess(req);
    if (!canVerify) {
      return errorResponse(res, 403, "You do not have permission to update register requests");
    }

    const { user, error, isLegacyPending } = await findScopedRegisterRequest(req, req.params.id);
    if (error) return errorResponse(res, error.status, error.message);
    if (getScopedRegisterRequestStatus(user, isLegacyPending) !== 'pending') {
      return errorResponse(res, 400, "Only pending register requests can be updated");
    }

    const updateData = {};
    Object.keys(req.body || {}).forEach(key => {
      if (REGISTER_REQUEST_EDITABLE_FIELDS.has(key)) {
        updateData[key] = req.body[key];
      }
    });

    ['email', 'phone', 'aadharCard', 'panCard', 'ifsc'].forEach(field => {
      if (updateData[field] !== undefined) {
        updateData[field] = String(updateData[field] || '').trim();
      }
    });
    if (updateData.email) updateData.email = updateData.email.toLowerCase();
    if (updateData.panCard) updateData.panCard = updateData.panCard.toUpperCase();
    if (updateData.ifsc) updateData.ifsc = updateData.ifsc.toUpperCase();

    ['gender', 'maritalStatus', 'experienceType', 'companyRole'].forEach(field => {
      if (updateData[field] === undefined) return;
      const normalized = String(updateData[field] || '').trim().toLowerCase().replace(/\s+/g, '_');
      if (normalized) updateData[field] = normalized;
      else delete updateData[field];
    });

    if (updateData.salary === '' || updateData.salary === null) {
      updateData.salary = undefined;
    }

    if (Array.isArray(updateData.properties)) {
      const allowedProperties = new Set(['sim', 'phone', 'laptop', 'desktop', 'headphones', 'tablet', 'vehicle']);
      updateData.properties = updateData.properties
        .map(value => String(value || '').trim().toLowerCase())
        .filter(value => allowedProperties.has(value));
    }

    const dateFieldError = normalizeUserDateFields(updateData);
    if (dateFieldError) {
      return errorResponse(res, 400, dateFieldError);
    }

    if (updateData.department && isObjectIdLike(updateData.department)) {
      const departmentError = await validateAssignableDepartment(updateData.department, user.company || req.user.company);
      if (departmentError) {
        return errorResponse(res, departmentError.status, departmentError.message);
      }
    }

    if (updateData.branch && isObjectIdLike(updateData.branch)) {
      const branch = await Branch.findOne({
        _id: updateData.branch,
        company: user.company || req.user.company,
        isActive: { $ne: false }
      });
      if (!branch) {
        return errorResponse(res, 404, "Branch not found for selected company");
      }
      updateData.branchCode = branch.branchCode;
    }

    if (req.body.assignedBranches !== undefined || updateData.branch !== undefined) {
      const assignedBranchIds = normalizeIdList([
        ...(Array.isArray(req.body.assignedBranches) ? req.body.assignedBranches : normalizeIdList(req.body.assignedBranches)),
        updateData.branch || user.branch
      ]).filter(isObjectIdLike);
      const branchError = await validateAssignedBranches(assignedBranchIds, user.company || req.user.company);
      if (branchError) {
        return errorResponse(res, branchError.status, branchError.message);
      }
      updateData.assignedBranches = assignedBranchIds;
    }

    if ((updateData.department || updateData.jobRole || updateData.shiftId) && (updateData.shiftId || user.shiftId)) {
      const shiftResult = await resolveAssignableShift({
        jobRole: updateData.jobRole || user.jobRole,
        shiftId: updateData.shiftId || user.shiftId,
        company: user.company || req.user.company,
        department: updateData.department || user.department
      });
      if (shiftResult?.error) {
        return errorResponse(res, shiftResult.error.status, shiftResult.error.message);
      }
      updateData.shiftId = String(shiftResult.shift.shiftId || updateData.shiftId || user.shiftId);
      updateData.shiftName = shiftResult.shift.shiftName || updateData.shiftName;
      updateData.shiftType = shiftResult.shift.shiftType || updateData.shiftType;
    }

    updateData['registrationVerification.lastUpdatedBy'] = req.user.id || req.user._id;
    updateData['registrationVerification.lastUpdatedByName'] = getRequestUserName(req.user);
    updateData['registrationVerification.lastUpdatedAt'] = new Date();

    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      { $set: updateData },
      { new: true, runValidators: true, context: 'query' }
    )
      .select('-password -resetToken -resetTokenExpiry')
      .populate('company', 'companyName companyCode name')
      .populate('branch', 'name branchCode')
      .populate('assignedBranches', 'name branchCode')
      .populate('department', 'name description branch')
      .populate('createdBy', 'name email')
      .lean();

    return res.status(200).json({
      success: true,
      message: "Register request updated successfully",
      request: serializeRegisterRequest(updatedUser)
    });
  } catch (err) {
    console.error("❌ Update register request error:", err);
    if (err.name === 'ValidationError') {
      return errorResponse(res, 400, err.message);
    }
    return errorResponse(res, 500, "Failed to update register request");
  }
};

exports.verifyRegisterRequestSection = async (req, res) => {
  try {
    const canVerify = await hasRegisterRequestVerifyAccess(req);
    if (!canVerify) {
      return errorResponse(res, 403, "You do not have permission to verify register requests");
    }

    const { sectionKey, verified } = req.body || {};
    if (!REGISTER_REQUEST_SECTIONS.includes(sectionKey)) {
      return errorResponse(res, 400, "Invalid verification section");
    }

    const { user, error, isLegacyPending } = await findScopedRegisterRequest(req, req.params.id);
    if (error) return errorResponse(res, error.status, error.message);
    if (getScopedRegisterRequestStatus(user, isLegacyPending) !== 'pending') {
      return errorResponse(res, 400, "Only pending register requests can be verified");
    }

    const now = new Date();
    const verifierName = getRequestUserName(req.user);
    const prefix = `registrationVerification.sections.${sectionKey}`;
    const setData = {
      [`${prefix}.verified`]: Boolean(verified),
      [`${prefix}.verifiedBy`]: verified ? (req.user.id || req.user._id) : null,
      [`${prefix}.verifierName`]: verified ? verifierName : '',
      [`${prefix}.verifiedAt`]: verified ? now : null
    };

    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      { $set: setData },
      { new: true, runValidators: true, context: 'query' }
    )
      .select('-password -resetToken -resetTokenExpiry')
      .populate('company', 'companyName companyCode name')
      .populate('branch', 'name branchCode')
      .populate('assignedBranches', 'name branchCode')
      .populate('department', 'name description branch')
      .populate('createdBy', 'name email')
      .lean();

    return res.status(200).json({
      success: true,
      message: verified ? "Section verified successfully" : "Section verification removed",
      request: serializeRegisterRequest(updatedUser)
    });
  } catch (err) {
    console.error("❌ Verify register request section error:", err);
    return errorResponse(res, 500, "Failed to verify register request section");
  }
};

exports.activateRegisterRequest = async (req, res) => {
  try {
    const canVerify = await hasRegisterRequestVerifyAccess(req);
    if (!canVerify) {
      return errorResponse(res, 403, "You do not have permission to activate register requests");
    }

    const { user, error, isLegacyPending } = await findScopedRegisterRequest(req, req.params.id);
    if (error) return errorResponse(res, error.status, error.message);
    if (getScopedRegisterRequestStatus(user, isLegacyPending) !== 'pending') {
      return errorResponse(res, 400, "Only pending register requests can be activated");
    }

    const allVerified = REGISTER_REQUEST_SECTIONS.every(key => (
      Boolean(user.registrationVerification?.sections?.[key]?.verified)
    ));
    const legacyApplicationReviewVerified = Boolean(user.registrationVerification?.sections?.applicationReview?.verified);
    if (!allVerified && !legacyApplicationReviewVerified) {
      return errorResponse(res, 400, "Please review the application before activating this user");
    }

    const now = new Date();
    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      {
        $set: {
          isActive: true,
          registrationStatus: 'active',
          'registrationVerification.activatedBy': req.user.id || req.user._id,
          'registrationVerification.activatedByName': getRequestUserName(req.user),
          'registrationVerification.activatedAt': now
        }
      },
      { new: true, runValidators: true, context: 'query' }
    )
      .select('-password -resetToken -resetTokenExpiry')
      .populate('company', 'companyName companyCode name')
      .populate('branch', 'name branchCode')
      .populate('assignedBranches', 'name branchCode')
      .populate('department', 'name description branch')
      .populate('createdBy', 'name email')
      .lean();

    return res.status(200).json({
      success: true,
      message: "User activated successfully",
      request: serializeRegisterRequest(updatedUser)
    });
  } catch (err) {
    console.error("❌ Activate register request error:", err);
    return errorResponse(res, 500, "Failed to activate register request");
  }
};

exports.rejectRegisterRequest = async (req, res) => {
  try {
    const canVerify = await hasRegisterRequestVerifyAccess(req);
    if (!canVerify) {
      return errorResponse(res, 403, "You do not have permission to reject register requests");
    }

    const { user, error } = await findScopedRegisterRequest(req, req.params.id);
    if (error) return errorResponse(res, error.status, error.message);
    if ((user.registrationStatus || (user.isActive ? 'active' : 'pending')) === 'active') {
      return errorResponse(res, 400, "An active registration cannot be rejected from this page");
    }

    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      {
        $set: {
          isActive: false,
          registrationStatus: 'rejected',
          'registrationVerification.rejectedBy': req.user.id || req.user._id,
          'registrationVerification.rejectedByName': getRequestUserName(req.user),
          'registrationVerification.rejectedAt': new Date()
        }
      },
      { new: true, runValidators: true, context: 'query' }
    )
      .select('-password -resetToken -resetTokenExpiry')
      .populate('company', 'companyName companyCode name')
      .populate('branch', 'name branchCode')
      .populate('assignedBranches', 'name branchCode')
      .populate('department', 'name description branch')
      .populate('createdBy', 'name email')
      .lean();

    return res.status(200).json({
      success: true,
      message: "Register request rejected successfully",
      request: serializeRegisterRequest(updatedUser)
    });
  } catch (err) {
    console.error("Reject register request error:", err);
    return errorResponse(res, 500, "Failed to reject register request");
  }
};

exports.setRegisterRequestStatus = async (req, res) => {
  try {
    const canVerify = await hasRegisterRequestVerifyAccess(req);
    if (!canVerify) {
      return errorResponse(res, 403, "You do not have permission to change user status");
    }

    const { user, error } = await findScopedRegisterRequest(req, req.params.id);
    if (error) return errorResponse(res, error.status, error.message);

    const isActive = req.body?.isActive === true;
    const now = new Date();
    const setData = {
      isActive,
      registrationSource: 'self_register',
      registrationStatus: isActive ? 'active' : 'pending'
    };

    if (isActive) {
      REGISTER_REQUEST_SECTIONS.forEach(sectionKey => {
        setData[`registrationVerification.sections.${sectionKey}.verified`] = true;
        setData[`registrationVerification.sections.${sectionKey}.verifiedBy`] = req.user.id || req.user._id;
        setData[`registrationVerification.sections.${sectionKey}.verifierName`] = getRequestUserName(req.user);
        setData[`registrationVerification.sections.${sectionKey}.verifiedAt`] = now;
      });
      setData['registrationVerification.activatedBy'] = req.user.id || req.user._id;
      setData['registrationVerification.activatedByName'] = getRequestUserName(req.user);
      setData['registrationVerification.activatedAt'] = now;
    }

    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      { $set: setData },
      { new: true, runValidators: true, context: 'query' }
    )
      .select('-password -resetToken -resetTokenExpiry')
      .populate('company', 'companyName companyCode name')
      .populate('branch', 'name branchCode')
      .populate('department', 'name description branch')
      .lean();

    return res.status(200).json({
      success: true,
      message: isActive ? "User activated successfully" : "User deactivated successfully",
      request: serializeRegisterRequest(updatedUser)
    });
  } catch (err) {
    console.error("Set register request status error:", err);
    return errorResponse(res, 500, "Failed to update user status");
  }
};


exports.getAllUsers = async (req, res) => {
  try {
    const { page, limit, skip } = getPaginationOptions(req.query, { limit: 50, maxLimit: 100 });
    
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

    applyBranchAccessFilter(filter, req);

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
      profileImage: user.profileImage,
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
      city: user.city,
      state: user.state,
      pinCode: user.pinCode,
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
      .populate('branch', 'name branchCode')
      .populate('assignedBranches', 'name branchCode')
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

    if (!userMatchesBranchScope(user, req.user)) {
      return errorResponse(res, 403, "Access denied. User belongs to a different branch.");
    }

    
    const formattedUser = {
      id: user._id,
      name: user.name,
      email: user.email,
      company: user.company,
      department: user.department,
      branch: user.branch,
      assignedBranches: user.assignedBranches || [],
      jobRole: user.jobRole,
      phone: user.phone,
      profileImage: user.profileImage,
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
      city: user.city,
      state: user.state,
      pinCode: user.pinCode,
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

    
    const bodyUserId = req.body.userId || req.body.id || req.body._id;

    let user = id && isObjectIdLike(id) ? await User.findById(id) : null;
    if (!user && bodyUserId && isObjectIdLike(bodyUserId)) {
      user = await User.findById(bodyUserId);
    }
    if (!user && req.body.email && requestingUser.company) {
      const requesterCompanyId = requestingUser.company._id || requestingUser.company;
      user = await User.findOne({
        email: String(req.body.email).trim().toLowerCase(),
        company: requesterCompanyId
      });
    }

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
    const adminEditableFields = new Set([
      ...USER_FIELDS.ALL(),
      'branch', 'assignedBranches',
      'shiftId', 'shiftName', 'shiftType',
      'aadharCard', 'panCard',
      'isActive'
    ]);
    // This legacy field may contain a structured object for older client-linked
    // users, while the current User schema expects a string. It is not editable
    // in Employee Details, so preserve the stored value instead of casting it
    // during an unrelated profile update.
    adminEditableFields.delete('additionalDetails');

    // Employee detail responses contain populated and legacy-only properties.
    // Sending those objects back into a validated update can make an otherwise
    // valid edit fail, especially for older users imported by another company.
    Object.keys(req.body).forEach(key => {
      if (adminEditableFields.has(key)) {
        updateData[key] = req.body[key];
      }
    });

    delete updateData.userId;
    delete updateData.targetUserId;

    ['gender', 'maritalStatus'].forEach(field => {
      if (updateData[field] === undefined) return;
      const normalizedValue = String(updateData[field] || '').trim().toLowerCase();
      if (normalizedValue) updateData[field] = normalizedValue;
      else delete updateData[field];
    });

    if (req.body.documents !== undefined) {
      updateData.documents = req.body.documents;
    }
    
    if (req.body.properties !== undefined) {
      updateData.properties = req.body.properties;
    }

    if (Array.isArray(updateData.properties)) {
      const allowedProperties = new Set(['sim', 'phone', 'laptop', 'desktop', 'headphones', 'tablet', 'vehicle']);
      updateData.properties = updateData.properties
        .map(value => String(value || '').trim().toLowerCase())
        .filter(value => allowedProperties.has(value));
    }

    const dateFieldError = normalizeUserDateFields(updateData);
    if (dateFieldError) {
      return errorResponse(res, 400, dateFieldError);
    }
    
    
    

    
    const departmentChanged = hasChangedValue(updateData.department, user.department);
    const jobRoleChanged = hasChangedValue(updateData.jobRole, user.jobRole);
    const branchChanged = hasChangedValue(updateData.branch, user.branch);
    const shiftChanged = hasChangedValue(updateData.shiftId, user.shiftId) ||
      hasChangedValue(updateData.shiftName, user.shiftName) ||
      hasChangedValue(updateData.shiftType, user.shiftType);

    if (departmentChanged && updateData.department && /^[a-f\d]{24}$/i.test(String(updateData.department))) {
      const departmentError = await validateAssignableDepartment(updateData.department, user.company || requestingUser.company);
      if (departmentError) {
        return errorResponse(res, departmentError.status, departmentError.message);
      }
    }

    if (branchChanged && updateData.branch && isObjectIdLike(updateData.branch)) {
      const branch = await Branch.findOne({
        _id: updateData.branch,
        company: user.company || requestingUser.company,
        isActive: { $ne: false }
      });

      if (!branch) {
        return errorResponse(res, 404, "Branch not found for selected company");
      }

      updateData.branchCode = branch.branchCode;
    }

    if (req.body.assignedBranches !== undefined || branchChanged) {
      const assignedBranchIds = normalizeIdList([
        ...(Array.isArray(req.body.assignedBranches) ? req.body.assignedBranches : normalizeIdList(req.body.assignedBranches)),
        updateData.branch || user.branch
      ]).filter(isObjectIdLike);
      const branchError = await validateAssignedBranches(assignedBranchIds, user.company || requestingUser.company);
      if (branchError) {
        return errorResponse(res, branchError.status, branchError.message);
      }
      updateData.assignedBranches = assignedBranchIds;
    }

    if ((departmentChanged || jobRoleChanged || shiftChanged) && updateData.shiftId) {
      const shiftResult = await resolveAssignableShift({
        jobRole: updateData.jobRole || user.jobRole,
        shiftId: updateData.shiftId,
        company: user.company || requestingUser.company,
        department: updateData.department || user.department
      });

      if (shiftResult?.error) {
        return errorResponse(res, shiftResult.error.status, shiftResult.error.message);
      }

      updateData.shiftId = String(shiftResult.shift.shiftId || updateData.shiftId);
      updateData.shiftName = shiftResult.shift.shiftName || updateData.shiftName;
      updateData.shiftType = shiftResult.shift.shiftType || updateData.shiftType;
    }

    
    if (req.body.password) {
      updateData.password = req.body.password;
    }

    const employmentLocationError = normalizeEmploymentLocationFields(updateData, user);
    if (employmentLocationError) {
      return errorResponse(res, 400, employmentLocationError);
    }

    
    const updatedUser = await User.findByIdAndUpdate(
      user._id,
      { $set: updateData },
      { 
        new: true, 
        runValidators: true,
        context: 'query'
      }
    )
    .select('-password -resetToken -resetTokenExpiry')
    .populate('department', 'name description')
    .populate('branch', 'name branchCode')
    .populate('assignedBranches', 'name branchCode')
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
    if (err.name === 'CastError') {
      return errorResponse(res, 400, `Invalid ${err.path || 'field'} value`);
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
    
    
    const blockedUpdateFields = new Set(['password', 'resetToken', 'resetTokenExpiry', '__v', 'spouseName', 'children', 'zipCode', 'workLocation', 'noticePeriod', 'aadhaar', 'aadhar', 'pan']);

    Object.keys(req.body).forEach(key => {
      if (!blockedUpdateFields.has(key)) {
        updateData[key] = req.body[key];
      }
    });
    
    if (req.body.documents !== undefined) {
      updateData.documents = req.body.documents;
    }
    
    if (req.body.properties !== undefined) {
      updateData.properties = req.body.properties;
    }

    const dateFieldError = normalizeUserDateFields(updateData);
    if (dateFieldError) {
      return errorResponse(res, 400, dateFieldError);
    }

    const employmentLocationError = normalizeEmploymentLocationFields(updateData, user);
    if (employmentLocationError) {
      return errorResponse(res, 400, employmentLocationError);
    }

    const departmentChanged = hasChangedValue(updateData.department, user.department);
    const jobRoleChanged = hasChangedValue(updateData.jobRole, user.jobRole);
    const shiftChanged = hasChangedValue(updateData.shiftId, user.shiftId) ||
      hasChangedValue(updateData.shiftName, user.shiftName) ||
      hasChangedValue(updateData.shiftType, user.shiftType);

    if (departmentChanged && updateData.department && /^[a-f\d]{24}$/i.test(String(updateData.department))) {
      const departmentError = await validateAssignableDepartment(updateData.department, user.company || requestingUser.company);
      if (departmentError) {
        return errorResponse(res, departmentError.status, departmentError.message);
      }
    }

    if ((departmentChanged || jobRoleChanged || shiftChanged) && updateData.shiftId) {
      const shiftResult = await resolveAssignableShift({
        jobRole: updateData.jobRole || user.jobRole,
        shiftId: updateData.shiftId,
        company: user.company || requestingUser.company,
        department: updateData.department || user.department
      });

      if (shiftResult?.error) {
        return errorResponse(res, shiftResult.error.status, shiftResult.error.message);
      }

      updateData.shiftId = String(shiftResult.shift.shiftId || updateData.shiftId);
      updateData.shiftName = shiftResult.shift.shiftName || updateData.shiftName;
      updateData.shiftType = shiftResult.shift.shiftType || updateData.shiftType;
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

    const filter = {
      isActive: false,
      company: userCompany  
    };
    applyBranchAccessFilter(filter, req);

    const { page, limit, skip } = getPaginationOptions(req.query, { limit: 50, maxLimit: 100 });
    const [users, total] = await Promise.all([
      User.find(filter)
        .select('-password -resetToken -resetTokenExpiry')
        .populate('department', 'name description')
        .populate('branch', 'name branchCode')
        .populate('assignedBranches', 'name branchCode')
        .populate('company', 'name companyCode')
        .sort({ deletedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter)
    ]);

    return successResponse(res, 200, {
      count: users.length,
      total,
      pagination: buildPaginationMeta({ page, limit, total }),
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
    applyBranchAccessFilter(filter, req);
    
    
    const authorizedRoles = ['admin', 'hr', 'manager', 'super_admin', 'employee'];
    if (!requestedDepartment && !authorizedRoles.includes(currentUser.jobRole) && currentUser.department) {
      filter.department = currentUser.department;
    }
    
    const { page, limit, skip } = getPaginationOptions(req.query, { limit: 50, maxLimit: 100 });
    const [users, total] = await Promise.all([
      User.find(filter)
      .select('-password -resetToken -resetTokenExpiry')
      .populate('department', 'name description')
      .populate('branch', 'name branchCode')
      .populate('assignedBranches', 'name branchCode')
      .populate('company', 'name companyName companyCode companyEmail companyPhone companyAddress logo')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
      User.countDocuments(filter)
    ]);
    const socketOnlineIds = getSocketOnlineUserIds(companyId);
    
    void 0;
    
    return successResponse(res, 200, {
      company: {
        id: companyId,
        code: companyCode,
        name: currentUser.companyName || 'Company'
      },
      count: users.length,
      total,
      pagination: buildPaginationMeta({ page, limit, total }),
      users: users.map(user => ({
        id: user._id,
        name: user.name,
        email: user.email,
        company: user.company,
        department: user.department,
        branch: user.branch,
        assignedBranches: user.assignedBranches || [],
      jobRole: user.jobRole,
      phone: user.phone,
      profileImage: user.profileImage,
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
        city: user.city,
        state: user.state,
        pinCode: user.pinCode,
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
    applyBranchAccessFilter(filter, req);

    const taskOverviewView = String(req.query.view || '').toLowerCase() === 'task-overview';
    const userProjection = taskOverviewView
      ? 'name email role companyRole jobRole employeeType employeeId company companyCode department branch assignedBranches isActive status createdAt'
      : '-password -resetToken -resetTokenExpiry';

    const users = await User.find(filter)
      .select(userProjection)
      .populate("department", "name description")
      .populate("branch", "name branchCode")
      .populate("assignedBranches", "name branchCode")
      .populate("company", "name companyName companyCode")
      .lean();
    const socketOnlineIds = getSocketOnlineUserIds(companyId);

    const includeStats = req.query.includeStats === 'true';
    let statsByUser = new Map();

    // One aggregation replaces two count queries per user. Most task-management
    // screens do not request stats, so their user list remains a single DB query.
    if (includeStats && users.length > 0) {
      const userIds = users.map(user => user._id);
      const stats = await Task.aggregate([
        {
          $match: {
            companyCode: String(companyCode).trim().toUpperCase(),
            isActive: true,
            assignedUsers: { $in: userIds }
          }
        },
        { $unwind: '$assignedUsers' },
        { $match: { assignedUsers: { $in: userIds } } },
        {
          $group: {
            _id: '$assignedUsers',
            total: { $sum: 1 },
            completed: {
              $sum: { $cond: [{ $eq: ['$overallStatus', 'completed'] }, 1, 0] }
            }
          }
        }
      ]);
      statsByUser = new Map(stats.map(stat => [stat._id.toString(), stat]));
    }

    const usersWithStats = users.map(user => {
      const stats = statsByUser.get(user._id.toString());
      const total = stats?.total || 0;
      const completed = stats?.completed || 0;
      return {
        ...user,
        id: user._id,
        ...getUserPresence(user, socketOnlineIds),
        taskStats: {
          total,
          completed,
          completionRate: total > 0 ? Math.round((completed / total) * 100) : 0
        }
      };
    });

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
    applyBranchAccessFilter(filter, req);
    
    void 0;
    
    const { page, limit, skip } = getPaginationOptions(req.query, { limit: 50, maxLimit: 100 });
    const [users, total] = await Promise.all([
      User.find(filter)
      .select('-password -resetToken -resetTokenExpiry')
      .populate('department', 'name description')
      .populate('branch', 'name branchCode')
      .populate('assignedBranches', 'name branchCode')
      .populate('company', 'name companyCode companyEmail companyPhone companyAddress logo')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
      User.countDocuments(filter)
    ]);
    
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
      total,
      pagination: buildPaginationMeta({ page, limit, total }),
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
        city: user.city,
        state: user.state,
        pinCode: user.pinCode,
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
    applyBranchAccessFilter(filter, req);

    if (name) filter.name = { $regex: name, $options: 'i' };
    if (email) filter.email = { $regex: email, $options: 'i' };
    if (department) filter.department = department;
    if (jobRole) filter.jobRole = jobRole;
    if (employeeType) filter.employeeType = employeeType;
    if (gender) filter.gender = gender;
    if (maritalStatus) filter.maritalStatus = maritalStatus;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const { page, limit, skip } = getPaginationOptions(req.query, { limit: 50, maxLimit: 100 });
    const [users, total] = await Promise.all([
      User.find(filter)
      .select('-password -resetToken -resetTokenExpiry')
      .populate('department', 'name description')
      .populate('branch', 'name branchCode')
      .populate('assignedBranches', 'name branchCode')
      .populate('company', 'name companyCode')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
      User.countDocuments(filter)
    ]);

    return successResponse(res, 200, {
      count: users.length,
      total,
      pagination: buildPaginationMeta({ page, limit, total }),
      users
    });
  } catch (err) {
    console.error("❌ Search users error:", err);
    return errorResponse(res, 500, "Failed to search users");
  }
};

void 0;
