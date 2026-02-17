// leaveRoutes.js
const express = require('express');
const router = express.Router();
const leaveController = require('../controllers/LeaveController');
const authMiddleware = require('../../middleware/authMiddleware');
const { body, param, query } = require('express-validator');
const validateRequest = require('../../middleware/validateRequest.js');
const { isCompanyOwner } = require('../../middleware/authMiddleware');
// 🔐 All routes are protected
router.use(authMiddleware.protect);
// router.patch('/status/:id', leaveController.updateLeaveStatus);
// router.get('/status', leaveController.getLeavesWithStatus);
// 📋 User Routes
router.post('/apply', 
  [
    body('type').isIn(['Casual', 'Sick', 'Paid', 'Unpaid', 'Other']).withMessage('Invalid leave type'),
    body('reason').trim().notEmpty().withMessage('Reason is required').isLength({ max: 500 }).withMessage('Reason must be less than 500 characters'),
    body('startDate').isISO8601().withMessage('Invalid start date format'),
    body('endDate').isISO8601().withMessage('Invalid end date format'),
    validateRequest
  ],
  leaveController.applyLeave
);

router.get('/status',  // ← This is GET /leaves/status
  [
    query('status').optional().isIn(['Pending', 'Approved', 'Rejected', 'Cancelled', 'All']).withMessage('Invalid status'),
    query('type').optional().isIn(['Casual', 'Sick', 'Paid', 'Unpaid', 'Other', 'all']).withMessage('Invalid type'),
    query('date').optional().isISO8601().withMessage('Invalid date format'),
    query('year').optional().isInt({ min: 2000, max: 2100 }).withMessage('Invalid year'),
    query('month').optional().isInt({ min: 1, max: 12 }).withMessage('Invalid month'),
    validateRequest
  ],
  leaveController.getLeavesWithStatus
);

router.get('/my', leaveController.getUserLeaves);

router.post('/sync',
  [
    body('localLeaves').optional().isArray().withMessage('localLeaves must be an array'),
    body('lastSync').optional().isISO8601().withMessage('Invalid lastSync date format'),
    validateRequest
  ],
  leaveController.syncLeaves
);

router.get('/stats', leaveController.getLeaveStats);

// 📋 All Leaves Route - Accessible to everyone in same company
router.get('/all', leaveController.getAllLeaves);

router.patch('/status/:id',
  [
    param('id').isMongoId().withMessage('Invalid leave ID format'),
    body('status')
      .isIn(['Approved', 'Rejected', 'Pending', 'Cancelled'])
      .withMessage('Status must be Approved, Rejected, Pending, or Cancelled'),
    body('remarks')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Remarks must be less than 500 characters'),
    validateRequest,
    isCompanyOwner
  ],
  leaveController.updateLeaveStatus
);

// ✅ Delete Leave
router.delete('/:id',
  [
    param('id').isMongoId().withMessage('Invalid leave ID format'),
    validateRequest
  ],
  leaveController.deleteLeave
);

// ✅ Department Leaves
router.get('/department/:department',
  [
    param('department').trim().notEmpty().withMessage('Department is required'),
    query('status').optional().isIn(['Pending', 'Approved', 'Rejected', 'Cancelled', 'All']).withMessage('Invalid status value'),
    query('type').optional().isIn(['Casual', 'Sick', 'Paid', 'Unpaid', 'Other', 'all']).withMessage('Invalid type value'),
    query('date').optional().isISO8601().withMessage('Invalid date format'),
    validateRequest
  ],
  leaveController.getLeavesByDepartment
);

// 🔄 Leave Calendar View
router.get('/calendar', leaveController.getCalendarView);

// 📊 Department Statistics
router.get('/department-stats/:department', leaveController.getDepartmentStats);

// 📈 Dashboard Analytics
router.get('/analytics', leaveController.getAnalytics);

// 👤 User Leave Balance
router.get('/balance', leaveController.getLeaveBalance);

// 📤 Export Leaves
router.get('/export', leaveController.exportLeaves);

// 🧪 TEST ROUTE - Company Filter Test
router.get('/test', 
  async (req, res) => {
    try {
      const User = require('../../models/User');
      const Company = require('../../models/Company');
      
      const userCompanyId = req.user.company || req.user.companyId;
      const userCompanyName = req.user.companyName;
      
      // Test company code retrieval
      const testUser = await User.findById(req.user._id).select('name email company companyId department');
      const testCompany = await Company.findById(userCompanyId).select('companyName companyCode address');
      
      // Get all users from same company
      const companyUsers = await User.find({ 
        company: userCompanyId 
      }).select('name email department').limit(5);
      
      res.status(200).json({
        message: "Company filter test successful",
        data: {
          user: {
            id: req.user._id,
            name: req.user.name,
            email: req.user.email,
            companyId: userCompanyId,
            companyName: userCompanyName,
            department: req.user.department
          },
          company: testCompany || { message: "Company not found" },
          companyUsersCount: companyUsers.length,
          sampleCompanyUsers: companyUsers,
          testInfo: {
            timestamp: new Date().toISOString(),
            endpoint: "/api/leaves/test/company-filter",
            purpose: "Test company-based data isolation"
          }
        }
      });
    } catch (error) {
      console.error("❌ Test route error:", error);
      res.status(500).json({ 
        message: "Test failed", 
        error: error.message 
      });
    }
  }
);

module.exports = router;