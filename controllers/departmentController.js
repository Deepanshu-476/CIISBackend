const Department = require("../models/Department");

const errorResponse = (res, status, message) => {
  return res.status(status).json({ success: false, message });
};

// ✅ Create Department (Admin only)
exports.createDepartment = async (req, res) => {
  try {
    const { name, description } = req.body;
    const createdBy = req.user.id;

    if (!name) {
      return errorResponse(res, 400, "Department name is required");
    }

    // Check if department already exists
    const existingDept = await Department.findOne({ 
      name: { $regex: new RegExp(`^${name}$`, 'i') } 
    });
    
    if (existingDept) {
      return errorResponse(res, 409, "Department already exists");
    }

    const department = await Department.create({
      name,
      description,
      createdBy
    });

    return res.status(201).json({
      success: true,
      message: "Department created successfully",
      department
    });
  } catch (err) {
    console.error("❌ Create department error:", err);
    return errorResponse(res, 500, "Failed to create department");
  }
};

// ✅ Get all departments
exports.getAllDepartments = async (req, res) => {
  try {
    const departments = await Department.find({ isActive: true })
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: departments.length,
      departments
    });
  } catch (err) {
    console.error("❌ Get departments error:", err);
    return errorResponse(res, 500, "Failed to fetch departments");
  }
};

// ✅ Update department (Admin only)
exports.updateDepartment = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const department = await Department.findById(id);
    if (!department) {
      return errorResponse(res, 404, "Department not found");
    }

    // Check if new name already exists
    if (updateData.name && updateData.name !== department.name) {
      const existingDept = await Department.findOne({ 
        name: { $regex: new RegExp(`^${updateData.name}$`, 'i') },
        _id: { $ne: id }
      });
      
      if (existingDept) {
        return errorResponse(res, 409, "Department name already exists");
      }
    }

    const updatedDepartment = await Department.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('createdBy', 'name email');

    return res.status(200).json({
      success: true,
      message: "Department updated successfully",
      department: updatedDepartment
    });
  } catch (err) {
    console.error("❌ Update department error:", err);
    return errorResponse(res, 500, "Failed to update department");
  }
};

// ✅ Delete department (Admin only, soft delete)
exports.deleteDepartment = async (req, res) => {
  try {
    const { id } = req.params;

    const department = await Department.findById(id);
    if (!department) {
      return errorResponse(res, 404, "Department not found");
    }

    // Check if department has users
    const User = require("../models/User");
    const usersCount = await User.countDocuments({ department: id, isActive: true });
    
    if (usersCount > 0) {
      return errorResponse(res, 400, "Cannot delete department with active users");
    }

    await Department.findByIdAndUpdate(id, { isActive: false });

    return res.status(200).json({
      success: true,
      message: "Department deleted successfully"
    });
  } catch (err) {
    console.error("❌ Delete department error:", err);
    return errorResponse(res, 500, "Failed to delete department");
  }
};