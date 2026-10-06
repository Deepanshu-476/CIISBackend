const JobRole = require("../models/JobRole");
const User = require("../models/User");
const Department = require("../models/Department");
const Company = require("../models/Company");
const Branch = require("../models/Branch");
const mongoose = require("mongoose");
const { isSuperAdminUser } = require("../middleware/authMiddleware");
const { getCacheKey, getOrSetCached, invalidateCache } = require("../utils/inMemoryCache");

let cascadeJobRoleUpdate = async () => {};
try {
  const cascade = require("../services/cascadeSyncEngine");
  if (typeof cascade.cascadeJobRoleUpdate === "function") cascadeJobRoleUpdate = cascade.cascadeJobRoleUpdate;
} catch (e) {}

const JOB_ROLE_CACHE_PREFIX = "jobRoles";
const JOB_ROLE_SELECT = "name description department departmentName company companyCode shiftSettings shifts createdBy createdAt updatedAt isActive";

const errorResponse = (res, status, message) => {
  return res.status(status).json({ success: false, message });
};

const DEFAULT_SHIFT_SETTINGS = {
  shiftName: "General Shift",
  shiftType: "general",
  shiftStart: "09:00",
  shiftEnd: "19:00",
  earlyClockInStart: "08:30",
  lateGraceLimit: "09:10",
  halfDayLateLimit: "11:00",
  shortLeaveEarlyLimit: "18:30",
  halfDayEarlyLimit: "15:00",
  secondHalfStart: "14:00",
  secondHalfClockInWindow: {
    start: "13:30",
    end: "14:30"
  }
};

const normalizeShift = (shift = {}, index = 0) => {
  const source = shift && typeof shift === "object" ? shift : {};
  return {
    ...DEFAULT_SHIFT_SETTINGS,
    ...source,
    shiftId: String(source.shiftId || source.id || source._id || new mongoose.Types.ObjectId()),
    shiftName: String(source.shiftName || source.name || `Shift ${index + 1}`).trim(),
    shiftType: String(source.shiftType || "custom").trim(),
    secondHalfClockInWindow: {
      ...DEFAULT_SHIFT_SETTINGS.secondHalfClockInWindow,
      ...(source.secondHalfClockInWindow || {})
    }
  };
};

const normalizeShifts = (shifts, shiftSettings) => {
  const list = Array.isArray(shifts) && shifts.length > 0 ? shifts : [shiftSettings || DEFAULT_SHIFT_SETTINGS];
  return list.map(normalizeShift).filter(shift => shift.shiftName);
};

