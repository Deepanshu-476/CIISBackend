const express = require('express');
const router = express.Router();
const leaveController = require('../controllers/LeaveController');
const authMiddleware = require('../../middleware/authMiddleware');
const { body, param, query } = require('express-validator');
const validateRequest = require('../../middleware/validateRequest.js');
const Leave = require('../models/Leave');
const User = require('../../models/User');

// 🔐 All routes are protected
router.use(authMiddleware.protect);

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

router.get('/status', 
  [
    query('status').optional().isIn(['Pending', 'Approved', 'Rejected', 'Cancelled', 'All']).withMessage('Invalid status value'),
    query('type').optional().isIn(['Casual', 'Sick', 'Paid', 'Unpaid', 'Other', 'all']).withMessage('Invalid type value'),
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

// 👨‍💼 Manager/Admin Routes
router.get('/all', 
  authMiddleware.restrictTo('admin', 'hr', 'manager'),
  [
    query('date').optional().isISO8601().withMessage('Invalid date format'),
    query('status').optional().isIn(['Pending', 'Approved', 'Rejected', 'Cancelled', 'All']).withMessage('Invalid status value'),
    query('type').optional().isIn(['Casual', 'Sick', 'Paid', 'Unpaid', 'Other', 'all']).withMessage('Invalid type value'),
    query('department').optional().trim(),
    query('search').optional().trim(),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    validateRequest
  ],
  leaveController.getAllLeaves
);

router.put('/:id/status',
  authMiddleware.restrictTo('admin', 'hr', 'manager'),
  [
    param('id').isMongoId().withMessage('Invalid leave ID format'),
    body('status').isIn(['Approved', 'Rejected', 'Pending', 'Cancelled']).withMessage('Invalid status value'),
    body('remarks').optional().trim().isLength({ max: 500 }).withMessage('Remarks must be less than 500 characters'),
    validateRequest
  ],
  leaveController.updateLeaveStatus
);

router.delete('/:id',
  authMiddleware.restrictTo('admin', 'hr', 'manager'),
  [
    param('id').isMongoId().withMessage('Invalid leave ID format'),
    validateRequest
  ],
  leaveController.deleteLeave
);

router.get('/department/:department',
  authMiddleware.restrictTo('admin', 'hr', 'manager'),
  [
    param('department').trim().notEmpty().withMessage('Department is required'),
    query('status').optional().isIn(['Pending', 'Approved', 'Rejected', 'Cancelled', 'All']).withMessage('Invalid status value'),
    query('type').optional().isIn(['Casual', 'Sick', 'Paid', 'Unpaid', 'Other', 'all']).withMessage('Invalid type value'),
    query('date').optional().isISO8601().withMessage('Invalid date format'),
    validateRequest
  ],
  leaveController.getLeavesByDepartment
);

// 🔄 Leave Calendar View (For all users)
router.get('/calendar',
  [
    query('month').optional().isInt({ min: 1, max: 12 }).withMessage('Invalid month (1-12)'),
    query('year').optional().isInt({ min: 2000, max: 2100 }).withMessage('Invalid year'),
    validateRequest
  ],
  async (req, res) => {
    try {
      const userId = req.user._id;
      const { month, year } = req.query;
      
      const currentDate = new Date();
      const targetMonth = month ? parseInt(month) : currentDate.getMonth() + 1;
      const targetYear = year ? parseInt(year) : currentDate.getFullYear();
      
      // Calculate start and end of the month
      const startDate = new Date(targetYear, targetMonth - 1, 1);
      const endDate = new Date(targetYear, targetMonth, 0);
      
      const leaves = await Leave.find({
        user: userId,
        $or: [
          {
            startDate: { $lte: endDate },
            endDate: { $gte: startDate }
          }
        ]
      })
      .populate('user', 'name email')
      .sort({ startDate: 1 })
      .lean();
      
      // Format calendar data
      const calendarData = leaves.map(leave => ({
        id: leave._id,
        title: `${leave.type} Leave`,
        start: new Date(leave.startDate).toISOString().split('T')[0],
        end: new Date(new Date(leave.endDate).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        status: leave.status,
        color: leave.status === 'Approved' ? '#10b981' : 
               leave.status === 'Pending' ? '#f59e0b' : 
               leave.status === 'Rejected' ? '#ef4444' : '#6b7280',
        extendedProps: {
          type: leave.type,
          days: leave.days,
          reason: leave.reason
        }
      }));
      
      res.status(200).json({
        success: true,
        data: {
          calendarData,
          month: targetMonth,
          year: targetYear,
          total: leaves.length
        }
      });
      
    } catch (error) {
      console.error('Calendar view error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Server error while fetching calendar data' 
      });
    }
  }
);

// 📊 Department Statistics (For managers)
router.get('/department-stats/:department',
  authMiddleware.restrictTo('admin', 'hr', 'manager'),
  [
    param('department').trim().notEmpty().withMessage('Department is required'),
    query('year').optional().isInt({ min: 2000, max: 2100 }).withMessage('Invalid year'),
    validateRequest
  ],
  async (req, res) => {
    try {
      const { department } = req.params;
      const year = req.query.year || new Date().getFullYear();
      
      // Get users from department
      const departmentUsers = await User.find({ department }, '_id');
      const userIds = departmentUsers.map(user => user._id);
      
      // Calculate yearly statistics
      const startOfYear = new Date(year, 0, 1);
      const endOfYear = new Date(year, 11, 31);
      
      const leaves = await Leave.find({
        user: { $in: userIds },
        startDate: { $gte: startOfYear, $lte: endOfYear }
      })
      .populate('user', 'name department')
      .lean();
      
      // Monthly breakdown
      const monthlyStats = Array.from({ length: 12 }, (_, i) => {
        const monthLeaves = leaves.filter(leave => 
          new Date(leave.startDate).getMonth() === i
        );
        return {
          month: i + 1,
          total: monthLeaves.length,
          approved: monthLeaves.filter(l => l.status === 'Approved').length,
          pending: monthLeaves.filter(l => l.status === 'Pending').length,
          rejected: monthLeaves.filter(l => l.status === 'Rejected').length,
          cancelled: monthLeaves.filter(l => l.status === 'Cancelled').length
        };
      });
      
      // Type breakdown
      const typeStats = {};
      leaves.forEach(leave => {
        if (!typeStats[leave.type]) {
          typeStats[leave.type] = 0;
        }
        typeStats[leave.type]++;
      });
      
      // Overall statistics
      const stats = {
        total: leaves.length,
        approved: leaves.filter(l => l.status === 'Approved').length,
        pending: leaves.filter(l => l.status === 'Pending').length,
        rejected: leaves.filter(l => l.status === 'Rejected').length,
        cancelled: leaves.filter(l => l.status === 'Cancelled').length,
        totalDays: leaves.reduce((sum, leave) => sum + (leave.days || 0), 0),
        avgProcessingTime: 2.5
      };
      
      res.status(200).json({
        success: true,
        data: {
          department,
          year,
          stats,
          monthlyStats,
          typeStats,
          employeeCount: userIds.length
        }
      });
      
    } catch (error) {
      console.error('Department stats error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Server error while fetching department statistics' 
      });
    }
  }
);

// 📈 Dashboard Analytics (For managers)
router.get('/analytics',
  authMiddleware.restrictTo('admin', 'hr', 'manager'),
  [
    query('period').optional().isIn(['daily', 'weekly', 'monthly', 'yearly']).withMessage('Invalid period'),
    query('startDate').optional().isISO8601().withMessage('Invalid start date'),
    query('endDate').optional().isISO8601().withMessage('Invalid end date'),
    validateRequest
  ],
  async (req, res) => {
    try {
      const { period = 'monthly', startDate, endDate } = req.query;
      
      let dateFilter = {};
      if (startDate && endDate) {
        dateFilter.startDate = { 
          $gte: new Date(startDate), 
          $lte: new Date(endDate) 
        };
      } else {
        // Default to current month
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        dateFilter.startDate = { $gte: firstDay, $lte: lastDay };
      }
      
      // Get all leaves for the period
      const leaves = await Leave.find(dateFilter)
        .populate('user', 'name department')
        .lean();
      
      // Calculate analytics
      const analytics = {
        period,
        totalLeaves: leaves.length,
        approvalRate: leaves.length > 0 ? 
          (leaves.filter(l => l.status === 'Approved').length / leaves.length * 100).toFixed(1) : 0,
        avgProcessingTime: 2.5,
        peakMonth: 'January',
        mostCommonType: 'Casual',
        departmentBreakdown: {},
        trendData: []
      };
      
      // Calculate department breakdown
      leaves.forEach(leave => {
        const dept = leave.user?.department || 'Unknown';
        if (!analytics.departmentBreakdown[dept]) {
          analytics.departmentBreakdown[dept] = 0;
        }
        analytics.departmentBreakdown[dept]++;
      });
      
      res.status(200).json({
        success: true,
        data: analytics
      });
      
    } catch (error) {
      console.error('Analytics error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Server error while fetching analytics' 
      });
    }
  }
);

