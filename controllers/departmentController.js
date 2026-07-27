
const Department = require("../models/Department");
const User = require("../models/User");

const errorResponse = (res, status, message) => {
  return res.status(status).json({ success: false, message });
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
    
    
    const user = await User.findById(createdBy);
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
    const existingDept = await Department.findOne({ 
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      company: companyId,
      isActive: true
    });
    
    if (existingDept) {
      void 0;
      return errorResponse(res, 409, "Department already exists in this company");
    }

    
    let branchId = branch || null;
    let branchCodeVal = "";
    
    if (branchId) {
      const Branch = require("../models/Branch");
      const branchObj = await Branch.findById(branchId);
      if (branchObj) {
        branchCodeVal = branchObj.branchCode;
      }
    } else {
      const Branch = require("../models/Branch");
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
      createdBy
    });

    void 0;
    void 0;

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
    void 0;
    void 0;
    void 0;
    void 0;
    void 0;
    
    const { company, branch } = req.query;
    
    if (!req.user) {
      void 0;
      return errorResponse(res, 401, "User not authenticated");
    }

    void 0;
    
    
    const user = await User.findById(req.user.id);
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

    if (branch) {
      query.branch = branch;
    }
    
    void 0;
    void 0;
    
    const departments = await Department.find(query)
      .populate('createdBy', 'name email')
      .populate('branch', 'name branchCode')
      .sort({ createdAt: -1 });

    void 0;
    void 0;
    void 0;

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
    const user = await User.findById(req.user.id);
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

    
    if (updateData.branch) {
      const Branch = require("../models/Branch");
      const branchObj = await Branch.findById(updateData.branch);
      if (branchObj) {
        updateData.branchCode = branchObj.branchCode;
      }
    }

    void 0;
    
    const updatedDepartment = await Department.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('createdBy', 'name email')
     .populate('branch', 'name branchCode');

    void 0;
    void 0;

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
    const user = await User.findById(req.user.id);
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
    
    const { companyId } = req.params;
    const { branch } = req.query;
    
    if (!req.user) {
      void 0;
      return errorResponse(res, 401, "User not authenticated");
    }

    void 0;
    const user = await User.findById(req.user.id);
    if (!user) {
      void 0;
      return errorResponse(res, 400, "User not found");
    }

    void 0;

    const isSuper = isSuperAdmin(user);
    void 0;
    
    let query = { 
      isActive: true,
      company: companyId 
    };

    if (branch) {
      query.branch = branch;
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
      
      if (user.company.toString() !== companyId) {
        void 0;
        return errorResponse(res, 403, "Access denied");
      }
      void 0;
    }
    
    void 0;
    const departments = await Department.find(query)
      .populate('branch', 'name branchCode')
      .select('name description branch')
      .sort({ name: 1 });

    void 0;
    void 0;

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