const escapeRegex = (str = "") => String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const isSuperAdmin = (user, reqUser) => {
  if (isSuperAdminUser(reqUser) || isSuperAdminUser(user)) return true;
  if (!user) return false;

  const normalizedRole = String(user.role || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
  const normalizedJobRole = String(user.jobRole?.roleName || user.jobRole || '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_');
  const normalizedCompanyRole = String(user.companyRole || '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_');

  return normalizedRole === 'super-admin' ||
    normalizedJobRole === 'super_admin' ||
    normalizedCompanyRole === 'super_admin' ||
    user.isSuperAdmin === true;
};

const resolveCompanyScope = async (target, user) => {
  if (!target) {
    if (user && user.company) {
      return { companyId: user.company, companyCode: user.companyCode };
    }
    return null;
  }

  const cleanTarget = String(target).trim();
  if (mongoose.Types.ObjectId.isValid(cleanTarget)) {
    const companyDoc = await Company.findById(cleanTarget).select('_id companyCode').lean();
    if (companyDoc) {
      return { companyId: companyDoc._id, companyCode: companyDoc.companyCode };
    }
    return { companyId: new mongoose.Types.ObjectId(cleanTarget), companyCode: null };
  }

  const companyDoc = await Company.findOne({
    $or: [
      { companyCode: cleanTarget.toUpperCase() },
      { companyCode: cleanTarget },
      { dbIdentifier: cleanTarget }
    ]
  }).select('_id companyCode').lean();

  if (companyDoc) {
    return { companyId: companyDoc._id, companyCode: companyDoc.companyCode };
  }

  return { companyCode: cleanTarget };
};


exports.createJobRole = async (req, res) => {
  try {
    const { name, description, department, shiftSettings, shifts } = req.body;
    const createdBy = req.user ? req.user.id : null;

    if (!createdBy) {
      return errorResponse(res, 401, "User not authenticated");
    }

    const trimmedName = String(name || '').trim();
    if (!trimmedName) {
      return errorResponse(res, 400, "Job role name is required");
    }

    if (!department) {
      return errorResponse(res, 400, "Department is required");
    }

    const normalizedShifts = normalizeShifts(shifts, shiftSettings);
    if (normalizedShifts.length === 0) {
      return errorResponse(res, 400, "At least one shift is required");
    }

    const user = await User.findById(createdBy).select("name role jobRole company companyCode isSuperAdmin").lean();
    if (!user) {
      return errorResponse(res, 400, "User not found");
    }

    if (!user.company && !isSuperAdmin(user, req.user)) {
      return errorResponse(res, 400, "User company not found");
    }

    const isSuper = isSuperAdmin(user, req.user);
    
    let companyId, companyCode;
    
    if (isSuper) {
      const targetCompany = req.body.company || user.company;
      if (!targetCompany) {
        return errorResponse(res, 400, "Company is required for job role");
      }
      const companyScope = await resolveCompanyScope(targetCompany, user);
      if (!companyScope?.companyId) {
        return errorResponse(res, 400, "Selected company not found");
      }
      companyId = companyScope.companyId;
      companyCode = companyScope.companyCode || "";
    } else {
      companyId = user.company;
      companyCode = user.companyCode;
      if (!companyCode) {
        const companyScope = await resolveCompanyScope(companyId, user);
        companyCode = companyScope?.companyCode || "";
      }
    }

    const departmentExists = await Department.findOne({
      _id: department,
      $or: [
        { company: companyId },
        ...(companyCode ? [{ companyCode }] : [])
      ],
      isActive: true
    });
    
    if (!departmentExists) {
      return errorResponse(res, 404, "Department not found or access denied");
    }

    const existingJobRole = await JobRole.findOne({ 
      name: { $regex: new RegExp(`^${escapeRegex(trimmedName)}$`, 'i') },
      department: department,
      $or: [
        { company: companyId },
        ...(companyCode ? [{ companyCode }] : [])
      ],
      isActive: true
    });
    
    if (existingJobRole) {
      return errorResponse(res, 409, "Job role already exists in this department");
    }

    const jobRole = await JobRole.create({
      name: trimmedName,
      description: String(description || '').trim(),
      department,
      departmentName: departmentExists.name || "",
      company: companyId,
      companyCode,
      createdBy,
      createdByName: user.name || "",
      shiftSettings: normalizedShifts[0],
      shifts: normalizedShifts
    });

    try {
      invalidateCache(JOB_ROLE_CACHE_PREFIX);
    } catch (cacheErr) {
      console.warn("JobRole cache invalidate warning:", cacheErr.message);
    }

    const populatedJobRole = await JobRole.findById(jobRole._id)
      .select(JOB_ROLE_SELECT)
      .populate('createdBy', 'name email')
      .populate('department', 'name')
      .populate('company', 'companyName companyCode')
      .lean();

    return res.status(201).json({
      success: true,
      message: "Job role created successfully",
      jobRole: populatedJobRole || jobRole
    });
  } catch (err) {
    console.error("❌ CREATE JOB ROLE ERROR:", err.message);
    console.error("Error stack:", err.stack);
    
    if (err.code === 11000) {
      return errorResponse(res, 409, "Job role already exists in this department");
    }
    
    return errorResponse(res, 500, err.message || "Failed to create job role");
  }
};


exports.getAllJobRoles = async (req, res) => {
  try {
    const rawCompany = req.query.company || req.query.companyId || req.query.companyCode || req.query.code;
    const rawDepartment = req.query.department || req.query.departmentId || req.query.dept || req.query.deptId;
    
    if (!req.user) {
      return errorResponse(res, 401, "User not authenticated");
    }

    const user = await User.findById(req.user.id).select("role jobRole company companyCode isSuperAdmin").lean();
    if (!user) {
      return errorResponse(res, 400, "User not found");
    }

    const isSuper = isSuperAdmin(user, req.user);
    let query = { isActive: true };
    
    if (!isSuper) {
      if (!user.company) {
        return errorResponse(res, 400, "User company not found");
      }
      if (rawCompany) {
        const cleanCompany = String(rawCompany).trim();
        const matchesCompanyId = cleanCompany === user.company.toString();
        const matchesCompanyCode = user.companyCode && cleanCompany.toUpperCase() === user.companyCode.toUpperCase();
        if (!matchesCompanyId && !matchesCompanyCode) {
          return errorResponse(res, 403, "Access denied. You cannot view job roles of another company.");
        }
      }
      query.$or = [
        { company: user.company },
        ...(user.companyCode ? [{ companyCode: user.companyCode }] : [])
      ];
    } else {
      if (rawCompany) {
        const companyScope = await resolveCompanyScope(rawCompany, user);
        if (companyScope?.companyId) {
          query.$or = [
            { company: companyScope.companyId },
            ...(companyScope.companyCode ? [{ companyCode: companyScope.companyCode }] : [])
          ];
        } else if (companyScope?.companyCode) {
          query.companyCode = companyScope.companyCode;
        }
      } else if (user.company) {
        query.$or = [
          { company: user.company },
          ...(user.companyCode ? [{ companyCode: user.companyCode }] : [])
        ];
      }
    }
    
    if (rawDepartment) {
      const cleanDept = String(rawDepartment).trim();
      if (mongoose.Types.ObjectId.isValid(cleanDept)) {
        query.department = new mongoose.Types.ObjectId(cleanDept);
      } else {
        query.departmentName = new RegExp(`^${escapeRegex(cleanDept)}$`, 'i');
      }
    }
    
    const cacheKey = getCacheKey(JOB_ROLE_CACHE_PREFIX, {
      company: rawCompany || (user.company ? user.company.toString() : "all"),
      department: rawDepartment || "all",
      role: isSuper ? "super" : "company",
    });

    const jobRoles = await getOrSetCached(cacheKey, () => JobRole.find(query)
      .select(JOB_ROLE_SELECT)
      .populate('createdBy', 'name email')
      .populate('department', 'name')
      .populate('company', 'companyName companyCode')
      .sort({ createdAt: -1 })
      .lean());

    return res.status(200).json({
      success: true,
      count: jobRoles.length,
      jobRoles
    });
  } catch (err) {
    console.error("❌ GET JOB ROLES ERROR:", err.message);
    console.error("Error stack:", err.stack);
    return errorResponse(res, 500, "Failed to fetch job roles");
  }
};


exports.updateJobRole = async (req, res) => {
  try {
    void 0;
    void 0;
    void 0;
    void 0;
    void 0;
    void 0;
    
    const { id } = req.params;
    const updateData = req.body;
    
    if (!req.user) {
      void 0;
      return errorResponse(res, 401, "User not authenticated");
    }

    void 0;
    const user = await User.findById(req.user.id).select("role jobRole company companyCode isSuperAdmin").lean();
    if (!user) {
      void 0;
      return errorResponse(res, 400, "User not found");
    }

    void 0;

    const isSuper = isSuperAdmin(user, req.user);
    void 0;

    void 0;
    const jobRole = await JobRole.findById(id);
    if (!jobRole) {
      void 0;
      return errorResponse(res, 404, "Job role not found");
    }

    void 0;

    
    if (!isSuper) {
      void 0;
      if (!user.company) {
        void 0;
        return errorResponse(res, 400, "User company not found");
      }
      
      void 0;
      void 0;
      void 0;
      
      const roleComp = jobRole.company ? jobRole.company.toString() : "";
      const userComp = user.company ? user.company.toString() : "";
      const roleCode = jobRole.companyCode ? jobRole.companyCode.toUpperCase() : "";
      const userCode = user.companyCode ? user.companyCode.toUpperCase() : "";
      const matchesId = roleComp && roleComp === userComp;
      const matchesCode = roleCode && roleCode === userCode;
      if (!matchesId && !matchesCode) {
        return errorResponse(res, 403, "You can only update job roles from your company");
      }
      void 0;
    }

    
    if (updateData.department && updateData.department !== jobRole.department.toString()) {
      void 0;
      const newDepartment = await Department.findOne({
        _id: updateData.department,
        company: jobRole.company,
        isActive: true
      });
      
      if (!newDepartment) {
        void 0;
        return errorResponse(res, 404, "Department not found or access denied");
      }
    }

    
    if (updateData.name && updateData.name !== jobRole.name) {
      const departmentId = updateData.department || jobRole.department;
      const cleanName = String(updateData.name).trim();
      
      const existingJobRole = await JobRole.findOne({ 
        name: { $regex: new RegExp(`^${escapeRegex(cleanName)}$`, 'i') },
        department: departmentId,
        company: jobRole.company,
        _id: { $ne: id },
        isActive: true
      });
      
      if (existingJobRole) {
        return errorResponse(res, 409, "Job role name already exists in this department");
      }
      updateData.name = cleanName;
    }

    if (!isSuper) {
      delete updateData.company;
      delete updateData.companyCode;
    }

    if (updateData.shifts || updateData.shiftSettings) {
      const normalizedShifts = normalizeShifts(updateData.shifts, updateData.shiftSettings || jobRole.shiftSettings);
      if (normalizedShifts.length === 0) {
        return errorResponse(res, 400, "At least one shift is required");
      }
      updateData.shifts = normalizedShifts;
      updateData.shiftSettings = normalizedShifts[0];
    }

    const updatedJobRole = await JobRole.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    )
    .populate('createdBy', 'name email')
    .populate('department', 'name')
    .populate('company', 'companyName companyCode')
    .lean();

    try {
      invalidateCache(JOB_ROLE_CACHE_PREFIX);
    } catch (cacheErr) {
      console.warn("JobRole cache invalidate warning:", cacheErr.message);
    }

    if (updateData.name) {
      cascadeJobRoleUpdate(id, { name: updateData.name, oldName: jobRole.name }).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      message: "Job role updated successfully",
      jobRole: updatedJobRole
    });
  } catch (err) {
    console.error("❌ UPDATE JOB ROLE ERROR:", err.message);
    console.error("Error stack:", err.stack);
    
    if (err.code === 11000) {
      return errorResponse(res, 409, "Job role name already exists in this department");
    }
    
    return errorResponse(res, 500, err.message || "Failed to update job role");
  }
};


