const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const Company = require('../models/Company');
const User = require('../models/User');
const { protect, restrictTo } = require('../middleware/authMiddleware');

const superAdminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many super admin login attempts. Please try again later.',
  },
});


router.post('/login', superAdminLoginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    
    
    void 0;
    void 0;
    
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }
    
    
    const user = await User.findOne({ 
      email: email.toLowerCase().trim(),
      department: "Management",
      jobRole: "super_admin"
    }).select('+password'); 
    
    if (!user) {
      void 0;
      return res.status(401).json({
        success: false,
        message: 'Access denied. Super admin privileges required.'
      });
    }
    
    void 0;
    void 0;
    void 0;
    
    
    if (!user.password) {
      void 0;
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }
    
    
    if (!user.isVerified) {
      return res.status(401).json({
        success: false,
        message: 'Account not verified'
      });
    }
    
    
    void 0;
    void 0;
    
    
    const isMatch = await bcrypt.compare(password, user.password);
    
    void 0;
    
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    
    const token = jwt.sign(
      { 
        id: user._id,
        email: user.email,
        role: 'super-admin',
        company: user.company,
        department: user.department,
        jobRole: user.jobRole
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '30d' }
    );
    
    
    user.lastLogin = new Date();
    await user.save();
    
    res.json({
      success: true,
      message: 'Super Admin login successful',
      token,
      data: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: 'super-admin',
        company: user.company,
        companyRole: user.companyRole,
        department: user.department,
        jobRole: user.jobRole,
        employeeId: user.employeeId,
        companyCode: user.companyCode
      }
    });
    
  } catch (error) {
    console.error('Super admin login error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack
    });
    
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

router.use(protect, restrictTo('super_admin'));


router.get('/stats', async (req, res) => {
  try {
    const totalCompanies = await Company.countDocuments();
    const activeCompanies = await Company.countDocuments({ isActive: true });
    const totalUsers = await User.countDocuments();
    
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayLogins = await User.countDocuments({
      lastLogin: { $gte: today }
    });
    
    res.json({
      totalCompanies,
      activeCompanies,
      totalUsers,
      todayLogins
    });
    
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});


router.get('/companies', async (req, res) => {
  try {
    const companies = await Company.find()
      .populate('selectedPlan', 'name price durationDays features allowedPages')
      .sort({ createdAt: -1 });
    
    res.json(companies);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch companies' });
  }
});


router.get('/users', async (req, res) => {
  try {
    const users = await User.find()
      .populate('company', 'companyName')
      .sort({ createdAt: -1 });
    
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});


router.patch('/company/:id/deactivate', async (req, res) => {
  try {
    await Company.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: 'Company deactivated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to deactivate company' });
  }
});


router.patch('/company/:id/activate', async (req, res) => {
  try {
    await Company.findByIdAndUpdate(req.params.id, { isActive: true });
    res.json({ message: 'Company activated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to activate company' });
  }
});


router.delete('/company/:id', async (req, res) => {
  try {
    await Company.findByIdAndDelete(req.params.id);
    res.json({ message: 'Company deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete company' });
  }
});
router.get("/test", (req, res) => {
  void 0;
  res.json({
    success: true,
    user: req.user
  });
});

module.exports = router;
void 0;
