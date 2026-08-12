
const express = require('express');
const router = express.Router();
const leaveController = require('../controllers/LeaveController');
const authMiddleware = require('../../middleware/authMiddleware');
const { body, param, query } = require('express-validator');
const validateRequest = require('../../middleware/validateRequest.js');

router.use(authMiddleware.protect);



router.post('/apply', 
  [
    body('type').trim().notEmpty().isLength({ max: 80 }).withMessage('Invalid leave type'),
    body('reason')
      .trim()
      .isLength({ min: 20 })
      .withMessage('Please enter at least 20 characters.')
      .isLength({ max: 500 })
      .withMessage('Reason must not exceed 500 characters.'),
    body('startDate').isISO8601().withMessage('Invalid start date format'),
    body('endDate').isISO8601().withMessage('Invalid end date format'),
    validateRequest
  ],
  leaveController.applyLeave
);

router.get('/status',  
  [
    query('status').optional().isIn(['Pending', 'Approved', 'Rejected', 'Cancelled', 'All']).withMessage('Invalid status'),
    query('type').optional().trim().isLength({ max: 80 }).withMessage('Invalid type'),
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


router.get('/all', leaveController.getAllLeaves);

router.get('/approval-options/:id',
  [
    param('id').isMongoId().withMessage('Invalid leave ID format'),
    validateRequest
  ],
  leaveController.getLeaveApprovalOptions
);

router.patch('/status/:id',
  [
    param('id').isMongoId().withMessage('Invalid leave ID format'),
    body('status')
      .isIn(['Approved', 'Rejected'])
      .withMessage('Status must be Approved or Rejected'),
    body('remarks')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('Remarks must be less than 500 characters'),
    body('leaveType').optional().trim().isLength({ min: 1, max: 80 }).withMessage('Invalid leave type'),
    body('payType').optional().isIn(['Paid', 'Unpaid']).withMessage('Pay type must be Paid or Unpaid'),
    validateRequest
  ],
  leaveController.updateLeaveStatus
);

router.patch('/:id/cancel',
  [
    param('id').isMongoId().withMessage('Invalid leave ID format'),
    body('remarks').optional().trim().isLength({ max: 500 }).withMessage('Remarks must be less than 500 characters'),
    validateRequest
  ],
  leaveController.cancelOwnLeave
);


router.delete('/:id',
  [
    param('id').isMongoId().withMessage('Invalid leave ID format'),
    validateRequest
  ],
  leaveController.deleteLeave
);


router.get('/department/:department',
  [
    param('department').trim().notEmpty().withMessage('Department is required'),
    query('status').optional().isIn(['Pending', 'Approved', 'Rejected', 'Cancelled', 'All']).withMessage('Invalid status value'),
    query('type').optional().trim().isLength({ max: 80 }).withMessage('Invalid type value'),
    query('date').optional().isISO8601().withMessage('Invalid date format'),
    validateRequest
  ],
  leaveController.getLeavesByDepartment
);


router.get('/calendar', leaveController.getCalendarView);


router.get('/department-stats/:department', leaveController.getDepartmentStats);


router.get('/analytics', leaveController.getAnalytics);


router.get('/balance', leaveController.getLeaveBalance);


router.get('/export', leaveController.exportLeaves);


router.get('/test', 
  async (req, res) => {
    try {
      const User = require('../../models/User');
      const Company = require('../../models/Company');
      
      const userCompanyId = req.user.company || req.user.companyId;
      const userCompanyName = req.user.companyName;
      
      
      const testUser = await User.findById(req.user._id).select('name email company companyId department');
      const testCompany = await Company.findById(userCompanyId).select('companyName companyCode address');
      
      
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
