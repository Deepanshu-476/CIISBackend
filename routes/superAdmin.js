const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const Company = require('../models/Company');
const User = require('../models/User');
const Department = require('../models/Department');
const JobRole = require('../models/JobRole');
const { protect, restrictTo, isPlatformOwner, requirePlatformOwner } = require('../middleware/authMiddleware');
const { getPaginationOptions } = require('../utils/pagination');

const setPaginationHeaders = (res, { total, page, limit }) => {
  res.set('X-Total-Count', String(total));
  res.set('X-Page', String(page));
  res.set('X-Limit', String(limit));
};

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

// Every company owner is created with jobRole "super_admin", so restrictTo('super_admin') alone lets
// any company owner reach these platform routes. Only the platform owner (isPlatformOwner) gets
// cross-company access; everyone else is scoped to their own company.
const ownCompanyId = user => {
  const value = user?.company?._id || user?.company || user?.companyId;
  return value ? String(value) : '';
};


router.get('/stats', async (req, res) => {
  try {
    const platform = isPlatformOwner(req.user);
    const companyId = ownCompanyId(req.user);
    if (!platform && !companyId) return res.status(403).json({ error: 'Company scope required' });
    const companyFilter = platform ? {} : { _id: companyId };
    const userFilter = platform ? {} : { company: companyId };
    const totalCompanies = await Company.countDocuments(companyFilter);
    const activeCompanies = await Company.countDocuments({ ...companyFilter, isActive: true });
    const totalUsers = await User.countDocuments(userFilter);
    
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayLogins = await User.countDocuments({
      ...userFilter,
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
    const { page, limit, skip } = getPaginationOptions(req.query || {}, { limit: 50, maxLimit: 100 });
    const platform = isPlatformOwner(req.user);
    const companyId = ownCompanyId(req.user);
    if (!platform && !companyId) return res.status(403).json({ error: 'Company scope required' });
    const filter = platform ? {} : { _id: companyId };
    const [companies, total] = await Promise.all([
      Company.find(filter)
        .populate('selectedPlan', 'name price durationDays features allowedPages')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Company.countDocuments(filter)
    ]);
    setPaginationHeaders(res, { total, page, limit });

    // Per-company user counts (the page used to count a /users list that is capped at 50 rows).
    const counts = await User.aggregate([
      { $match: { company: { $in: companies.map(company => company._id) } } },
      { $group: { _id: '$company', n: { $sum: 1 } } }
    ]);
    const countByCompany = new Map(counts.map(row => [String(row._id), row.n]));
    res.json(companies.map(company => ({ ...company, userCount: countByCompany.get(String(company._id)) || 0 })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch companies' });
  }
});


router.get('/users', async (req, res) => {
  try {
    const { page, limit, skip } = getPaginationOptions(req.query || {}, { limit: 50, maxLimit: 100 });
    const platform = isPlatformOwner(req.user);
    const companyId = ownCompanyId(req.user);
    if (!platform && !companyId) return res.status(403).json({ error: 'Company scope required' });
    const filter = platform ? {} : { company: companyId };
    const [users, total] = await Promise.all([
      User.find(filter)
        .populate('company', 'companyName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter)
    ]);
    setPaginationHeaders(res, { total, page, limit });
    
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});


// One company's users, paged on the server for All Company > Users (web and app). The old screens
// pulled /users (capped at 50 rows across every company) and filtered in the browser.
// Platform owner: any company. Company owner: only their own company.
const COMPANY_USER_FIELDS = 'name email phone employeeId profileImage department departmentName jobRole jobRoleName companyRole isActive createdAt lastLogin company';
const ADMIN_ROLE = /^(owner|admin|super[ _-]?admin|company[ _-]?(owner|admin))$/i;
const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.get('/company/:id/users', async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid company id' });
    if (!isPlatformOwner(req.user) && ownCompanyId(req.user) !== id) return res.status(403).json({ error: 'Not allowed for this company' });
    const companyObjectId = new mongoose.Types.ObjectId(id);
    const { page, limit, skip } = getPaginationOptions(req.query || {}, { limit: 20, maxLimit: 100 });

    const [departments, jobRoles] = await Promise.all([
      Department.find({ company: companyObjectId }).select('name').lean(),
      JobRole.find({ company: companyObjectId }).select('name').lean(),
    ]);
    const departmentNames = new Map(departments.map(d => [String(d._id), d.name]));
    const jobRoleNames = new Map(jobRoles.map(r => [String(r._id), r.name]));

    const base = { company: companyObjectId };
    const filter = { ...base };
    if (req.query.status === 'active') filter.isActive = { $ne: false };
    if (req.query.status === 'inactive') filter.isActive = false;
    const term = String(req.query.search || '').trim();
    if (term) {
      const pattern = new RegExp(escapeRegex(term), 'i');
      const deptIds = departments.filter(d => pattern.test(d.name || '')).map(d => String(d._id));
      const roleIds = jobRoles.filter(r => pattern.test(r.name || '')).map(r => String(r._id));
      filter.$or = [
        { name: pattern }, { email: pattern }, { phone: pattern }, { employeeId: pattern },
        { departmentName: pattern }, { jobRoleName: pattern }, { jobRole: pattern }, { companyRole: pattern },
        ...(deptIds.length ? [{ department: { $in: deptIds } }] : []),
        ...(roleIds.length ? [{ jobRole: { $in: roleIds } }] : []),
      ];
    }
    const adminFilter = { ...base, $or: [{ jobRole: ADMIN_ROLE }, { jobRoleName: ADMIN_ROLE }, { companyRole: ADMIN_ROLE }] };

    const [users, total, all, active, admins] = await Promise.all([
      User.find(filter).select(COMPANY_USER_FIELDS).sort({ name: 1, _id: 1 }).collation({ locale: 'en' }).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
      User.countDocuments(base),
      User.countDocuments({ ...base, isActive: { $ne: false } }),
      User.countDocuments(adminFilter),
    ]);
    const items = users.map(u => ({
      ...u,
      departmentName: departmentNames.get(String(u.department)) || u.departmentName || '',
      jobRoleName: jobRoleNames.get(String(u.jobRole)) || u.jobRoleName || (ADMIN_ROLE.test(u.jobRole || '') ? u.jobRole : ''),
    }));
    setPaginationHeaders(res, { total, page, limit });
    res.json({ items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)), stats: { total: all, active, inactive: all - active, admins } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch company users' });
  }
});

router.patch('/company/:id/deactivate', requirePlatformOwner, async (req, res) => {
  try {
    await Company.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: 'Company deactivated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to deactivate company' });
  }
});


router.patch('/company/:id/activate', requirePlatformOwner, async (req, res) => {
  try {
    await Company.findByIdAndUpdate(req.params.id, { isActive: true });
    res.json({ message: 'Company activated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to activate company' });
  }
});


router.delete('/company/:id', requirePlatformOwner, async (req, res) => {
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
