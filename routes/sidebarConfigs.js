
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

const removeLegacyDashboardItems = menuItems => (Array.isArray(menuItems) ? menuItems.filter(item => {
  const values = [item?.id, item?.path, item?.name].map(value => String(value || '').trim().toLowerCase());
  return !values.includes('dashboard-2') && !values.includes('dashboard 2');
}) : []);

const sanitizeConfig = config => {
  if (!config) return config;
  config.menuItems = removeLegacyDashboardItems(config.menuItems);
  return config;
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
  const company = await Company.findById(companyId).select('allowedPages isActive subscriptionExpiry');
  const isPlanActive = company && company.isActive && company.subscriptionExpiry && new Date() <= new Date(company.subscriptionExpiry);
  const allowedPages = isPlanActive && Array.isArray(company?.allowedPages) ? company.allowedPages : [];

  if (!isPlanActive) return [];
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
  let resolvedDepartmentId = null;

  if (mongoose.Types.ObjectId.isValid(roleValue)) {
    const jobRole = await JobRole.findOne({
      _id: roleValue,
      company: companyId
    }).select('_id name department');

    if (jobRole) {
      aliases.add(String(jobRole._id));
      aliases.add(jobRole.name);
      if (jobRole.department) {
        resolvedDepartmentId = String(jobRole.department);
      }
    }
  }

  const targetRoleKey = normalizeNameKey(roleValue);
  const roles = await JobRole.find({
    company: companyId,
    isActive: { $ne: false }
  }).select('_id name department').lean();

  const matchingRoles = roles.filter(item => normalizeNameKey(item.name) === targetRoleKey);
  matchingRoles.forEach(item => {
    aliases.add(String(item._id));
    aliases.add(item.name);
    if (!resolvedDepartmentId && item.department) {
      resolvedDepartmentId = String(item.department);
    }
  });

  return {
    query: {
      $in: [...aliases].map(value => new RegExp(`^${escapeRegex(value)}$`, 'i'))
    },
    resolvedDepartmentId
  };
};

