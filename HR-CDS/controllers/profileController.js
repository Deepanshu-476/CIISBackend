const User = require('../../models/User');

exports.getUserProfile = async (req, res) => {
  try {
    const requestedUserId = req.params.id;
    const loggedInUser = req.user;

    // Only allow the user themself or admin to access the profile
    if (requestedUserId !== loggedInUser._id.toString() && loggedInUser.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized access' });
    }

    const user = await User.findById(requestedUserId).select('-password');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json(user);
  } catch (err) {
    console.error('❌ Error fetching user profile:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
