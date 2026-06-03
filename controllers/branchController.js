// controllers/branchController.js
const Branch = require("../models/Branch");
const Company = require("../models/Company");
const User = require("../models/User");
const Department = require("../models/Department");
const mongoose = require("mongoose");

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// 1. Create a New Branch
exports.createBranch = async (req, res) => {
  try {
    const { name, branchCode, companyId, address, phone } = req.body;

    if (!name || !branchCode || !companyId) {
      return res.status(400).json({
        success: false,
        message: "Branch name, branch code, and company ID are required",
      });
    }

    if (!isValidObjectId(companyId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid company ID",
      });
    }

    // Find company to get companyCode
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({
        success: false,
        message: "Company not found",
      });
    }

    const cleanBranchCode = branchCode.trim().toUpperCase();

    // Check for duplicate branch name or code in this company
    const [existingName, existingCode] = await Promise.all([
      Branch.findOne({ company: companyId, name: { $regex: new RegExp(`^${name.trim()}$`, "i") } }),
      Branch.findOne({ company: companyId, branchCode: cleanBranchCode }),
    ]);

    if (existingName) {
      return res.status(409).json({
        success: false,
        message: `Branch with name '${name}' already exists in this company`,
      });
    }

    if (existingCode) {
      return res.status(409).json({
        success: false,
        message: `Branch with code '${cleanBranchCode}' already exists in this company`,
      });
    }

    const branch = await Branch.create({
      name: name.trim(),
      branchCode: cleanBranchCode,
      company: companyId,
      companyCode: company.companyCode,
      address: address?.trim() || "",
      phone: phone?.trim() || "",
      isDefault: false,
    });

    return res.status(201).json({
      success: true,
      message: "Branch created successfully 🎉",
      branch,
    });
  } catch (error) {
    console.error("❌ Create branch error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create branch",
      error: error.message,
    });
  }
};

// 2. Get All Branches of a Company
exports.getAllBranches = async (req, res) => {
  try {
    const { companyId } = req.params;

    if (!isValidObjectId(companyId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid company ID",
      });
    }

    const branches = await Branch.find({ company: companyId }).sort({ isDefault: -1, createdAt: 1 });

    // Fetch user counts per branch
    const branchesWithStats = await Promise.all(
      branches.map(async (branch) => {
        const userCount = await User.countDocuments({ branch: branch._id, isActive: true });
        return {
          ...branch.toObject(),
          totalUsers: userCount,
        };
      })
    );

    return res.status(200).json({
      success: true,
      count: branchesWithStats.length,
      branches: branchesWithStats,
    });
  } catch (error) {
    console.error("❌ Get all branches error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch branches",
      error: error.message,
    });
  }
};

// 3. Get Branch by ID
exports.getBranchById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid branch ID",
      });
    }

    const branch = await Branch.findById(id);
    if (!branch) {
      return res.status(404).json({
        success: false,
        message: "Branch not found",
      });
    }

    const userCount = await User.countDocuments({ branch: branch._id, isActive: true });

    return res.status(200).json({
      success: true,
      branch: {
        ...branch.toObject(),
        totalUsers: userCount,
      },
    });
  } catch (error) {
    console.error("❌ Get branch by ID error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch branch details",
      error: error.message,
    });
  }
};

// 4. Update Branch details
exports.updateBranch = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, branchCode, address, phone, isActive } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid branch ID",
      });
    }

    const branch = await Branch.findById(id);
    if (!branch) {
      return res.status(404).json({
        success: false,
        message: "Branch not found",
      });
    }

    // Safety check for Default Branch
    if (branch.isDefault) {
      if (isActive === false) {
        return res.status(400).json({
          success: false,
          message: "The default branch (Head Office) cannot be deactivated",
        });
      }
      if (branchCode && branchCode.toUpperCase() !== branch.branchCode) {
        return res.status(400).json({
          success: false,
          message: "The branch code of the default branch cannot be modified",
        });
      }
    }

    // Duplicate check for name and code if they are being updated
    const updates = {};
    if (name && name.trim() !== branch.name) {
      const existingName = await Branch.findOne({
        company: branch.company,
        _id: { $ne: id },
        name: { $regex: new RegExp(`^${name.trim()}$`, "i") },
      });
      if (existingName) {
        return res.status(409).json({
          success: false,
          message: `Another branch with name '${name}' already exists in this company`,
        });
      }
      updates.name = name.trim();
    }

    if (branchCode && branchCode.trim().toUpperCase() !== branch.branchCode) {
      const cleanBranchCode = branchCode.trim().toUpperCase();
      const existingCode = await Branch.findOne({
        company: branch.company,
        _id: { $ne: id },
        branchCode: cleanBranchCode,
      });
      if (existingCode) {
        return res.status(409).json({
          success: false,
          message: `Another branch with code '${cleanBranchCode}' already exists in this company`,
        });
      }
      updates.branchCode = cleanBranchCode;
    }

    if (address !== undefined) updates.address = address.trim();
    if (phone !== undefined) updates.phone = phone.trim();
    if (isActive !== undefined) updates.isActive = isActive;

    const updatedBranch = await Branch.findByIdAndUpdate(id, updates, {
      new: true,
      runValidators: true,
    });

    // If branchCode or name updated, dynamically sync with User & Department records (lazy update)
    if (updates.branchCode) {
      await Promise.all([
        User.updateMany({ branch: id }, { branchCode: updates.branchCode }),
        Department.updateMany({ branch: id }, { branchCode: updates.branchCode }),
      ]);
    }

    return res.status(200).json({
      success: true,
      message: "Branch updated successfully",
      branch: updatedBranch,
    });
  } catch (error) {
    console.error("❌ Update branch error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update branch",
      error: error.message,
    });
  }
};

// 5. Delete Branch
exports.deleteBranch = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid branch ID",
      });
    }

    const branch = await Branch.findById(id);
    if (!branch) {
      return res.status(404).json({
        success: false,
        message: "Branch not found",
      });
    }

    // Safety checks
    if (branch.isDefault) {
      return res.status(400).json({
        success: false,
        message: "The default branch (Head Office) cannot be deleted",
      });
    }

    // Check if there are active users assigned to this branch
    const usersCount = await User.countDocuments({ branch: id, isActive: true });
    if (usersCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete branch '${branch.name}'. There are ${usersCount} active users assigned to it.`,
      });
    }

    // Check if there are active departments assigned to this branch
    const deptsCount = await Department.countDocuments({ branch: id, isActive: true });
    if (deptsCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete branch '${branch.name}'. There are ${deptsCount} active departments assigned to it.`,
      });
    }

    await Branch.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: "Branch deleted successfully",
    });
  } catch (error) {
    console.error("❌ Delete branch error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete branch",
      error: error.message,
    });
  }
};
