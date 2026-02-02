const JobRole = require("../models/JobRole");
const User = require("../models/User");
const Department = require("../models/Department");

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

// ✅ Create Job Role
exports.createJobRole = async (req, res) => {
  try {
    console.log("========================================");
    console.log("🚀 CREATE JOB ROLE REQUEST RECEIVED");
    console.log("========================================");
    console.log("📦 Request body:", req.body);
    console.log("👤 Request user from middleware:", req.user);
    
    const { name, description, department } = req.body;
    const createdBy = req.user ? req.user.id : null;

    if (!createdBy) {
      console.log("❌ ERROR: No createdBy - User not authenticated");
      return errorResponse(res, 401, "User not authenticated");
    }

    if (!name) {
      console.log("❌ ERROR: Job role name is required");
      return errorResponse(res, 400, "Job role name is required");
    }

    if (!department) {
      console.log("❌ ERROR: Department is required");
      return errorResponse(res, 400, "Department is required");
    }

    console.log("🔍 Fetching user from database with ID:", createdBy);
    
    // Get user from database
    const user = await User.findById(createdBy);
    if (!user) {
      console.log("❌ ERROR: User not found in database for ID:", createdBy);
      return errorResponse(res, 400, "User not found");
    }

    console.log("✅ User found in database:", {
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department,
      jobRole: user.jobRole,
      company: user.company,
      companyCode: user.companyCode
    });

    // Check if user has company
    if (!user.company) {
      console.log("❌ ERROR: User company not found in database");
      return errorResponse(res, 400, "User company not found");
    }

    // Check if user is super-admin
    const isSuper = isSuperAdmin(user);
    console.log("🎯 Is user super admin?", isSuper);
    
    // Determine company for job role
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

    console.log("🏢 Job role will be created for company:", {
      companyId: companyId,
      companyCode: companyCode
    });

    // Verify department exists and belongs to the same company
    console.log("🔍 Verifying department...");
    const departmentExists = await Department.findOne({
      _id: department,
      company: companyId,
      isActive: true
    });
    
    if (!departmentExists) {
      console.log("❌ ERROR: Department not found or doesn't belong to this company");
      return errorResponse(res, 404, "Department not found or access denied");
    }

    // Check if job role already exists in this department and company
    console.log("🔎 Checking if job role already exists...");
    const existingJobRole = await JobRole.findOne({ 
      name: { $regex: new RegExp(`^${name}$`, 'i') },
      department: department,
      company: companyId,
      isActive: true
    });
    
    if (existingJobRole) {
      console.log("❌ ERROR: Job role already exists in this department:", existingJobRole);
      return errorResponse(res, 409, "Job role already exists in this department");
    }

    console.log("✅ No duplicate found. Creating job role...");
    
    const jobRole = await JobRole.create({
      name,
      description,
      department,
      company: companyId,
      companyCode,
      createdBy
    });

    console.log("✅ Job role created successfully:", jobRole);
    console.log("========================================");

    return res.status(201).json({
      success: true,
      message: "Job role created successfully",
      jobRole
    });
  } catch (err) {
    console.error("❌ CREATE JOB ROLE ERROR:", err.message);
    console.error("Error stack:", err.stack);
    
    // Handle duplicate key error (unique constraint)
    if (err.code === 11000) {
      console.log("❌ Duplicate key error - Job role already exists");
      return errorResponse(res, 409, "Job role already exists in this department");
    }
    
    return errorResponse(res, 500, "Failed to create job role");
  }
};

