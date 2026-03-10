// controllers/departmentController.js
const Department = require("../models/Department");
const User = require("../models/User");

const errorResponse = (res, status, message) => {
  return res.status(status).json({ success: false, message });
};

// Helper function to check if user is super-admin
const isSuperAdmin = (user) => {
  if (!user) return false;
  
  // Check if user has super-admin properties
  const isSuper = user.role === 'super-admin' && 
                 user.department === 'Management' && 
                 user.jobRole === 'super_admin';
  
  console.log('🔄 Checking super admin:', {
    userId: user._id || user.id,
    name: user.name,
    role: user.role,
    department: user.department,
    jobRole: user.jobRole,
    isSuper: isSuper
  });
  
  return isSuper;
};

// ✅ Create Department
exports.createDepartment = async (req, res) => {
  try {
    console.log("========================================");
    console.log("🚀 CREATE DEPARTMENT REQUEST RECEIVED");
    console.log("========================================");
    console.log("📦 Request body:", req.body);
    console.log("👤 Request user from middleware:", req.user);
    console.log("User ID from req.user:", req.user?.id);
    console.log("User role from req.user:", req.user?.role);
    console.log("User department from req.user:", req.user?.department);
    console.log("User jobRole from req.user:", req.user?.jobRole);
    
    const { name, description } = req.body;
    const createdBy = req.user ? req.user.id : null;

    if (!createdBy) {
      console.log("❌ ERROR: No createdBy - User not authenticated");
      return errorResponse(res, 401, "User not authenticated");
    }

    if (!name) {
      console.log("❌ ERROR: Department name is required");
      return errorResponse(res, 400, "Department name is required");
    }

    console.log("🔍 Fetching user from database with ID:", createdBy);
    
    // Get user from database
    const user = await User.findById(createdBy);
    if (!user) {
      console.log("❌ ERROR: User not found in database for ID:", createdBy);
      return errorResponse(res, 400, "User not found");
    }

    // console.log("✅ User found in database:", {
    //   id: user._id,
    //   name: user.name,
    //   email: user.email,
    //   role: user.role,
    //   department: user.department,
    //   jobRole: user.jobRole,
    //   company: user.company,
    //   companyCode: user.companyCode
    // });

    // Check if user has company
    if (!user.company) {
      console.log("❌ ERROR: User company not found in database");
      return errorResponse(res, 400, "User company not found");
    }

    // Check if user is super-admin
    const isSuper = isSuperAdmin(user);
    console.log("🎯 Is user super admin?", isSuper);
    
    // Determine company for department
    let companyId, companyCode;
    
    if (isSuper) {
      console.log("👑 User is SUPER ADMIN");
      // Super admin can specify company or use their own
      companyId = req.body.company || user.company;
      companyCode = req.body.companyCode || user.companyCode;
    } else {
      console.log("👤 User is REGULAR USER");
      // Regular users can only create for their own company
      companyId = user.company;
      companyCode = user.companyCode;
    }

    console.log("🏢 Department will be created for company:", {
      companyId: companyId,
      companyCode: companyCode
    });

    // Check if department already exists in this company
    console.log("🔎 Checking if department already exists...");
    const existingDept = await Department.findOne({ 
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      company: companyId,
      isActive: true
    });
    
    if (existingDept) {
      console.log("❌ ERROR: Department already exists:", existingDept);
      return errorResponse(res, 409, "Department already exists in this company");
    }

    console.log("✅ No duplicate found. Creating department...");
    
    const department = await Department.create({
      name,
      description,
      company: companyId,
      companyCode,
      createdBy
    });

    console.log("✅ Department created successfully:", department);
    console.log("========================================");

    return res.status(201).json({
      success: true,
      message: "Department created successfully",
      department
    });
  } catch (err) {
    console.error("❌ CREATE DEPARTMENT ERROR:", err.message);
    console.error("Error stack:", err.stack);
    
    // Handle duplicate key error (unique constraint)
    if (err.code === 11000) {
      console.log("❌ Duplicate key error - Department already exists");
      return errorResponse(res, 409, "Department already exists in this company");
    }
    
    return errorResponse(res, 500, "Failed to create department");
  }
};

