const JobRole = require("../models/JobRole");
const User = require("../models/User");
const Department = require("../models/Department");
const mongoose = require("mongoose");
const { getCacheKey, getOrSetCached, invalidateCache } = require("../utils/inMemoryCache");

const JOB_ROLE_CACHE_PREFIX = "jobRoles";
const JOB_ROLE_SELECT = "name description department company companyCode shiftSettings shifts createdBy createdAt updatedAt isActive";

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


const isSuperAdmin = (user) => {
  if (!user) return false;

  const normalizedRole = String(user.role || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
  const normalizedJobRole = String(user.jobRole?.roleName || user.jobRole || '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_');
  const isSuper = normalizedRole === 'super-admin' || normalizedJobRole === 'super_admin';
  
  void 0;
  
  return isSuper;
};


exports.createJobRole = async (req, res) => {
  try {
    void 0;
    void 0;
    void 0;
    void 0;
    void 0;
    
    const { name, description, department, shiftSettings, shifts } = req.body;
    const createdBy = req.user ? req.user.id : null;

    if (!createdBy) {
      void 0;
      return errorResponse(res, 401, "User not authenticated");
    }

    if (!name) {
      void 0;
      return errorResponse(res, 400, "Job role name is required");
    }

    if (!department) {
      void 0;
      return errorResponse(res, 400, "Department is required");
    }

    const normalizedShifts = normalizeShifts(shifts, shiftSettings);
    if (normalizedShifts.length === 0) {
      return errorResponse(res, 400, "At least one shift is required");
    }

    void 0;
    
    
    const user = await User.findById(createdBy).select("role jobRole company companyCode").lean();
    if (!user) {
      void 0;
      return errorResponse(res, 400, "User not found");
    }

    
    
    
    
    
    
    
    
    
    

    
    if (!user.company) {
      void 0;
      return errorResponse(res, 400, "User company not found");
    }

    
    const isSuper = isSuperAdmin(user);
    void 0;
    
    
    let companyId, companyCode;
    
    if (isSuper) {
      void 0;
      
      companyId = req.body.company || user.company;
      const Company = require("../models/Company");
      const selectedCompany = await Company.findById(companyId).select("companyCode");
      if (!selectedCompany) {
        return errorResponse(res, 400, "Selected company not found");
      }
      companyCode = selectedCompany.companyCode;
    } else {
      void 0;
      
      companyId = user.company;
      companyCode = user.companyCode;
    }

    void 0;

    
    void 0;
    const departmentExists = await Department.findOne({
      _id: department,
      company: companyId,
      isActive: true
    });
    
    if (!departmentExists) {
      void 0;
      return errorResponse(res, 404, "Department not found or access denied");
    }

    
    void 0;
    const existingJobRole = await JobRole.findOne({ 
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      department: department,
      company: companyId,
      isActive: true
    });
    
    if (existingJobRole) {
      void 0;
      return errorResponse(res, 409, "Job role already exists in this department");
    }

    void 0;
    
    const jobRole = await JobRole.create({
      name,
      description,
      department,
      company: companyId,
      companyCode,
      createdBy,
      shiftSettings: normalizedShifts[0],
      shifts: normalizedShifts
    });

    void 0;
    void 0;
    invalidateCache(JOB_ROLE_CACHE_PREFIX);

    return res.status(201).json({
      success: true,
      message: "Job role created successfully",
      jobRole
    });
  } catch (err) {
    console.error("❌ CREATE JOB ROLE ERROR:", err.message);
    console.error("Error stack:", err.stack);
    
    
    if (err.code === 11000) {
      void 0;
      return errorResponse(res, 409, "Job role already exists in this department");
    }
    
    return errorResponse(res, 500, "Failed to create job role");
  }
};


exports.getAllJobRoles = async (req, res) => {
  try {
    void 0;
    void 0;
    void 0;
    void 0;
    void 0;
    
    const { company, department } = req.query;
    
    if (!req.user) {
      void 0;
      return errorResponse(res, 401, "User not authenticated");
    }

    void 0;
    
    
    const user = await User.findById(req.user.id).select("role jobRole company companyCode").lean();
    if (!user) {
      void 0;
      return errorResponse(res, 400, "User not found");
    }

    void 0;

    
    const isSuper = isSuperAdmin(user);
    void 0;
    
    let query = { isActive: true };
    void 0;
    
    
    if (!isSuper) {
      void 0;
      if (!user.company) {
        void 0;
        return errorResponse(res, 400, "User company not found");
      }
      query.company = user.company;
      void 0;
    } else if (company) {
      
      void 0;
      query.company = company;
    } else {
      if (!user.company) {
        return errorResponse(res, 400, "User company not found");
      }
      query.company = user.company;
    }
    
    
    if (department) {
      void 0;
      query.department = department;
    }
    
    void 0;
    void 0;
    
    const cacheKey = getCacheKey(JOB_ROLE_CACHE_PREFIX, {
      company: query.company,
      department: query.department,
      role: isSuper ? "super" : "company",
    });
    const jobRoles = await getOrSetCached(cacheKey, () => JobRole.find(query)
      .select(JOB_ROLE_SELECT)
      .populate('createdBy', 'name email')
      .populate('department', 'name')
      .populate('company', 'name')
      .sort({ createdAt: -1 })
      .lean());

    void 0;
    void 0;

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
    const user = await User.findById(req.user.id).select("role jobRole company companyCode").lean();
    if (!user) {
      void 0;
      return errorResponse(res, 400, "User not found");
    }

    void 0;

    const isSuper = isSuperAdmin(user);
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
      
      if (jobRole.company.toString() !== user.company.toString()) {
        void 0;
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
      void 0;
      
      const existingJobRole = await JobRole.findOne({ 
        name: { $regex: new RegExp(`^${updateData.name}$`, 'i') },
        department: departmentId,
        company: jobRole.company,
        _id: { $ne: id },
        isActive: true
      });
      
      if (existingJobRole) {
        void 0;
        return errorResponse(res, 409, "Job role name already exists in this department");
      }
      void 0;
    }

    
    if (!isSuper) {
      void 0;
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

    void 0;
    
    const updatedJobRole = await JobRole.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    )
    .populate('createdBy', 'name email')
    .populate('department', 'name')
    .populate('company', 'name')
    .lean();

    void 0;
    void 0;
    invalidateCache(JOB_ROLE_CACHE_PREFIX);

    return res.status(200).json({
      success: true,
      message: "Job role updated successfully",
      jobRole: updatedJobRole
    });
  } catch (err) {
    console.error("❌ UPDATE JOB ROLE ERROR:", err.message);
    console.error("Error stack:", err.stack);
    
    
    if (err.code === 11000) {
      void 0;
      return errorResponse(res, 409, "Job role name already exists in this department");
    }
    
    return errorResponse(res, 500, "Failed to update job role");
  }
};


exports.deleteJobRole = async (req, res) => {
  try {
    void 0;
    void 0;
    void 0;
    void 0;
    void 0;
    
    const { id } = req.params;
    
    if (!req.user) {
      void 0;
      return errorResponse(res, 401, "User not authenticated");
    }

    void 0;
    const user = await User.findById(req.user.id).select("role jobRole company companyCode").lean();
    if (!user) {
      void 0;
      return errorResponse(res, 400, "User not found");
    }

    void 0;
    const isSuper = isSuperAdmin(user);
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
      
      if (jobRole.company.toString() !== user.company.toString()) {
        void 0;
        return errorResponse(res, 403, "You can only delete job roles from your company");
      }
      void 0;
    }

    
    void 0;
    const usersCount = await User.countDocuments({ 
      jobRole: id, 
      isActive: true 
    });
    
    void 0;
    
    if (usersCount > 0) {
      void 0;
      return errorResponse(res, 400, "Cannot delete job role with active users");
    }

    
    void 0;
    jobRole.isActive = false;
    await jobRole.save();

    void 0;
    void 0;
    invalidateCache(JOB_ROLE_CACHE_PREFIX);

    return res.status(200).json({
      success: true,
      message: "Job role deleted successfully"
    });
  } catch (err) {
    console.error("❌ DELETE JOB ROLE ERROR:", err.message);
    console.error("Error stack:", err.stack);
    
    if (err.message === 'Cannot delete job role with active users') {
      void 0;
      return errorResponse(res, 400, err.message);
    }
    
    return errorResponse(res, 500, "Failed to delete job role");
  }
};


