
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

const getRouteAccessKeys = item => {
  const id = String(item?.id || '').trim();
  const rawPath = String(item?.path || '').trim();
  const cleanPath = rawPath.replace(/^\/+/, '');
  const keys = new Set([id, rawPath, cleanPath, getRouteKey(item)].filter(Boolean));

  if (id) {
    keys.add(`/ciisUser/${id}`);
    keys.add(`ciisUser/${id}`);
  }

  if (cleanPath) {
    keys.add(`/ciisUser/${cleanPath}`);
    keys.add(`ciisUser/${cleanPath}`);
  }

  const clientKey = id.startsWith('client-')
    ? id.substring(7)
    : cleanPath.startsWith('client-')
      ? cleanPath.substring(7)
      : cleanPath.startsWith('client/')
        ? cleanPath.substring(7)
        : '';

  if (clientKey) {
    keys.add(clientKey);
    keys.add(`/client/${clientKey}`);
    keys.add(`client/${clientKey}`);
  }

  return keys;
};

const filterMenuItemsByCompanyAccess = async (companyId, menuItems) => {
  const company = await Company.findById(companyId).select('allowedPages');
  const allowedPages = Array.isArray(company?.allowedPages) ? company.allowedPages : [];

  if (allowedPages.length === 0) return menuItems;

  const normalizeKey = value => String(value || '').trim().replace(/^\/+/, '').toLowerCase();
  const allowedSet = new Set(allowedPages.map(page => normalizeKey(page)).filter(Boolean));
  return menuItems.filter(item => {
    const itemKeys = [...getRouteAccessKeys(item)].map(key => normalizeKey(key)).filter(Boolean);
    return itemKeys.some(key => allowedSet.has(key));
  });
};

const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeNameKey = value => String(value || '')
  .trim()
  .replace(/[_-]+/g, ' ')
  .replace(/\s+/g, ' ')
  .toLowerCase();

const resolveDepartmentId = async (companyId, departmentValue) => {
  const rawValue = String(departmentValue || '').trim();
  if (!rawValue) return '';
  if (mongoose.Types.ObjectId.isValid(rawValue)) return rawValue;

  const targetKey = normalizeNameKey(rawValue);
  const departments = await Department.find({
    company: companyId,
    isActive: { $ne: false }
  }).select('_id name').lean();

  const matchedDepartment = departments.find(department => (
    normalizeNameKey(department.name) === targetKey
  ));

  return matchedDepartment ? String(matchedDepartment._id) : rawValue;
};

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
    const targetRoleKey = normalizeNameKey(roleValue);
    const roles = await JobRole.find({
      company: companyId,
      department: departmentId,
      isActive: { $ne: false }
    }).select('_id name').lean();
    jobRole = roles.find(item => normalizeNameKey(item.name) === targetRoleKey) || null;
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
    let { companyId, branchId, departmentId, role } = req.query;
    
    if (companyId && !mongoose.Types.ObjectId.isValid(companyId)) {
      return res.json({ success: true, count: 0, data: [] });
    }
    if (branchId && !mongoose.Types.ObjectId.isValid(branchId)) {
      return res.json({ success: true, count: 0, data: [] });
    }
    if (companyId && departmentId && mongoose.Types.ObjectId.isValid(companyId)) {
      departmentId = await resolveDepartmentId(companyId, departmentId);
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
    let { companyId, branchId, departmentId, role } = req.query;
    
    if (!companyId || !departmentId || !role) {
      return res.status(400).json({
        success: false,
        message: 'Company, department and role are required'
      });
    }

    if (mongoose.Types.ObjectId.isValid(companyId)) {
      departmentId = await resolveDepartmentId(companyId, departmentId);
    }

    // Map old client department / role IDs to the company's local client department/role if needed
    if (departmentId === '69ae555c9a1e47e80a40204c') {
      const localDept = await Department.findOne({
        company: companyId,
        name: { $regex: /^client$/i },
        isActive: true
      });
      if (localDept) {
        departmentId = String(localDept._id);
        const localRole = await JobRole.findOne({
          company: companyId,
          department: localDept._id,
          name: { $regex: /^client$/i },
          isActive: true
        });
        if (localRole) {
          role = String(localRole._id);
        }
      }
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
      menuItems,
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