// ✅ Get all departments (filtered by company if not super-admin)
exports.getAllDepartments = async (req, res) => {
  try {
    console.log("========================================");
    console.log("📋 GET ALL DEPARTMENTS REQUEST RECEIVED");
    console.log("========================================");
    console.log("👤 Request user from middleware:", req.user);
    console.log("📝 Request query params:", req.query);
    
    const { company } = req.query;
    
    if (!req.user) {
      console.log("❌ ERROR: No req.user - User not authenticated");
      return errorResponse(res, 401, "User not authenticated");
    }

    console.log("🔍 Fetching fresh user data from database for ID:", req.user.id);
    
    // Get fresh user data from database
    const user = await User.findById(req.user.id);
    if (!user) {
      console.log("❌ ERROR: User not found in database for ID:", req.user.id);
      return errorResponse(res, 400, "User not found");
    }

    console.log("✅ User from database:", {
      id: user._id,
      name: user.name,
      role: user.role,
      department: user.department,
      jobRole: user.jobRole,
      company: user.company,
      companyCode: user.companyCode
    });

    // Check if user is super-admin
    const isSuper = isSuperAdmin(user);
    console.log("🎯 Is user super admin?", isSuper);
    
    let query = { isActive: true };
    console.log("Base query (isActive: true)");
    
    // If not super-admin, filter by user's company
    if (!isSuper) {
      console.log("👤 User is NOT super admin - filtering by company");
      if (!user.company) {
        console.log("❌ ERROR: User company not found");
        return errorResponse(res, 400, "User company not found");
      }
      query.company = user.company;
      console.log("🔍 Adding company filter:", user.company);
    } else if (company) {
      // Super admin can filter by specific company
      console.log("👑 User is SUPER ADMIN - filtering by requested company:", company);
      query.company = company;
    } else {
      console.log("👑 User is SUPER ADMIN - NO company filter (will get all)");
    }
    
    console.log("📊 Final query for database:", query);
    console.log("🔍 Fetching departments from database...");
    
    const departments = await Department.find(query)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    console.log("✅ Departments found:", departments.length);
    console.log("Departments:", departments.map(d => ({
      id: d._id,
      name: d.name,
      company: d.company,
      companyCode: d.companyCode
    })));
    console.log("========================================");

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

// ✅ Update department
exports.updateDepartment = async (req, res) => {
  try {
    console.log("========================================");
    console.log("✏️ UPDATE DEPARTMENT REQUEST RECEIVED");
    console.log("========================================");
    console.log("📝 Department ID:", req.params.id);
    console.log("📦 Update data:", req.body);
    console.log("👤 Request user:", req.user);
    
    const { id } = req.params;
    const updateData = req.body;
    
    if (!req.user) {
      console.log("❌ ERROR: User not authenticated");
      return errorResponse(res, 401, "User not authenticated");
    }

    console.log("🔍 Fetching user from database:", req.user.id);
    const user = await User.findById(req.user.id);
    if (!user) {
      console.log("❌ ERROR: User not found in database");
      return errorResponse(res, 400, "User not found");
    }

    console.log("✅ User found:", {
      id: user._id,
      name: user.name,
      role: user.role,
      company: user.company
    });

    const isSuper = isSuperAdmin(user);
    console.log("🎯 Is user super admin?", isSuper);

    console.log("🔍 Fetching department to update:", id);
    const department = await Department.findById(id);
    if (!department) {
      console.log("❌ ERROR: Department not found");
      return errorResponse(res, 404, "Department not found");
    }

    console.log("✅ Department found:", {
      id: department._id,
      name: department.name,
      company: department.company,
      companyCode: department.companyCode
    });

    // Check permission: non-super admins can only update their company's departments
    if (!isSuper) {
      console.log("🔐 Checking permissions for regular user...");
      if (!user.company) {
        console.log("❌ ERROR: User company not found");
        return errorResponse(res, 400, "User company not found");
      }
      
      console.log("Comparing companies:");
      console.log("User company:", user.company.toString());
      console.log("Department company:", department.company.toString());
      
      if (department.company.toString() !== user.company.toString()) {
        console.log("❌ ERROR: User cannot update this department - different companies");
        return errorResponse(res, 403, "You can only update departments from your company");
      }
      console.log("✅ User has permission to update this department");
    }

    // Check if new name already exists in the same company
    if (updateData.name && updateData.name !== department.name) {
      console.log("🔍 Checking for duplicate department name:", updateData.name);
      const existingDept = await Department.findOne({ 
        name: { $regex: new RegExp(`^${updateData.name}$`, 'i') },
        company: department.company,
        _id: { $ne: id },
        isActive: true
      });
      
      if (existingDept) {
        console.log("❌ ERROR: Department name already exists:", existingDept);
        return errorResponse(res, 409, "Department name already exists in this company");
      }
      console.log("✅ Department name is unique");
    }

    // Prevent changing company for non-super admins
    if (!isSuper) {
      console.log("⚠️ Removing company fields from update data for regular user");
      delete updateData.company;
      delete updateData.companyCode;
    }

    console.log("📝 Updating department with data:", updateData);
    
    const updatedDepartment = await Department.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('createdBy', 'name email');

    console.log("✅ Department updated successfully:", updatedDepartment);
    console.log("========================================");

    return res.status(200).json({
      success: true,
      message: "Department updated successfully",
      department: updatedDepartment
    });
  } catch (err) {
    console.error("❌ UPDATE DEPARTMENT ERROR:", err.message);
    console.error("Error stack:", err.stack);
    
    // Handle duplicate key error
    if (err.code === 11000) {
      console.log("❌ Duplicate key error");
      return errorResponse(res, 409, "Department name already exists in this company");
    }
    
    return errorResponse(res, 500, "Failed to update department");
  }
};

// ✅ Delete department (soft delete)
exports.deleteDepartment = async (req, res) => {
  try {
    console.log("========================================");
    console.log("🗑️ DELETE DEPARTMENT REQUEST RECEIVED");
    console.log("========================================");
    console.log("📝 Department ID:", req.params.id);
    console.log("👤 Request user:", req.user);
    
    const { id } = req.params;
    
    if (!req.user) {
      console.log("❌ ERROR: User not authenticated");
      return errorResponse(res, 401, "User not authenticated");
    }

    console.log("🔍 Fetching user from database:", req.user.id);
    const user = await User.findById(req.user.id);
    if (!user) {
      console.log("❌ ERROR: User not found in database");
      return errorResponse(res, 400, "User not found");
    }

    console.log("✅ User found:", user._id, user.name);
    const isSuper = isSuperAdmin(user);
    console.log("🎯 Is user super admin?", isSuper);

    console.log("🔍 Fetching department to delete:", id);
    const department = await Department.findById(id);
    if (!department) {
      console.log("❌ ERROR: Department not found");
      return errorResponse(res, 404, "Department not found");
    }

    console.log("✅ Department found:", {
      id: department._id,
      name: department.name,
      company: department.company
    });

    // Check permission: non-super admins can only delete their company's departments
    if (!isSuper) {
      console.log("🔐 Checking permissions for regular user...");
      if (!user.company) {
        console.log("❌ ERROR: User company not found");
        return errorResponse(res, 400, "User company not found");
      }
      
      if (department.company.toString() !== user.company.toString()) {
        console.log("❌ ERROR: User cannot delete this department - different companies");
        return errorResponse(res, 403, "You can only delete departments from your company");
      }
      console.log("✅ User has permission to delete this department");
    }

    // Check if department has active users
    console.log("🔍 Checking if department has active users...");
    const usersCount = await User.countDocuments({ 
      department: id, 
      isActive: true 
    });
    
    console.log("Active users in department:", usersCount);
    
    if (usersCount > 0) {
      console.log("❌ ERROR: Cannot delete department with active users");
      return errorResponse(res, 400, "Cannot delete department with active users");
    }

    // Soft delete
    console.log("🗑️ Soft deleting department...");
    department.isActive = false;
    await department.save();

    console.log("✅ Department deleted successfully");
    console.log("========================================");

    return res.status(200).json({
      success: true,
      message: "Department deleted successfully"
    });
  } catch (err) {
    console.error("❌ DELETE DEPARTMENT ERROR:", err.message);
    console.error("Error stack:", err.stack);
    
    if (err.message === 'Cannot delete department with active users') {
      console.log("❌ Cannot delete - active users present");
      return errorResponse(res, 400, err.message);
    }
    
    return errorResponse(res, 500, "Failed to delete department");
  }
};

// ✅ Get departments by company (for dropdowns)
exports.getDepartmentsByCompany = async (req, res) => {
  try {
    console.log("========================================");
    console.log("🏢 GET DEPARTMENTS BY COMPANY REQUEST");
    console.log("========================================");
    console.log("📝 Company ID:", req.params.companyId);
    console.log("👤 Request user:", req.user);
    
    const { companyId } = req.params;
    
    if (!req.user) {
      console.log("❌ ERROR: User not authenticated");
      return errorResponse(res, 401, "User not authenticated");
    }

    console.log("🔍 Fetching user from database:", req.user.id);
    const user = await User.findById(req.user.id);
    if (!user) {
      console.log("❌ ERROR: User not found in database");
      return errorResponse(res, 400, "User not found");
    }

    console.log("✅ User found:", {
      id: user._id,
      name: user.name,
      company: user.company
    });

    const isSuper = isSuperAdmin(user);
    console.log("🎯 Is user super admin?", isSuper);
    
    let query = { 
      isActive: true,
      company: companyId 
    };
    
    console.log("Base query:", query);
    
    // If not super-admin, verify the company belongs to user
    if (!isSuper) {
      console.log("🔐 Verifying company access for regular user...");
      if (!user.company) {
        console.log("❌ ERROR: User company not found");
        return errorResponse(res, 400, "User company not found");
      }
      
      console.log("Comparing company IDs:");
      console.log("User company:", user.company.toString());
      console.log("Requested company:", companyId);
      
      if (user.company.toString() !== companyId) {
        console.log("❌ ERROR: Access denied - user cannot access this company");
        return errorResponse(res, 403, "Access denied");
      }
      console.log("✅ User has access to this company");
    }
    
    console.log("🔍 Fetching departments with query:", query);
    const departments = await Department.find(query)
      .select('name description')
      .sort({ name: 1 });

    console.log("✅ Departments found:", departments.length);
    console.log("========================================");

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

console.log("✅ departmentController.js loaded successfully");  