exports.deleteJobRole = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!req.user) {
      return errorResponse(res, 401, "User not authenticated");
    }

    const user = await User.findById(req.user.id).select("role jobRole company companyCode isSuperAdmin").lean();
    if (!user) {
      return errorResponse(res, 400, "User not found");
    }

    const isSuper = isSuperAdmin(user, req.user);

    const jobRole = await JobRole.findById(id);
    if (!jobRole) {
      return errorResponse(res, 404, "Job role not found");
    }

    if (!isSuper) {
      if (!user.company) {
        return errorResponse(res, 400, "User company not found");
      }
      
      const roleComp = jobRole.company ? jobRole.company.toString() : "";
      const userComp = user.company ? user.company.toString() : "";
      const roleCode = jobRole.companyCode ? jobRole.companyCode.toUpperCase() : "";
      const userCode = user.companyCode ? user.companyCode.toUpperCase() : "";
      const matchesId = roleComp && roleComp === userComp;
      const matchesCode = roleCode && roleCode === userCode;
      if (!matchesId && !matchesCode) {
        return errorResponse(res, 403, "You can only delete job roles from your company");
      }
    }

    const usersCount = await User.countDocuments({ 
      jobRole: id, 
      isActive: true 
    });
    
    if (usersCount > 0) {
      return errorResponse(res, 400, "Cannot delete job role with active users");
    }

    jobRole.isActive = false;
    await jobRole.save();

    try {
      invalidateCache(JOB_ROLE_CACHE_PREFIX);
    } catch (cacheErr) {
      console.warn("JobRole cache invalidate warning:", cacheErr.message);
    }

    return res.status(200).json({
      success: true,
      message: "Job role deleted successfully"
    });
  } catch (err) {
    console.error("❌ DELETE JOB ROLE ERROR:", err.message);
    console.error("Error stack:", err.stack);
    
    if (err.message === 'Cannot delete job role with active users') {
      return errorResponse(res, 400, err.message);
    }
    
    return errorResponse(res, 500, err.message || "Failed to delete job role");
  }
};


