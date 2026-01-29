const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Company = require('../models/Company');
const User = require('../models/User');

// Super Admin Login
// routes/superAdmin.js
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Debug log
    console.log('Login attempt for:', email);
    console.log('Password received:', password ? 'Yes' : 'No');
    
    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }
    
    // Find user with Management department AND super_admin jobRole
    const user = await User.findOne({ 
      email: email.toLowerCase().trim(),
      department: "Management",
      jobRole: "super_admin"
    }).select('+password'); // Important: explicitly select password field
    
    if (!user) {
      console.log('User not found or not authorized:', email);
      return res.status(401).json({
        success: false,
        message: 'Access denied. Super admin privileges required.'
      });
    }
    
    console.log('User found:', user.name, user.department, user.jobRole);
    console.log('User has password field:', user.password ? 'Yes' : 'No');
    console.log('Password type:', typeof user.password);
    
    // Check if user has password
    if (!user.password) {
      console.log('User password is missing in database');
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }
    
    // Check if user is verified
    if (!user.isVerified) {
      return res.status(401).json({
        success: false,
        message: 'Account not verified'
      });
    }
    
    // Debug: Log the hash and password
    console.log('Password hash (first 20 chars):', user.password.substring(0, 20));
    console.log('Password to compare:', password);
    
    // Compare password using bcrypt
    const isMatch = await bcrypt.compare(password, user.password);
    
    console.log('Password match:', isMatch);
    
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Create JWT token
    const token = jwt.sign(
      { 
        id: user._id,
        email: user.email,
        role: 'super-admin',
        company: user.company,
        department: user.department,
        jobRole: user.jobRole
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );
    
    // Update last login time
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
        employeeId: user.employeeId
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

// Get Dashboard Stats
router.get('/stats', async (req, res) => {
  try {
    const totalCompanies = await Company.countDocuments();
    const activeCompanies = await Company.countDocuments({ isActive: true });
    const totalUsers = await User.countDocuments();
    
    // Get today's logins (you need to track login timestamps in User model)
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

// Get all companies
router.get('/companies', async (req, res) => {
  try {
    const companies = await Company.find()
      .sort({ createdAt: -1 });
    
    res.json(companies);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch companies' });
  }
});

// Get all users
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

// Deactivate company
router.patch('/company/:id/deactivate', async (req, res) => {
  try {
    await Company.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: 'Company deactivated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to deactivate company' });
  }
});

// Activate company
router.patch('/company/:id/activate', async (req, res) => {
  try {
    await Company.findByIdAndUpdate(req.params.id, { isActive: true });
    res.json({ message: 'Company activated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to activate company' });
  }
});

// Delete company
router.delete('/company/:id', async (req, res) => {
  try {
    await Company.findByIdAndDelete(req.params.id);
    res.json({ message: 'Company deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete company' });
  }
});

module.exports = router;