const User = require('../../models/User');

// Get all users
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find();
    res.status(200).json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users', message: err.message });
  }
};

// Update user by ID
exports.updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Updating user with ID:', id);
    const updateData = req.body;

    // Find user by ID and update
    const updatedUser = await User.findByIdAndUpdate(
      id,
      updateData,
      { 
        new: true, // Return updated document
        runValidators: true // Run model validations
      }
    );

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json(updatedUser);
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    res.status(500).json({ 
      error: 'Failed to update user', 
      message: err.message 
    });
  }
};

// Delete user by ID
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedUser = await User.findByIdAndDelete(id);

    if (!deletedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({ 
      message: 'User deleted successfully',
      deletedUser: {
        id: deletedUser._id,
        name: deletedUser.name,
        email: deletedUser.email
      }
    });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    res.status(500).json({ 
      error: 'Failed to delete user', 
      message: err.message 
    });
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