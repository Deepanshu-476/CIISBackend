// routes/sidebar.js
const express = require('express');
const router = express.Router();
const SidebarConfig = require('../models/SidebarConfig');
const mongoose = require('mongoose');

// ✅ GET all sidebar configs
router.get('/', async (req, res) => {
  try {
    const { companyId, departmentId, role } = req.query;
    
    let query = {};
    if (companyId) query.companyId = companyId;
    if (departmentId) query.departmentId = departmentId;
    if (role) query.role = role;
    
    const configs = await SidebarConfig.find(query)
      .populate('companyId', 'companyName companyCode')
      .populate('departmentId', 'name')
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      count: configs.length,
      data: configs
    });
  } catch (error) {
    console.error('Error fetching sidebar configs:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// ✅ GET config for specific combination
router.get('/config', async (req, res) => {
  try {
    const { companyId, departmentId, role } = req.query;
    
    if (!companyId || !departmentId || !role) {
      return res.status(400).json({
        success: false,
        message: 'Company, department and role are required'
      });
    }
    
    const config = await SidebarConfig.findOne({
      companyId,
      departmentId,
      role
    })
    .populate('companyId', 'companyName')
    .populate('departmentId', 'name');
    
    if (!config) {
      return res.json({
        success: true,
        message: 'No configuration found',
        data: null
      });
    }
    
    res.json({
      success: true,
      message: 'Configuration found',
      data: config
    });
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// ✅ CREATE new sidebar config
router.post('/', async (req, res) => {
  try {
    const { companyId, departmentId, role, menuItems } = req.body;
    
    console.log('Creating config:', { companyId, departmentId, role, menuItemsCount: menuItems?.length });
    
    // Validate required fields
    if (!companyId || !departmentId || !role || !menuItems) {
      return res.status(400).json({
        success: false,
        message: 'Company, department, role and menuItems are required'
      });
    }
    
    // Validate ObjectIds
    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid company ID'
      });
    }
    
    if (!mongoose.Types.ObjectId.isValid(departmentId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid department ID'
      });
    }
    
    // Check if config already exists
    const existingConfig = await SidebarConfig.findOne({
      companyId,
      departmentId,
      role
    });
    
    if (existingConfig) {
      return res.status(409).json({ 
        success: false,
        message: 'Configuration already exists for this combination',
        data: existingConfig
      });
    }
    
    // Create new config
    const newConfig = new SidebarConfig({
      companyId,
      departmentId,
      role,
      menuItems,
      // createdBy और updatedBy को null रहने दें
    });
    
    const savedConfig = await newConfig.save();
    
    // Populate references
    const populatedConfig = await SidebarConfig.findById(savedConfig._id)
      .populate('companyId', 'companyName companyCode')
      .populate('departmentId', 'name');
    
    res.status(201).json({
      success: true,
      message: 'Configuration created successfully',
      data: populatedConfig
    });
  } catch (error) {
    console.error('Error creating config:', error);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Configuration already exists for this combination'
      });
    }
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: messages
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// ✅ UPDATE existing config
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { menuItems } = req.body;
    
    if (!menuItems || !Array.isArray(menuItems)) {
      return res.status(400).json({
        success: false,
        message: 'Valid menuItems array is required'
      });
    }
    
    const updatedConfig = await SidebarConfig.findByIdAndUpdate(
      id,
      {
        menuItems,
        updatedAt: Date.now()
      },
      { 
        new: true,
        runValidators: true 
      }
    ).populate('companyId', 'companyName')
     .populate('departmentId', 'name');
    
    if (!updatedConfig) {
      return res.status(404).json({
        success: false,
        message: 'Configuration not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Configuration updated successfully',
      data: updatedConfig
    });
  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// ✅ DELETE config
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const deletedConfig = await SidebarConfig.findByIdAndDelete(id);
    
    if (!deletedConfig) {
      return res.status(404).json({
        success: false,
        message: 'Configuration not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Configuration deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting config:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

// ✅ Get user's sidebar config
router.get('/user-config', async (req, res) => {
  try {
    const { companyId, departmentId, role } = req.query;
    
    if (!companyId || !departmentId || !role) {
      return res.status(400).json({
        success: false,
        message: 'Company, department and role are required'
      });
    }
    
    const config = await SidebarConfig.findOne({
      companyId,
      departmentId,
      role
    });
    
    if (!config) {
      return res.json({
        success: true,
        message: 'No custom configuration found',
        data: null
      });
    }
    
    res.json({
      success: true,
      message: 'Configuration found',
      data: config
    });
  } catch (error) {
    console.error('Error fetching user config:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error', 
      error: error.message 
    });
  }
});

module.exports = router;