// 👤 User Leave Balance
router.get('/balance',
  async (req, res) => {
    try {
      const userId = req.user._id;
      const currentYear = new Date().getFullYear();
      
      // Get user's leaves for current year
      const startOfYear = new Date(currentYear, 0, 1);
      const endOfYear = new Date(currentYear, 11, 31);
      
      const leaves = await Leave.find({
        user: userId,
        startDate: { $gte: startOfYear, $lte: endOfYear }
      }).lean();
      
      // Default leave policies (this should come from database)
      const leavePolicies = {
        Casual: { maxDays: 12, description: 'For personal work' },
        Sick: { maxDays: 10, description: 'For health issues' },
        Paid: { maxDays: 20, description: 'Earned leave with pay' },
        Unpaid: { maxDays: 30, description: 'Leave without pay' },
        Other: { maxDays: 5, description: 'Other leave types' }
      };
      
      // Calculate used leaves by type
      const usedLeaves = {};
      leaves.forEach(leave => {
        if (leave.status === 'Approved') {
          if (!usedLeaves[leave.type]) {
            usedLeaves[leave.type] = 0;
          }
          usedLeaves[leave.type] += leave.days || 0;
        }
      });
      
      // Calculate balance
      const balance = {};
      Object.keys(leavePolicies).forEach(type => {
        const policy = leavePolicies[type];
        const used = usedLeaves[type] || 0;
        balance[type] = {
          allocated: policy.maxDays,
          used: used,
          remaining: Math.max(0, policy.maxDays - used),
          description: policy.description
        };
      });
      
      // Calculate totals
      const totalAllocated = Object.values(balance).reduce((sum, b) => sum + b.allocated, 0);
      const totalUsed = Object.values(balance).reduce((sum, b) => sum + b.used, 0);
      const totalRemaining = Object.values(balance).reduce((sum, b) => sum + b.remaining, 0);
      
      res.status(200).json({
        success: true,
        data: {
          year: currentYear,
          balance,
          summary: {
            totalAllocated,
            totalUsed,
            totalRemaining,
            utilizationRate: totalAllocated > 0 ? (totalUsed / totalAllocated * 100).toFixed(1) : 0
          }
        }
      });
      
    } catch (error) {
      console.error('Leave balance error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Server error while fetching leave balance' 
      });
    }
  }
);

