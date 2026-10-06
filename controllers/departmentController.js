
const Department = require("../models/Department");
const User = require("../models/User");
const Company = require("../models/Company");
const Branch = require("../models/Branch");
const mongoose = require("mongoose");
const { getCacheKey, getOrSetCached, invalidateCache } = require("../utils/inMemoryCache");
const { isSuperAdminUser } = require("../middleware/authMiddleware");

let cascadeDepartmentUpdate = async () => {};
try {
  const cascade = require("../services/cascadeSyncEngine");
  if (typeof cascade.cascadeDepartmentUpdate === "function") cascadeDepartmentUpdate = cascade.cascadeDepartmentUpdate;
} catch (e) {}

const DEPARTMENT_CACHE_PREFIX = "departments";
const DEPARTMENT_SELECT = "name description company companyCode branch branchCode supportHead supportHeadName workingDays workingDayHistory createdBy createdAt updatedAt isActive";

const errorResponse = (res, status, message) => {
  return res.status(status).json({ success: false, message });
};

const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const getIndiaDayStart = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  const shifted = new Date(date.getTime() + INDIA_OFFSET_MS);
  return new Date(Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate()
  ) - INDIA_OFFSET_MS);
};

const normalizeWorkingDays = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 7) {
    return { error: "Working days must be a whole number between 1 and 7" };
  }
  return { value: parsed };
};

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