exports.getJobRolesByCompany = async (req, res) => {
  try {
    const rawCompany = req.params.companyId || req.params.companyid || req.params.id;
    const rawDepartment = req.query.department || req.query.departmentId || req.query.dept || req.params.departmentId;

    if (!req.user) {
      return errorResponse(res, 401, "User not authenticated");
    }

    const user = await User.findById(req.user.id).select("role jobRole company companyCode isSuperAdmin").lean();
    if (!user) {
      return errorResponse(res, 400, "User not found");
    }

    const isSuper = isSuperAdmin(user, req.user);
    if (!isSuper && user.company) {
      const cleanCompany = String(rawCompany || '').trim();
      const matchesCompanyId = cleanCompany === user.company.toString();
      const matchesCompanyCode = user.companyCode && cleanCompany.toUpperCase() === user.companyCode.toUpperCase();
      if (!matchesCompanyId && !matchesCompanyCode) {
        return errorResponse(res, 403, "Access denied");
      }
    }

    const companyScope = await resolveCompanyScope(rawCompany, user);
    let query = { isActive: true };

    if (companyScope?.companyId) {
      query.$or = [
        { company: companyScope.companyId },
        ...(companyScope.companyCode ? [{ companyCode: companyScope.companyCode }] : [])
      ];
    } else if (companyScope?.companyCode) {
      query.companyCode = companyScope.companyCode;
    } else if (user.company) {
      query.company = user.company;
    }

    if (rawDepartment) {
      const cleanDept = String(rawDepartment).trim();
      if (mongoose.Types.ObjectId.isValid(cleanDept)) {
        query.department = new mongoose.Types.ObjectId(cleanDept);
      } else {
        query.departmentName = new RegExp(`^${escapeRegex(cleanDept)}$`, 'i');
      }
    }

    const cacheKey = getCacheKey(JOB_ROLE_CACHE_PREFIX, {
      company: rawCompany,
      department: rawDepartment || "all",
      scope: "company",
    });

    const jobRoles = await getOrSetCached(cacheKey, () => JobRole.find(query)
      .select(JOB_ROLE_SELECT)
      .populate('createdBy', 'name email')
      .populate('department', 'name')
      .populate('company', 'companyName companyCode')
      .sort({ name: 1 })
      .lean());

    return res.status(200).json({
      success: true,
      count: jobRoles.length,
      jobRoles
    });
  } catch (err) {
    console.error("❌ GET JOB ROLES BY COMPANY ERROR:", err.message);
    return errorResponse(res, 500, "Failed to fetch job roles");
  }
};

