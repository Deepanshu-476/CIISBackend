const express = require('express');
const router = express.Router();
const userController = require('../controllers/userControllers');
const { protect } = require('../../middleware/authMiddleware');

// ✅ Register user (only logged-in user can create)
router.post('/register', protect, userController.register);

// ✅ All routes below require authentication
router.use(protect);

// ✅ User profile routes
router.get('/me', userController.getMe);
router.put('/me', userController.updateMe);
router.put('/change-password', userController.changePassword);

// ✅ Company users routes - EXACT MATCH FIRST
router.get('/department-users', userController.getCompanydepartmentUsers);
router.get('/company-users', userController.getCompanyUsers);
// router.get('/company-users/paginated', userController.getCompanyUsersPaginated);


// push

// ✅ Users management
router.get('/all', userController.getAllUsers);
router.get('/deleted', userController.getDeletedUsers);
router.put('/restore/:id', userController.restoreUser);
router.delete('/:id', userController.deleteUser);

// ✅ Search users
router.get('/search', userController.searchUsers);

// ✅ Single user routes - THESE MUST COME LAST
router.get('/:id', userController.getUser);
router.put('/profile-update/:id', userController.updateSelfUser);
router.put('/:id', userController.updateUser);



// userRoutes.js में existing routes के बाद ये test routes add करें:

// ==================== 🧪 TEST ROUTES ====================

// ✅ TEST: Company Filter Verification
router.get('/test', protect, async (req, res) => {
  try {
    const User = require('../../models/User');
    const Department = require('../../models/Department');
    
    // Current user details
    const currentUser = req.user;
    
    // Get current user with all fields from database
    const userFromDB = await User.findById(currentUser._id)
      .select('name email company department jobRole')
      .populate('company', 'name companyCode')
      .populate('department', 'name description')
      .lean();
    
    // Get company ID and details
    const userCompany = userFromDB?.company;
    const userCompanyId = userCompany?._id || userCompany;
    const userDepartmentId = userFromDB?.department?._id || userFromDB?.department;
    
    // Test 1: Find users from same company
    const sameCompanyUsers = await User.find({
      company: userCompanyId,
      isActive: true
    })
    .select('name email jobRole department')
    .populate('department', 'name')
    .limit(5)
    .lean();
    
    // Test 2: Find users from same department
    const sameDepartmentUsers = userDepartmentId ? 
      await User.find({
        company: userCompanyId,
        department: userDepartmentId,
        isActive: true
      })
      .select('name email jobRole')
      .limit(5)
      .lean() : [];
    
    // Test 3: Count all users in company
    const companyUsersCount = await User.countDocuments({
      company: userCompanyId,
      isActive: true
    });
    
    // Test 4: Find departments in same company
    const companyDepartments = await Department.find({
      company: userCompanyId,
      isActive: true
    })
    .select('name description')
    .lean();
    
    // Test 5: Try to access users from other companies (should be empty)
    const otherCompanyUsers = await User.findOne({
      company: { $ne: userCompanyId },
      company: { $exists: true },
      isActive: true
    })
    .select('name email company')
    .populate('company', 'name')
    .lean();
    
    res.status(200).json({
      success: true,
      message: 'Company filter test results',
      userInfo: {
        id: currentUser._id,
        name: currentUser.name,
        email: currentUser.email,
        jobRole: currentUser.jobRole,
        company: userCompany,
        department: userFromDB?.department
      },
      testResults: {
        sameCompanyUsers: {
          count: sameCompanyUsers.length,
          totalInCompany: companyUsersCount,
          sample: sameCompanyUsers.map(u => ({
            name: u.name,
            email: u.email,
            jobRole: u.jobRole,
            department: u.department?.name || 'Not set'
          }))
        },
        sameDepartmentUsers: {
          count: sameDepartmentUsers.length,
          sample: sameDepartmentUsers.map(u => ({
            name: u.name,
            email: u.email,
            jobRole: u.jobRole
          }))
        },
        companyDepartments: {
          count: companyDepartments.length,
          list: companyDepartments.map(d => ({
            name: d.name,
            description: d.description
          }))
        },
        securityTest: {
          canAccessOtherCompanyData: otherCompanyUsers ? true : false,
          otherCompanyUser: otherCompanyUsers ? {
            name: otherCompanyUsers.name,
            email: otherCompanyUsers.email,
            company: otherCompanyUsers.company?.name || 'Other Company'
          } : null,
          securityLevel: otherCompanyUsers ? '⚠️ LOW - Can see other company users' : '✅ HIGH - Data isolation working'
        }
      },
      databaseInfo: {
        totalUsersInDatabase: await User.countDocuments({ isActive: true }),
        usersWithCompanyField: await User.countDocuments({ 
          company: { $exists: true },
          isActive: true 
        }),
        usersWithoutCompanyField: await User.countDocuments({ 
          company: { $exists: false },
          isActive: true 
        })
      },
      recommendations: otherCompanyUsers ? [
        '🚨 SECURITY ISSUE: Can access users from other companies',
        'Add company filtering to all user queries',
        'Verify User model has company field',
        'Update middleware to enforce company filtering'
      ] : [
        '✅ Company filtering appears to be working correctly',
        'Ensure all user endpoints filter by company'
      ]
    });
    
  } catch (error) {
    console.error('❌ Company filter test error:', error);
    res.status(500).json({
      success: false,
      message: 'Test failed',
      error: error.message
    });
  }
});

module.exports = router;