const findSidebarConfig = async ({ companyId, branchId, departmentId, role }) => {
  const { query: roleQuery, resolvedDepartmentId } = await buildRoleQuery(companyId, departmentId, role);
  const activeDeptId = departmentId || resolvedDepartmentId;
  
  const baseQuery = { companyId, role: roleQuery, isActive: { $ne: false } };
  if (activeDeptId && mongoose.Types.ObjectId.isValid(activeDeptId)) {
    baseQuery.departmentId = activeDeptId;
  }

  if (branchId && mongoose.Types.ObjectId.isValid(branchId)) {
    const branchConfig = await SidebarConfig.findOne({ ...baseQuery, branchId }).sort({ updatedAt: -1 });
    if (branchConfig) return branchConfig;

    const globalConfig = await SidebarConfig.findOne({
      ...baseQuery,
      $or: [{ branchId: null }, { branchId: { $exists: false } }]
    }).sort({ updatedAt: -1 });
    if (globalConfig) return globalConfig;

    const anyBranchConfig = await SidebarConfig.findOne(baseQuery).sort({ updatedAt: -1 });
    if (anyBranchConfig) return anyBranchConfig;
  } else {
    const globalConfig = await SidebarConfig.findOne({
      ...baseQuery,
      $or: [{ branchId: null }, { branchId: { $exists: false } }]
    }).sort({ updatedAt: -1 });
    if (globalConfig) return globalConfig;

    const anyConfig = await SidebarConfig.findOne(baseQuery).sort({ updatedAt: -1 });
    if (anyConfig) return anyConfig;
  }

  if (baseQuery.departmentId) {
    const roleOnlyQuery = { companyId, role: roleQuery, isActive: { $ne: false } };
    if (branchId && mongoose.Types.ObjectId.isValid(branchId)) {
      const branchRoleConfig = await SidebarConfig.findOne({ ...roleOnlyQuery, branchId }).sort({ updatedAt: -1 });
      if (branchRoleConfig) return branchRoleConfig;
    }
    const anyRoleConfig = await SidebarConfig.findOne(roleOnlyQuery).sort({ updatedAt: -1 });
    if (anyRoleConfig) return anyRoleConfig;
  }

  return null;
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
      data: configs.map(sanitizeConfig)
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
    
    if (!companyId || !role) {
      return res.status(400).json({
        success: false,
        message: 'Company and role are required'
      });
    }

    if (companyId && mongoose.Types.ObjectId.isValid(companyId) && departmentId) {
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

    if (!mongoose.Types.ObjectId.isValid(companyId)) {
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

    sanitizeConfig(config);
    
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
  const { companyId, branchId, departmentId, role, menuItems, ranges } = req.body;
  try {
    void 0;
    
    
    if (!companyId || !departmentId || !role || !Array.isArray(menuItems)) {
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
    
    const cleanedItems = removeLegacyDashboardItems(menuItems);
    const cleanedRanges = Array.isArray(ranges) ? ranges : [];

    const configKey = {
      companyId,
      branchId: branchId || null,
      departmentId,
      role
    };
    const configValues = {
      menuItems: cleanedItems,
      ranges: cleanedRanges,
      updatedAt: new Date()
    };

    // Save is intentionally idempotent: a stale UI lookup must not turn a
    // normal update into a duplicate-key failure.
    const savedConfig = await SidebarConfig.findOneAndUpdate(
      configKey,
      { $set: configValues, $setOnInsert: configKey },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    // Synchronize all other configs for this role in this company
    // so every user assigned this role receives the changes!
    try {
      const { query: roleQuery } = await buildRoleQuery(companyId, departmentId, role);
      await SidebarConfig.updateMany(
        {
          companyId,
          role: roleQuery,
          _id: { $ne: savedConfig._id }
        },
        {
          $set: {
            menuItems: cleanedItems,
            ranges: cleanedRanges,
            updatedAt: new Date()
          }
        }
      );
    } catch (syncErr) {
      console.warn('Warning: sync cross-branch error in POST:', syncErr.message);
    }

    const populatedConfig = await SidebarConfig.findById(savedConfig._id)
      .populate('companyId', 'companyName companyCode')
      .populate('departmentId', 'name');
    
    res.status(200).json({
      success: true,
      message: 'Configuration saved successfully',
      data: populatedConfig
    });
  } catch (error) {
    console.error('Error creating config:', error);
    
    
    if (error.code === 11000) {
      const duplicateQuery = { companyId, departmentId, role, branchId: branchId || null };
      const duplicateConfig = await SidebarConfig.findOne(duplicateQuery).lean();
      return res.status(409).json({
        success: false,
        message: 'Configuration already exists for this combination',
        data: duplicateConfig
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
    const { menuItems, ranges, role, departmentId, branchId } = req.body;
    
    if (!menuItems || !Array.isArray(menuItems)) {
      return res.status(400).json({
        success: false,
        message: 'Valid menuItems array is required'
      });
    }
    
    const existingConfig = await SidebarConfig.findById(id);

    if (!existingConfig) {
      return res.status(404).json({
        success: false,
        message: 'Configuration not found'
      });
    }

    const cleanedItems = removeLegacyDashboardItems(menuItems);
    const cleanedRanges = Array.isArray(ranges) ? ranges : [];

    const updatedConfig = await SidebarConfig.findByIdAndUpdate(
      id,
      {
        menuItems: cleanedItems,
        ranges: cleanedRanges,
        updatedAt: new Date()
      },
      { 
        new: true,
        runValidators: true 
      }
    ).populate('companyId', 'companyName')
     .populate('departmentId', 'name');

    // Also synchronize this role's other configs across the company
    try {
      const targetCompanyId = existingConfig.companyId?._id || existingConfig.companyId;
      const targetRole = role || existingConfig.role;
      const targetDept = departmentId || existingConfig.departmentId?._id || existingConfig.departmentId;

      if (targetCompanyId && targetRole) {
        const { query: roleQuery } = await buildRoleQuery(targetCompanyId, targetDept, targetRole);

        await SidebarConfig.updateMany(
          {
            companyId: targetCompanyId,
            role: roleQuery,
            _id: { $ne: id }
          },
          {
            $set: {
              menuItems: cleanedItems,
              ranges: cleanedRanges,
              updatedAt: new Date()
            }
          }
        );
      }
    } catch (syncError) {
      console.warn('Warning: Could not sync cross-branch configs:', syncError.message);
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

    sanitizeConfig(config);
    
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