exports.getJobRolesByDepartment = async (req, res) => {
  try {
    const departmentId = req.params.departmentId || req.params.companyid;
    
    if (!req.user) {
      return errorResponse(res, 401, "User not authenticated");
    }

    if (!departmentId || !mongoose.Types.ObjectId.isValid(departmentId)) {
      return res.status(200).json({ success: true, count: 0, jobRoles: [] });
    }

    const user = await User.findById(req.user.id).select("role jobRole company companyCode isSuperAdmin").lean();
    if (!user) {
      return errorResponse(res, 400, "User not found");
    }

    const isSuper = isSuperAdmin(user, req.user);
    
    const department = await Department.findById(departmentId).select("company companyCode").lean();
    if (!department) {
      return res.status(200).json({ success: true, count: 0, jobRoles: [] });
    }

    if (!isSuper) {
      if (!user.company) {
        return errorResponse(res, 400, "User company not found");
      }
      
      const deptComp = department.company ? department.company.toString() : "";
      const userComp = user.company ? user.company.toString() : "";
      const deptCode = department.companyCode ? department.companyCode.toUpperCase() : "";
      const userCode = user.companyCode ? user.companyCode.toUpperCase() : "";
      const matchesId = deptComp && deptComp === userComp;
      const matchesCode = deptCode && deptCode === userCode;
      if (!matchesId && !matchesCode) {
        return errorResponse(res, 403, "Access denied");
      }
    }
    
    let query = { 
      isActive: true,
      department: departmentId
    };
    
    const cacheKey = getCacheKey(JOB_ROLE_CACHE_PREFIX, {
      department: departmentId,
      company: department.company,
      scope: "department",
    });
    const jobRoles = await getOrSetCached(cacheKey, () => JobRole.find(query)
      .select(JOB_ROLE_SELECT)
      .populate('createdBy', 'name email')
      .populate('department', 'name')
      .populate('company', 'companyName companyCode')
      .sort({ name: 1 })
      .lean());

    return res.status(200).json({
      success: true,
      count: jobRoles.length,
      jobRoles
    });
  } catch (err) {
    console.error("❌ GET JOB ROLES BY DEPARTMENT ERROR:", err.message);
    console.error("Error stack:", err.stack);
    return errorResponse(res, 500, "Failed to fetch job roles");
  }
};