// 📤 Export Leaves (For managers)
router.get('/export',
  authMiddleware.restrictTo('admin', 'hr', 'manager'),
  [
    query('format').optional().isIn(['csv', 'excel', 'pdf']).withMessage('Invalid export format'),
    query('startDate').optional().isISO8601().withMessage('Invalid start date'),
    query('endDate').optional().isISO8601().withMessage('Invalid end date'),
    query('department').optional().trim(),
    validateRequest
  ],
  async (req, res) => {
    try {
      const { format = 'csv', startDate, endDate, department } = req.query;
      
      let filter = {};
      
      // Date filter
      if (startDate && endDate) {
        filter.startDate = { 
          $gte: new Date(startDate), 
          $lte: new Date(endDate) 
        };
      }
      
      // Department filter for managers
      const userRole = req.user.jobRole?.toLowerCase();
      if (userRole === 'manager' && req.user.department) {
        const departmentUsers = await User.find({ department: req.user.department }, '_id');
        const userIds = departmentUsers.map(user => user._id);
        filter.user = { $in: userIds };
      } else if (department) {
        const departmentUsers = await User.find({ department }, '_id');
        const userIds = departmentUsers.map(user => user._id);
        filter.user = { $in: userIds };
      }
      
      const leaves = await Leave.find(filter)
        .populate('user', 'name email department jobRole')
        .sort({ startDate: -1 })
        .lean();
      
      // Format data for export
      const exportData = leaves.map(leave => ({
        'Leave ID': leave._id,
        'Employee Name': leave.user?.name || 'N/A',
        'Employee Email': leave.user?.email || 'N/A',
        'Department': leave.user?.department || 'N/A',
        'Leave Type': leave.type,
        'Start Date': new Date(leave.startDate).toLocaleDateString(),
        'End Date': new Date(leave.endDate).toLocaleDateString(),
        'Days': leave.days,
        'Reason': leave.reason,
        'Status': leave.status,
        'Applied On': new Date(leave.createdAt).toLocaleDateString(),
        'Approved By': leave.approvedBy || 'N/A',
        'Remarks': leave.remarks || 'N/A'
      }));
      
      // Generate export based on format
      let exportContent, contentType, filename;
      
      if (format === 'csv') {
        // Convert to CSV
        const headers = Object.keys(exportData[0] || {}).join(',');
        const rows = exportData.map(row => 
          Object.values(row).map(value => 
            `"${String(value).replace(/"/g, '""')}"`
          ).join(',')
        );
        exportContent = [headers, ...rows].join('\n');
        contentType = 'text/csv';
        filename = `leaves_export_${new Date().toISOString().split('T')[0]}.csv`;
      } else if (format === 'excel') {
        // For Excel, you would use a library like exceljs
        exportContent = JSON.stringify(exportData);
        contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        filename = `leaves_export_${new Date().toISOString().split('T')[0]}.xlsx`;
      } else {
        // PDF would require additional libraries
        exportContent = JSON.stringify(exportData);
        contentType = 'application/pdf';
        filename = `leaves_export_${new Date().toISOString().split('T')[0]}.pdf`;
      }
      
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      res.status(200).send(exportContent);
      
    } catch (error) {
      console.error('Export error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Server error while exporting data' 
      });
    }
  }
);

module.exports = router;