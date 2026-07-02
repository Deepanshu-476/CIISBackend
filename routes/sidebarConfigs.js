
const express = require('express');
const router = express.Router();
const SidebarConfig = require('../models/SidebarConfig');
const Company = require('../models/Company');
const Department = require('../models/Department');
const Branch = require('../models/Branch');
const JobRole = require('../models/JobRole');
const mongoose = require('mongoose');

const getRouteKey = item => {
  const rawPath = String(item?.path || item?.id || '');
  return rawPath.split('/').filter(Boolean).pop();
};

const filterMenuItemsByCompanyAccess = async (companyId, menuItems) => {
  const company = await Company.findById(companyId).select('allowedPages');
  const allowedPages = Array.isArray(company?.allowedPages) ? company.allowedPages : [];

  if (allowedPages.length === 0) return menuItems;

  const allowedSet = new Set(allowedPages.map(page => String(page).trim()).filter(Boolean));
  return menuItems.filter(item => (
    allowedSet.has(item.id) ||
    allowedSet.has(item.path) ||
    allowedSet.has(getRouteKey(item))
  ));
};

const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildRoleQuery = async (companyId, departmentId, role) => {
  const roleValue = String(role || '').trim();
  const aliases = new Set([roleValue]);
  let jobRole = null;

  if (mongoose.Types.ObjectId.isValid(roleValue)) {
    jobRole = await JobRole.findOne({
      _id: roleValue,
      company: companyId,
      department: departmentId
    }).select('_id name');
  } else {
    jobRole = await JobRole.findOne({
      company: companyId,
      department: departmentId,
      name: { $regex: `^${escapeRegex(roleValue)}$`, $options: 'i' }
    }).select('_id name');
  }

  if (jobRole) {
    aliases.add(String(jobRole._id));
    aliases.add(jobRole.name);
  }

  return {
    $in: [...aliases].map(value => new RegExp(`^${escapeRegex(value)}$`, 'i'))
  };
};

const findSidebarConfig = async ({ companyId, branchId, departmentId, role }) => {
  const roleQuery = await buildRoleQuery(companyId, departmentId, role);
  const baseQuery = { companyId, departmentId, role: roleQuery, isActive: { $ne: false } };

  if (branchId) {
    const branchConfig = await SidebarConfig.findOne({ ...baseQuery, branchId });
    if (branchConfig) return branchConfig;

    // Older/global assignments did not store a branch.
    return SidebarConfig.findOne({
      ...baseQuery,
      $or: [{ branchId: null }, { branchId: { $exists: false } }]
    });
  }

  return SidebarConfig.findOne(baseQuery).sort({ branchId: 1, updatedAt: -1 });
};


router.get('/', async (req, res) => {
  try {
    const { companyId, branchId, departmentId, role } = req.query;
    
    if (companyId && !mongoose.Types.ObjectId.isValid(companyId)) {
      return res.json({ success: true, count: 0, data: [] });
    }
    if (branchId && !mongoose.Types.ObjectId.isValid(branchId)) {
      return res.json({ success: true, count: 0, data: [] });
    }
    if (departmentId && !mongoose.Types.ObjectId.isValid(departmentId)) {
      return res.json({ success: true, count: 0, data: [] });
    }
    
    let query = {};
    if (companyId) query.companyId = companyId;
    if (branchId) query.branchId = branchId;
    if (departmentId) query.departmentId = departmentId;
    if (role) query.role = role;
    
    const configs = await SidebarConfig.find(query)
      .populate('companyId', 'companyName companyCode')
      .populate('branchId', 'name branchCode')
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


router.get('/config', async (req, res) => {
  try {
    const { companyId, branchId, departmentId, role } = req.query;
    
    if (!companyId || !departmentId || !role) {
      return res.status(400).json({
        success: false,
        message: 'Company, department and role are required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(companyId) || 
        !mongoose.Types.ObjectId.isValid(departmentId) || 
        (branchId && !mongoose.Types.ObjectId.isValid(branchId))) {
      return res.json({
        success: true,
        message: 'No configuration found',
        data: null
      });
    }
    
    const config = await findSidebarConfig({ companyId, branchId, departmentId, role });

    if (config) {
      await config.populate('companyId', 'companyName');
      await config.populate('branchId', 'name branchCode');
      await config.populate('departmentId', 'name');
    }
    
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


router.post('/', async (req, res) => {
  try {
    const { companyId, branchId, departmentId, role, menuItems } = req.body;
    
    void 0;
    
    
    if (!companyId || !departmentId || !role || !menuItems) {
      return res.status(400).json({
        success: false,
        message: 'Company, department, role and menuItems are required'
      });
    }
    
    
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
    
    const allowedMenuItems = await filterMenuItemsByCompanyAccess(companyId, menuItems);

    if (allowedMenuItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Selected menu items are not allowed for this company'
      });
    }

    
    const query = { companyId, departmentId, role };
    if (branchId) query.branchId = branchId;

    const existingConfig = await SidebarConfig.findOne(query);
    
    if (existingConfig) {
      return res.status(409).json({ 
        success: false,
        message: 'Configuration already exists for this combination',
        data: existingConfig
      });
    }
    
    
    const newConfig = new SidebarConfig({
      companyId,
      branchId: branchId || null,
      departmentId,
      role,
      menuItems: allowedMenuItems,
    });
    
    const savedConfig = await newConfig.save();
    
    
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
    
    
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Configuration already exists for this combination'
      });
    }
    
    
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
    
    const existingConfig = await SidebarConfig.findById(id).select('companyId');

    if (!existingConfig) {
      return res.status(404).json({
        success: false,
        message: 'Configuration not found'
      });
    }

    const allowedMenuItems = await filterMenuItemsByCompanyAccess(existingConfig.companyId, menuItems);

    if (allowedMenuItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Selected menu items are not allowed for this company'
      });
    }

    const updatedConfig = await SidebarConfig.findByIdAndUpdate(
      id,
      {
        menuItems: allowedMenuItems,
        updatedAt: Date.now()
      },
      { 
        new: true,
        runValidators: true 
      }
    ).populate('companyId', 'companyName')
     .populate('departmentId', 'name');
    
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


router.get('/user-config', async (req, res) => {
  try {
    const { companyId, branchId, departmentId, role } = req.query;
    
    if (!companyId || !departmentId || !role) {
      return res.status(400).json({
        success: false,
        message: 'Company, department and role are required'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(companyId) || 
        !mongoose.Types.ObjectId.isValid(departmentId) || 
        (branchId && !mongoose.Types.ObjectId.isValid(branchId))) {
      return res.json({
        success: true,
        message: 'No custom configuration found',
        data: null
      });
    }
    
    const config = await findSidebarConfig({ companyId, branchId, departmentId, role });
    
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
router.get("/test", (req, res) => {
  void 0;
  res.json({
    success: true,
    user: req.user
  });
});
module.exports = router;
void 0;