exports.getJobRolesByDepartmentId = async (req, res) => {
  try {
    const { departmentId } = req.params;
    
    if (!req.user) {
      return errorResponse(res, 401, "User not authenticated");
    }

    if (!departmentId || !mongoose.Types.ObjectId.isValid(departmentId)) {
      return res.status(200).json({ success: true, count: 0, jobRoles: [] });
    }

    const user = await User.findById(req.user.id).select("role jobRole company companyCode isSuperAdmin").lean();
    if (!user) {
      return errorResponse(res, 400, "User not found");
    }

    const isSuper = isSuperAdmin(user, req.user);

    const department = await Department.findById(departmentId).select("company companyCode").lean();
    if (!department) {
      return res.status(200).json({ success: true, count: 0, jobRoles: [] });
    }

    if (!isSuper) {
      if (!user.company) {
        return errorResponse(res, 400, "User company not found");
      }
      
      const deptComp = department.company ? department.company.toString() : "";
      const userComp = user.company ? user.company.toString() : "";
      const deptCode = department.companyCode ? department.companyCode.toUpperCase() : "";
      const userCode = user.companyCode ? user.companyCode.toUpperCase() : "";
      const matchesId = deptComp && deptComp === userComp;
      const matchesCode = deptCode && deptCode === userCode;
      if (!matchesId && !matchesCode) {
        return errorResponse(res, 403, "Access denied");
      }
    }

    let query = { 
      department: departmentId,
      isActive: true 
    };

    const cacheKey = getCacheKey(JOB_ROLE_CACHE_PREFIX, {
      department: departmentId,
      company: department.company,
      scope: "department-id",
    });
    const jobRoles = await getOrSetCached(cacheKey, () => JobRole.find(query)
      .select(JOB_ROLE_SELECT)
      .populate('createdBy', 'name email')
      .populate('department', 'name')
      .populate('company', 'companyName companyCode')
      .sort({ name: 1 })
      .lean());

    return res.status(200).json({
      success: true,
      count: jobRoles.length,
      jobRoles
    });
  } catch (err) {
    console.error("❌ GET JOB ROLES BY DEPARTMENT ID ERROR:", err.message);
    console.error("Error stack:", err.stack);
    return errorResponse(res, 500, "Failed to fetch job roles");
  }
};
