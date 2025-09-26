const User = require('../../models/User');

exports.getAllUsers = async (req, res) => {
  try {
    // This will fetch all fields except those with `select: false` (like password, resetToken, etc.)
    const users = await User.find();

    res.status(200).json(users);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users', message: err.message });
  }
};
