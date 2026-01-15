const User = require('../../models/User');

// Get all users
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({ isActive: true })
      .select('-password -resetToken -resetTokenExpiry')
      .populate('department', 'name description')
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: users.length,
      users
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
      .populate('createdBy', 'name email');

    if (!user) {
      return errorResponse(res, 404, "User not found");
    }

    return res.status(200).json({
      success: true,
      user
    });
  } catch (err) {
    console.error("❌ Get user error:", err);
    return errorResponse(res, 500, "Failed to fetch user");
  }
};
// Update user by ID
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;
    const requestingUser = req.user;

    // Find user
    const user = await User.findById(id);
    if (!user) {
      return errorResponse(res, 404, "User not found");
    }

    // Check if requesting user is admin
    const isAdmin = requestingUser?.jobRole === 'admin' || 
                    requestingUser?.jobRole === 'SuperAdmin';

    // If trying to update jobRole or department, check admin permission
    if ((updateData.jobRole || updateData.department) && !isAdmin) {
      return errorResponse(res, 403, "Only admin can update job role or department");
    }

    // If updating department, validate it exists
    if (updateData.department) {
      const departmentExists = await Department.findById(updateData.department);
      if (!departmentExists) {
        return errorResponse(res, 404, "Department not found");
      }
    }

    // Prevent email update
    if (updateData.email) {
      delete updateData.email;
    }

    // Update user
    const updatedUser = await User.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('-password -resetToken -resetTokenExpiry');

    return res.status(200).json({
      success: true,
      message: "User updated successfully",
      user: updatedUser
    });
  } catch (err) {
    console.error("❌ Update user error:", err);
    return errorResponse(res, 500, "Failed to update user");
  }
};

// Delete user by ID
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const user = await User.findById(id);
    if (!user) {
      return errorResponse(res, 404, "User not found");
    }

    // Soft delete (deactivate)
    await User.findByIdAndUpdate(id, { 
      isActive: false,
      email: `${user.email}_deleted_${Date.now()}`
    });

    return res.status(200).json({
      success: true,
      message: "User deleted successfully"
    });
  } catch (err) {
    console.error("❌ Delete user error:", err);
    return errorResponse(res, 500, "Failed to delete user");
  }
};

// Alternative: Soft delete (if you prefer to keep user data)
exports.softDeleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { 
        isActive: false,
        deletedAt: new Date()
      },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({ 
      message: 'User deactivated successfully',
      user: updatedUser
    });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    res.status(500).json({ 
      error: 'Failed to deactivate user', 
      message: err.message 
    });
  }
};