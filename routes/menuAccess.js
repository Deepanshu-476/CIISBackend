const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const MenuAccess = require('../models/MenuAccess');
const Department = require('../models/Department');
const { protect, isSuperAdminUser } = require('../middleware/authMiddleware');

router.use(protect);

const isCompanyOwnerOrSuperAdmin = (user) => {
  if (!user) return false;
  if (isSuperAdminUser(user)) return true;
  const role = String(user.companyRole || user.role || '').trim().toLowerCase();
  return role === 'owner' || role === 'company_owner' || role === 'companyowner';
};

const requireOwnerOrSuperAdmin = (req, res, next) => {
  if (!isCompanyOwnerOrSuperAdmin(req.user)) {
    return res.status(403).json({
      success: false,
      error: 'Access denied. Company Owner or SuperAdmin privileges required.'
    });
  }
  next();
};

const getUserCompanyId = (user) => {
  if (!user) return '';
  return String(user.company?._id || user.company || user.companyId || '');
};

const verifyDepartmentCompany = async (deptId, user) => {
  if (isSuperAdminUser(user)) return { ok: true };
  if (!mongoose.Types.ObjectId.isValid(deptId)) {
    return { ok: false, status: 400, message: 'Invalid department ID' };
  }
  const userCompanyId = getUserCompanyId(user);
  if (!userCompanyId) {
    return { ok: false, status: 400, message: 'User company not found' };
  }

  const dept = await Department.findById(deptId).select('company companyCode');
  if (!dept) {
    return { ok: false, status: 404, message: 'Department not found' };
  }

  const deptCompanyId = String(dept.company?._id || dept.company || '');
  if (deptCompanyId !== userCompanyId && dept.companyCode !== user.companyCode) {
    return { ok: false, status: 403, message: 'Access denied. Department belongs to another company.' };
  }

  return { ok: true, department: dept };
};

router.get('/', async (req, res) => {
  try {
    const { department, jobRole } = req.query;
    
    if (!department || !jobRole) {
      return res.status(400).json({ error: 'Department and job role are required' });
    }

    const deptCheck = await verifyDepartmentCompany(department, req.user);
    if (!deptCheck.ok) {
      return res.status(deptCheck.status).json({ error: deptCheck.message });
    }
    
    const access = await MenuAccess.findOne({ department, jobRole });
    
    if (access) {
      res.json(access);
    } else {
      res.json({
        department,
        jobRole,
        accessItems: getDefaultAccess(jobRole),
        isDefault: true
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', requireOwnerOrSuperAdmin, async (req, res) => {
  try {
    const { department, jobRole, accessItems } = req.body;
    
    if (!department || !jobRole || !accessItems || !Array.isArray(accessItems)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const deptCheck = await verifyDepartmentCompany(department, req.user);
    if (!deptCheck.ok) {
      return res.status(deptCheck.status).json({ error: deptCheck.message });
    }
    
    let menuAccess = await MenuAccess.findOne({ department, jobRole });
    
    if (menuAccess) {
      menuAccess.accessItems = accessItems;
      menuAccess.updatedBy = req.user._id;
      menuAccess.updatedAt = new Date();
    } else {
      menuAccess = new MenuAccess({
        department,
        jobRole,
        accessItems,
        createdBy: req.user._id,
        updatedBy: req.user._id
      });
    }
    
    await menuAccess.save();
    res.json(menuAccess);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', requireOwnerOrSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { accessItems } = req.body;
    
    if (!accessItems || !Array.isArray(accessItems)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid configuration ID' });
    }

    const existing = await MenuAccess.findById(id).populate('department', 'company companyCode');
    if (!existing) {
      return res.status(404).json({ error: 'Configuration not found' });
    }

    if (existing.department) {
      const deptCheck = await verifyDepartmentCompany(existing.department._id || existing.department, req.user);
      if (!deptCheck.ok) {
        return res.status(deptCheck.status).json({ error: deptCheck.message });
      }
    }
    
    const menuAccess = await MenuAccess.findByIdAndUpdate(
      id,
      { 
        accessItems, 
        updatedBy: req.user._id, 
        updatedAt: new Date() 
      },
      { new: true }
    );
    
    res.json(menuAccess);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', requireOwnerOrSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid configuration ID' });
    }

    const existing = await MenuAccess.findById(id).populate('department', 'company companyCode');
    if (!existing) {
      return res.status(404).json({ error: 'Configuration not found' });
    }

    if (existing.department) {
      const deptCheck = await verifyDepartmentCompany(existing.department._id || existing.department, req.user);
      if (!deptCheck.ok) {
        return res.status(deptCheck.status).json({ error: deptCheck.message });
      }
    }

    await MenuAccess.findByIdAndDelete(id);
    
    res.json({ message: 'Configuration deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/all', async (req, res) => {
  try {
    let query = {};
    if (!isSuperAdminUser(req.user)) {
      const userCompanyId = getUserCompanyId(req.user);
      if (userCompanyId) {
        const companyDepartments = await Department.find({
          $or: [
            { company: userCompanyId },
            { companyCode: req.user.companyCode }
          ]
        }).select('_id');
        const deptIds = companyDepartments.map(d => d._id);
        query.department = { $in: deptIds };
      }
    }

    const accesses = await MenuAccess.find(query).sort({ updatedAt: -1 });
    res.json(accesses);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function getDefaultAccess(jobRole) {
  const defaults = {
    user: ['dashboard', 'attendance', 'my-leaves', 'my-assets', 'create-task', 'employee-project', 'alerts', 'create-alert', 'employee-meeting'],
  };
  return defaults[jobRole?.toLowerCase()] || defaults.user;
}

module.exports = router;