// ✅ Get all job roles (filtered by company if not super-admin)
exports.getAllJobRoles = async (req, res) => {
  try {
    console.log("========================================");
    console.log("📋 GET ALL JOB ROLES REQUEST RECEIVED");
    console.log("========================================");
    console.log("👤 Request user from middleware:", req.user);
    console.log("📝 Request query params:", req.query);
    
    const { company, department } = req.query;
    
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
    
    // Filter by department if specified
    if (department) {
      console.log("🔍 Adding department filter:", department);
      query.department = department;
    }
    
    console.log("📊 Final query for database:", query);
    console.log("🔍 Fetching job roles from database...");
    
    const jobRoles = await JobRole.find(query)
      .populate('createdBy', 'name email')
      .populate('department', 'name')
      .populate('company', 'name')
      .sort({ createdAt: -1 });

    console.log("✅ Job roles found:", jobRoles.length);
    console.log("========================================");

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

// ✅ Update job role
exports.updateJobRole = async (req, res) => {
  try {
    console.log("========================================");
    console.log("✏️ UPDATE JOB ROLE REQUEST RECEIVED");
    console.log("========================================");
    console.log("📝 Job role ID:", req.params.id);
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

    console.log("🔍 Fetching job role to update:", id);
    const jobRole = await JobRole.findById(id);
    if (!jobRole) {
      console.log("❌ ERROR: Job role not found");
      return errorResponse(res, 404, "Job role not found");
    }

    console.log("✅ Job role found:", {
      id: jobRole._id,
      name: jobRole.name,
      department: jobRole.department,
      company: jobRole.company
    });

    // Check permission: non-super admins can only update their company's job roles
    if (!isSuper) {
      console.log("🔐 Checking permissions for regular user...");
      if (!user.company) {
        console.log("❌ ERROR: User company not found");
        return errorResponse(res, 400, "User company not found");
      }
      
      console.log("Comparing companies:");
      console.log("User company:", user.company.toString());
      console.log("Job role company:", jobRole.company.toString());
      
      if (jobRole.company.toString() !== user.company.toString()) {
        console.log("❌ ERROR: User cannot update this job role - different companies");
        return errorResponse(res, 403, "You can only update job roles from your company");
      }
      console.log("✅ User has permission to update this job role");
    }

    // If updating department, verify new department exists and belongs to same company
    if (updateData.department && updateData.department !== jobRole.department.toString()) {
      console.log("🔍 Verifying new department...");
      const newDepartment = await Department.findOne({
        _id: updateData.department,
        company: jobRole.company,
        isActive: true
      });
      
      if (!newDepartment) {
        console.log("❌ ERROR: New department not found or doesn't belong to same company");
        return errorResponse(res, 404, "Department not found or access denied");
      }
    }

    // Check if new name already exists in the same department and company
    if (updateData.name && updateData.name !== jobRole.name) {
      const departmentId = updateData.department || jobRole.department;
      console.log("🔍 Checking for duplicate job role name:", updateData.name, "in department:", departmentId);
      
      const existingJobRole = await JobRole.findOne({ 
        name: { $regex: new RegExp(`^${updateData.name}$`, 'i') },
        department: departmentId,
        company: jobRole.company,
        _id: { $ne: id },
        isActive: true
      });
      
      if (existingJobRole) {
        console.log("❌ ERROR: Job role name already exists in this department:", existingJobRole);
        return errorResponse(res, 409, "Job role name already exists in this department");
      }
      console.log("✅ Job role name is unique in this department");
    }

    // Prevent changing company for non-super admins
    if (!isSuper) {
      console.log("⚠️ Removing company fields from update data for regular user");
      delete updateData.company;
      delete updateData.companyCode;
    }

    console.log("📝 Updating job role with data:", updateData);
    
    const updatedJobRole = await JobRole.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    )
    .populate('createdBy', 'name email')
    .populate('department', 'name')
    .populate('company', 'name');

    console.log("✅ Job role updated successfully:", updatedJobRole);
    console.log("========================================");

    return res.status(200).json({
      success: true,
      message: "Job role updated successfully",
      jobRole: updatedJobRole
    });
  } catch (err) {
    console.error("❌ UPDATE JOB ROLE ERROR:", err.message);
    console.error("Error stack:", err.stack);
    
    // Handle duplicate key error
    if (err.code === 11000) {
      console.log("❌ Duplicate key error");
      return errorResponse(res, 409, "Job role name already exists in this department");
    }
    
    return errorResponse(res, 500, "Failed to update job role");
  }
};

// ✅ Delete job role (soft delete)
exports.deleteJobRole = async (req, res) => {
  try {
    console.log("========================================");
    console.log("🗑️ DELETE JOB ROLE REQUEST RECEIVED");
    console.log("========================================");
    console.log("📝 Job role ID:", req.params.id);
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

    console.log("🔍 Fetching job role to delete:", id);
    const jobRole = await JobRole.findById(id);
    if (!jobRole) {
      console.log("❌ ERROR: Job role not found");
      return errorResponse(res, 404, "Job role not found");
    }

    console.log("✅ Job role found:", {
      id: jobRole._id,
      name: jobRole.name,
      department: jobRole.department,
      company: jobRole.company
    });

    // Check permission: non-super admins can only delete their company's job roles
    if (!isSuper) {
      console.log("🔐 Checking permissions for regular user...");
      if (!user.company) {
        console.log("❌ ERROR: User company not found");
        return errorResponse(res, 400, "User company not found");
      }
      
      if (jobRole.company.toString() !== user.company.toString()) {
        console.log("❌ ERROR: User cannot delete this job role - different companies");
        return errorResponse(res, 403, "You can only delete job roles from your company");
      }
      console.log("✅ User has permission to delete this job role");
    }

    // Check if job role has active users
    console.log("🔍 Checking if job role has active users...");
    const usersCount = await User.countDocuments({ 
      jobRole: id, 
      isActive: true 
    });
    
    console.log("Active users with this job role:", usersCount);
    
    if (usersCount > 0) {
      console.log("❌ ERROR: Cannot delete job role with active users");
      return errorResponse(res, 400, "Cannot delete job role with active users");
    }

    // Soft delete
    console.log("🗑️ Soft deleting job role...");
    jobRole.isActive = false;
    await jobRole.save();

    console.log("✅ Job role deleted successfully");
    console.log("========================================");

    return res.status(200).json({
      success: true,
      message: "Job role deleted successfully"
    });
  } catch (err) {
    console.error("❌ DELETE JOB ROLE ERROR:", err.message);
    console.error("Error stack:", err.stack);
    
    if (err.message === 'Cannot delete job role with active users') {
      console.log("❌ Cannot delete - active users present");
      return errorResponse(res, 400, err.message);
    }
    
    return errorResponse(res, 500, "Failed to delete job role");
  }
};

// ✅ Get job roles by department
exports.getJobRolesByDepartment = async (req, res) => {
  try {
    console.log("========================================");
    console.log("🏢 GET JOB ROLES BY DEPARTMENT REQUEST");
    console.log("========================================");
    console.log("📝 Department ID:", req.params.departmentId);
    console.log("👤 Request user:", req.user);
    
    const { departmentId } = req.params;
    
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
    
    // First, get the department to check its company
    const department = await Department.findById(departmentId);
    if (!department) {
      console.log("❌ ERROR: Department not found");
      return errorResponse(res, 404, "Department not found");
    }

    console.log("✅ Department found:", {
      id: department._id,
      name: department.name,
      company: department.company
    });

    // If not super-admin, verify the department belongs to user's company
    if (!isSuper) {
      console.log("🔐 Verifying department access for regular user...");
      if (!user.company) {
        console.log("❌ ERROR: User company not found");
        return errorResponse(res, 400, "User company not found");
      }
      
      console.log("Comparing company IDs:");
      console.log("User company:", user.company.toString());
      console.log("Department company:", department.company.toString());
      
      if (user.company.toString() !== department.company.toString()) {
        console.log("❌ ERROR: Access denied - user cannot access this department");
        return errorResponse(res, 403, "Access denied");
      }
      console.log("✅ User has access to this department");
    }
    
    let query = { 
      isActive: true,
      department: departmentId 
    };
    
    console.log("🔍 Fetching job roles with query:", query);
    const jobRoles = await JobRole.find(query)
      .select('name description')
      .sort({ name: 1 });

    console.log("✅ Job roles found:", jobRoles.length);
    console.log("========================================");

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
// ✅ Get job roles by department ID (for dropdowns)
exports.getJobRolesByDepartmentId = async (req, res) => {
  try {
    console.log("========================================");
    console.log("🏢 GET JOB ROLES BY DEPARTMENT ID API");
    console.log("========================================");
    console.log("📝 Department ID from params:", req.params.departmentId);
    console.log("👤 Request user:", req.user);
    
    const { departmentId } = req.params;
    
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

    // Check if user is super-admin
    const isSuper = isSuperAdmin(user);
    console.log("🎯 Is user super admin?", isSuper);

    // Get department details
    const department = await Department.findById(departmentId);
    if (!department) {
      console.log("❌ ERROR: Department not found");
      return errorResponse(res, 404, "Department not found");
    }

    console.log("✅ Department found:", {
      id: department._id,
      name: department.name,
      company: department.company
    });

    // Build query
    let query = { 
      department: departmentId,
      isActive: true 
    };

    // If not super-admin, filter by company
    if (!isSuper) {
      if (!user.company) {
        console.log("❌ ERROR: User company not found");
        return errorResponse(res, 400, "User company not found");
      }
      
      console.log("🔍 Adding company filter:", user.company);
      query.company = user.company;
      
      // Verify department belongs to user's company
      if (department.company.toString() !== user.company.toString()) {
        console.log("❌ ERROR: Department doesn't belong to user's company");
        return errorResponse(res, 403, "Access denied");
      }
    }

    console.log("🔍 Fetching job roles with query:", query);
    const jobRoles = await JobRole.find(query)
      .select('name description')
      .sort({ name: 1 });

    console.log("✅ Job roles found:", jobRoles.length);
    console.log("========================================");

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

console.log("✅ jobRoleController.js loaded successfully");