exports.createDepartment = async (req, res) => {
  try {
    void 0;
    void 0;
    void 0;
    void 0;
    void 0;
    void 0;
    void 0;
    void 0;
    void 0;
    
    const { name, description, branch } = req.body;
    const workingDaysInput = normalizeWorkingDays(req.body.workingDays);
    if (workingDaysInput?.error) {
      return errorResponse(res, 400, workingDaysInput.error);
    }
    const workingDays = workingDaysInput?.value || 5;
    const createdBy = req.user ? req.user.id : null;

    if (!createdBy) {
      void 0;
      return errorResponse(res, 401, "User not authenticated");
    }

    if (!name) {
      void 0;
      return errorResponse(res, 400, "Department name is required");
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

    
    const isSuper = isSuperAdmin(user, req.user);
    let companyId, companyCode;
    
    if (isSuper) {
      const targetCompany = req.body.company || user.company;
      if (!targetCompany) {
        return errorResponse(res, 400, "Company is required");
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

    const existingDept = await Department.findOne({ 
      name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
      company: companyId,
      isActive: true
    });
    
    if (existingDept) {
      return errorResponse(res, 409, "Department already exists in this company");
    }

    let branchId = null;
    let branchCodeVal = "";
    
    if (branch) {
      const cleanBranch = String(branch).trim();
      if (mongoose.Types.ObjectId.isValid(cleanBranch)) {
        const branchObj = await Branch.findById(cleanBranch);
        if (branchObj) {
          branchId = branchObj._id;
          branchCodeVal = branchObj.branchCode;
        }
      }
    } else {
      const defaultBranch = await Branch.findOne({ company: companyId, isDefault: true });
      if (defaultBranch) {
        branchId = defaultBranch._id;
        branchCodeVal = defaultBranch.branchCode;
      }
    }

    void 0;
    
    const department = await Department.create({
      name,
      description,
      company: companyId,
      companyCode,
      branch: branchId,
      branchCode: branchCodeVal,
      workingDays,
      workingDayHistory: [{
        workingDays,
        effectiveFrom: getIndiaDayStart(new Date()),
        updatedBy: createdBy
      }],
      createdBy
    });

    void 0;
    void 0;
    invalidateCache(DEPARTMENT_CACHE_PREFIX);

    return res.status(201).json({
      success: true,
      message: "Department created successfully",
      department
    });
  } catch (err) {
    console.error("❌ CREATE DEPARTMENT ERROR:", err.message);
    console.error("Error stack:", err.stack);
    
    
    if (err.code === 11000) {
      void 0;
      return errorResponse(res, 409, "Department already exists in this company");
    }
    
    return errorResponse(res, 500, "Failed to create department");
  }
};


exports.getAllDepartments = async (req, res) => {
  try {
    const rawCompany = req.query.company || req.query.companyId || req.query.companyCode || req.query.code;
    const rawBranch = req.query.branch || req.query.branchId;

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
          return errorResponse(res, 403, "Access denied. You cannot view departments of another company.");
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

    if (rawBranch) {
      const cleanBranch = String(rawBranch).trim();
      if (mongoose.Types.ObjectId.isValid(cleanBranch)) {
        query.branch = new mongoose.Types.ObjectId(cleanBranch);
      } else {
        query.branchCode = cleanBranch;
      }
    }

    const cacheKey = getCacheKey(DEPARTMENT_CACHE_PREFIX, {
      company: rawCompany || (user.company ? user.company.toString() : "all"),
      branch: rawBranch || "all",
      role: isSuper ? "super" : "company",
    });

    const departments = await getOrSetCached(cacheKey, () => Department.find(query)
      .select(DEPARTMENT_SELECT)
      .populate('createdBy', 'name email')
      .populate('branch', 'name branchCode')
      .populate('company', 'companyName companyCode')
      .sort({ createdAt: -1 })
      .lean());

    return res.status(200).json({
      success: true,
      count: departments.length,
      departments
    });
  } catch (err) {
    console.error("❌ GET DEPARTMENTS ERROR:", err.message);
    console.error("Error stack:", err.stack);
    return errorResponse(res, 500, "Failed to fetch departments");
  }
};


exports.updateDepartment = async (req, res) => {
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
    const department = await Department.findById(id);
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
      
      if (department.company.toString() !== user.company.toString()) {
        void 0;
        return errorResponse(res, 403, "You can only update departments from your company");
      }
      void 0;
    }

    
    if (updateData.name && updateData.name !== department.name) {
      void 0;
      const existingDept = await Department.findOne({ 
        name: { $regex: new RegExp(`^${updateData.name}$`, 'i') },
        company: department.company,
        _id: { $ne: id },
        isActive: true
      });
      
      if (existingDept) {
        void 0;
        return errorResponse(res, 409, "Department name already exists in this company");
      }
      void 0;
    }

    
    if (!isSuper) {
      void 0;
      delete updateData.company;
      delete updateData.companyCode;
    }

    const workingDaysInput = normalizeWorkingDays(updateData.workingDays);
    if (workingDaysInput?.error) {
      return errorResponse(res, 400, workingDaysInput.error);
    }

    if (workingDaysInput?.value) {
      const nextWorkingDays = workingDaysInput.value;
      updateData.workingDays = nextWorkingDays;
      const effectiveFrom = getIndiaDayStart(new Date());
      const existingHistory = Array.isArray(department.workingDayHistory)
        ? department.workingDayHistory.map(entry => ({
            workingDays: entry.workingDays,
            effectiveFrom: entry.effectiveFrom,
            updatedBy: entry.updatedBy
          }))
        : [];
      const sameDayIndex = existingHistory.findIndex(entry => (
        entry.effectiveFrom &&
        getIndiaDayStart(entry.effectiveFrom).getTime() === effectiveFrom.getTime()
      ));
      const nextEntry = {
        workingDays: nextWorkingDays,
        effectiveFrom,
        updatedBy: req.user.id
      };
      if (sameDayIndex >= 0) {
        existingHistory[sameDayIndex] = nextEntry;
      } else {
        existingHistory.push(nextEntry);
      }
      updateData.workingDayHistory = existingHistory.sort((a, b) => new Date(a.effectiveFrom) - new Date(b.effectiveFrom));
    } else {
      delete updateData.workingDays;
      delete updateData.workingDayHistory;
    }

    
    if (updateData.branch) {
      const Branch = require("../models/Branch");
      const branchObj = await Branch.findById(updateData.branch);
      if (branchObj) {
        updateData.branchCode = branchObj.branchCode;
        updateData.branchName = branchObj.name;
      }
    }

    void 0;
    
    const updatedDepartment = await Department.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('createdBy', 'name email')
     .populate('branch', 'name branchCode')
     .lean();

    if (updateData.name) {
      cascadeDepartmentUpdate(id, { name: updateData.name, oldName: department.name }).catch(() => {});
    }

    void 0;
    void 0;
    invalidateCache(DEPARTMENT_CACHE_PREFIX);

    return res.status(200).json({
      success: true,
      message: "Department updated successfully",
      department: updatedDepartment
    });
  } catch (err) {
    console.error("❌ UPDATE DEPARTMENT ERROR:", err.message);
    console.error("Error stack:", err.stack);
    
    
    if (err.code === 11000) {
      void 0;
      return errorResponse(res, 409, "Department name already exists in this company");
    }
    
    return errorResponse(res, 500, "Failed to update department");
  }
};


exports.deleteDepartment = async (req, res) => {
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
    const department = await Department.findById(id);
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
      
      if (department.company.toString() !== user.company.toString()) {
        void 0;
        return errorResponse(res, 403, "You can only delete departments from your company");
      }
      void 0;
    }

    
    void 0;
    const usersCount = await User.countDocuments({ 
      department: id, 
      isActive: true 
    });
    
    void 0;
    
    if (usersCount > 0) {
      void 0;
      return errorResponse(res, 400, "Cannot delete department with active users");
    }

    
    void 0;
    department.isActive = false;
    await department.save();

    void 0;
    void 0;
    invalidateCache(DEPARTMENT_CACHE_PREFIX);

    return res.status(200).json({
      success: true,
      message: "Department deleted successfully"
    });
  } catch (err) {
    console.error("❌ DELETE DEPARTMENT ERROR:", err.message);
    console.error("Error stack:", err.stack);
    
    if (err.message === 'Cannot delete department with active users') {
      void 0;
      return errorResponse(res, 400, err.message);
    }
    
    return errorResponse(res, 500, "Failed to delete department");
  }
};