exports.getJobRolesByDepartment = async (req, res) => {
  try {
    void 0;
    void 0;
    void 0;
    void 0;
    void 0;
    
    const { departmentId } = req.params;
    
    if (!req.user) {
      void 0;
      return errorResponse(res, 401, "User not authenticated");
    }

    void 0;
    const user = await User.findById(req.user.id).select("role jobRole company companyCode").lean();
    if (!user) {
      void 0;
      return errorResponse(res, 400, "User not found");
    }

    void 0;

    const isSuper = isSuperAdmin(user);
    void 0;
    
    
    const department = await Department.findById(departmentId).select("company").lean();
    if (!department) {
      void 0;
      return errorResponse(res, 404, "Department not found");
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
      
      if (user.company.toString() !== department.company.toString()) {
        void 0;
        return errorResponse(res, 403, "Access denied");
      }
      void 0;
    }
    
    let query = { 
      isActive: true,
      department: departmentId 
    };
    
    void 0;
    const cacheKey = getCacheKey(JOB_ROLE_CACHE_PREFIX, {
      department: departmentId,
      company: query.company || department.company,
      scope: "department",
    });
    const jobRoles = await getOrSetCached(cacheKey, () => JobRole.find(query)
      .select('name description')
      .sort({ name: 1 })
      .lean());

    void 0;
    void 0;

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
    void 0;
    void 0;
    void 0;
    void 0;
    void 0;
    
    const { departmentId } = req.params;
    
    if (!req.user) {
      void 0;
      return errorResponse(res, 401, "User not authenticated");
    }

    void 0;
    const user = await User.findById(req.user.id).select("role jobRole company companyCode").lean();
    if (!user) {
      void 0;
      return errorResponse(res, 400, "User not found");
    }

    void 0;

    
    const isSuper = isSuperAdmin(user);
    void 0;

    
    const department = await Department.findById(departmentId).select("company").lean();
    if (!department) {
      void 0;
      return errorResponse(res, 404, "Department not found");
    }

    void 0;

    
    let query = { 
      department: departmentId,
      isActive: true 
    };

    
    if (!isSuper) {
      if (!user.company) {
        void 0;
        return errorResponse(res, 400, "User company not found");
      }
      
      void 0;
      query.company = user.company;
      
      
      if (department.company.toString() !== user.company.toString()) {
        void 0;
        return errorResponse(res, 403, "Access denied");
      }
    }

    void 0;
    const cacheKey = getCacheKey(JOB_ROLE_CACHE_PREFIX, {
      department: departmentId,
      company: query.company || department.company,
      scope: "department-id",
    });
    const jobRoles = await getOrSetCached(cacheKey, () => JobRole.find(query)
      .select('name description')
      .sort({ name: 1 })
      .lean());

    void 0;
    void 0;

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

void 0;