exports.getDepartmentsByCompany = async (req, res) => {
  try {
    void 0;
    void 0;
    void 0;
    void 0;
    void 0;
    
    const rawCompany = req.params.companyId || req.params.companyCode || req.params.id;
    const rawBranch = req.query.branch || req.query.branchId;

    if (!req.user) {
      return errorResponse(res, 401, "User not authenticated");
    }

    const user = await User.findById(req.user.id).select("role jobRole company companyCode isSuperAdmin").lean();
    if (!user) {
      return errorResponse(res, 400, "User not found");
    }

    const isSuper = isSuperAdmin(user, req.user);

    if (!isSuper) {
      if (!user.company) {
        return errorResponse(res, 400, "User company not found");
      }
      const cleanCompany = String(rawCompany).trim();
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

    if (rawBranch) {
      const cleanBranch = String(rawBranch).trim();
      if (mongoose.Types.ObjectId.isValid(cleanBranch)) {
        query.branch = new mongoose.Types.ObjectId(cleanBranch);
      } else {
        query.branchCode = cleanBranch;
      }
    }

    const cacheKey = getCacheKey(DEPARTMENT_CACHE_PREFIX, {
      company: rawCompany,
      branch: rawBranch || "all",
      scope: "company",
    });

    const departments = await getOrSetCached(cacheKey, () => Department.find(query)
      .populate('branch', 'name branchCode')
      .populate('createdBy', 'name email')
      .populate('company', 'companyName companyCode')
      .select('name description branch branchCode company companyCode workingDays workingDayHistory')
      .sort({ name: 1 })
      .lean());

    return res.status(200).json({
      success: true,
      count: departments.length,
      departments
    });
  } catch (err) {
    console.error("❌ GET DEPARTMENTS BY COMPANY ERROR:", err.message);
    console.error("Error stack:", err.stack);
    return errorResponse(res, 500, "Failed to fetch departments");
  }
};

void 0;  
