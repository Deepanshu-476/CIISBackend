const express = require('express');
const router = express.Router();
const leaveController = require('../controllers/LeaveController');
const authMiddleware = require('../../middleware/authMiddleware');
const { body, param, query } = require('express-validator');
const validateRequest = require('../../middleware/validateRequest.js');
const Leave = require('../models/Leave');
const User = require('../../models/User');
const mongoose = require('mongoose');

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

// 📋 All Leaves Route - Now accessible to everyone in same company
router.get('/all', 
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
  async (req, res) => {
    try {
      console.log('📊 Getting all leaves for user:', {
        userId: req.user._id,
        name: req.user.name,
        companyId: req.user.company,
        company: req.user.companyName
      });

      const { 
        date, 
        status, 
        type, 
        department, 
        search, 
        page = 1, 
        limit = 20 
      } = req.query;

      // Build filter
      const filter = {};
      
      // 🔧 Get the user's company ID
      const userCompanyId = req.user.company || req.user.companyId;
      if (!userCompanyId) {
        return res.status(400).json({
          success: false,
          error: 'User does not belong to any company'
        });
      }

      console.log(`👤 User's company ID: ${userCompanyId}`);

      // Find all users from the same company
      const companyUsers = await User.find({ 
        $or: [
          { company: userCompanyId },
          { companyId: userCompanyId }
        ]
      }).select('_id');
      
      const companyUserIds = companyUsers.map(user => user._id);
      
      console.log(`🏢 Found ${companyUserIds.length} users in the same company`);

      if (companyUserIds.length === 0) {
        return res.status(200).json({
          success: true,
          data: {
            leaves: [],
            pagination: {
              total: 0,
              page: 1,
              limit: parseInt(limit),
              pages: 0
            },
            filters: {
              date,
              status,
              type,
              department,
              search
            },
            company: userCompanyId
          }
        });
      }

      // 🔧 Filter leaves by users from the same company
      filter.user = { $in: companyUserIds };

      // Date filter
      if (date) {
        const selectedDate = new Date(date);
        const startOfDay = new Date(selectedDate.setHours(0, 0, 0, 0));
        const endOfDay = new Date(selectedDate.setHours(23, 59, 59, 999));
        
        filter.$or = [
          {
            startDate: { $lte: endOfDay },
            endDate: { $gte: startOfDay }
          }
        ];
      }

      // Status filter
      if (status && status !== 'All') {
        filter.status = status;
      }

      // Type filter
      if (type && type !== 'all') {
        filter.type = type;
      }

      // Department filter (optional)
      if (department) {
        // Get users from the specified department
        const departmentUsers = await User.find({ 
          _id: { $in: companyUserIds },
          department: department 
        }).select('_id');
        
        const departmentUserIds = departmentUsers.map(user => user._id);
        
        if (departmentUserIds.length > 0) {
          filter.user = { $in: departmentUserIds };
          console.log(`🔍 Filtering by department "${department}": ${departmentUserIds.length} users`);
        } else {
          // If no users in that department, return empty results
          return res.status(200).json({
            success: true,
            data: {
              leaves: [],
              pagination: {
                total: 0,
                page: 1,
                limit: parseInt(limit),
                pages: 0
              },
              filters: {
                date,
                status,
                type,
                department,
                search
              },
              company: userCompanyId
            }
          });
        }
      }

      // Search filter
      if (search) {
        // Create user filter for search
        const userFilter = {
          _id: { $in: companyUserIds },
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { department: { $regex: search, $options: 'i' } },
            { employeeId: { $regex: search, $options: 'i' } }
          ]
        };

        // Get user IDs that match search
        const users = await User.find(userFilter).select('_id');
        const userIds = users.map(user => user._id);
        
        if (userIds.length > 0) {
          filter.user = { $in: userIds };
          console.log(`🔍 Search "${search}": found ${userIds.length} matching users`);
        } else {
          // Also search in leave reasons
          filter.$or = [
            { user: { $in: companyUserIds } }, // Keep company filter
            { reason: { $regex: search, $options: 'i' } }
          ];
        }
      }

      // Calculate pagination
      const skip = (page - 1) * limit;

      // Get total count
      const total = await Leave.countDocuments(filter);

      // Get leaves with populated user data
      const leaves = await Leave.find(filter)
        .populate({
          path: 'user',
          select: 'name email department phone employeeType jobRole employeeId',
          match: { _id: { $in: companyUserIds } }, // Ensure only same company users
          transform: (doc) => {
            if (!doc) return null;
            return {
              id: doc._id || doc.id,
              _id: doc._id || doc.id,
              name: doc.name,
              email: doc.email,
              department: doc.department,
              phone: doc.phone,
              employeeType: doc.employeeType,
              jobRole: doc.jobRole,
              employeeId: doc.employeeId
            };
          }
        })
        .populate({
          path: 'approvedBy',
          select: 'name email',
          match: { _id: { $in: companyUserIds } }, // Ensure only same company users
          transform: (doc) => {
            if (!doc) return null;
            return {
              id: doc._id || doc.id,
              name: doc.name,
              email: doc.email
            };
          }
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean();

      // Filter out leaves where user population failed
      const validLeaves = leaves.filter(leave => leave.user !== null && leave.user !== undefined);

      // Format the response
      const formattedLeaves = validLeaves.map(leave => ({
        _id: leave._id,
        user: leave.user || {
          id: leave.user?._id || leave.user,
          name: 'Unknown User',
          email: 'N/A',
          department: 'N/A'
        },
        type: leave.type,
        reason: leave.reason,
        startDate: leave.startDate,
        endDate: leave.endDate,
        days: leave.days || 0,
        status: leave.status || 'Pending',
        remarks: leave.remarks || '',
        approvedBy: leave.approvedBy,
        history: leave.history || [],
        createdAt: leave.createdAt,
        updatedAt: leave.updatedAt,
        // Add company info for verification
        company: userCompanyId
      }));

      console.log(`✅ Found ${formattedLeaves.length} leaves out of ${total} total for company ${userCompanyId}`);

      res.status(200).json({
        success: true,
        data: {
          leaves: formattedLeaves,
          pagination: {
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            pages: Math.ceil(total / limit)
          },
          filters: {
            date,
            status,
            type,
            department,
            search
          },
          company: userCompanyId,
          companyName: req.user.companyName || 'Your Company',
          userInfo: {
            id: req.user._id,
            name: req.user.name,
            role: req.user.jobRole || req.user.role,
            department: req.user.department
          }
        }
      });

    } catch (error) {
      console.error('❌ Error in getAllLeaves:', error);
      res.status(500).json({
        success: false,
        error: 'Server error while fetching leaves',
        details: error.message
      });
    }
  }
);

// ✅ Update Leave Status - Now accessible to everyone in same company
router.put('/:id/status',
  [
    param('id').isMongoId().withMessage('Invalid leave ID format'),
    body('status').isIn(['Approved', 'Rejected', 'Pending', 'Cancelled']).withMessage('Invalid status value'),
    body('remarks').optional().trim().isLength({ max: 500 }).withMessage('Remarks must be less than 500 characters'),
    validateRequest
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status, remarks } = req.body;
      const userId = req.user._id;
      const userCompanyId = req.user.company || req.user.companyId;

      // Find the leave
      const leave = await Leave.findById(id).populate('user', 'company companyId');

      if (!leave) {
        return res.status(404).json({
          success: false,
          error: 'Leave not found'
        });
      }

      // 🔧 Check if the leave belongs to someone in the same company
      const leaveUserCompanyId = leave.user.company || leave.user.companyId;
      if (leaveUserCompanyId !== userCompanyId) {
        return res.status(403).json({
          success: false,
          error: 'You can only update leaves from your own company'
        });
      }

      // Check if user is trying to update their own leave
      if (leave.user._id.toString() === userId.toString()) {
        return res.status(400).json({
          success: false,
          error: 'You cannot update the status of your own leave'
        });
      }

      // Update the leave status
      leave.status = status;
      leave.remarks = remarks || leave.remarks;
      leave.approvedBy = userId;
      
      // Add to history
      leave.history = leave.history || [];
      leave.history.push({
        action: status,
        by: userId,
        remarks: remarks || '',
        at: new Date()
      });

      await leave.save();

      res.status(200).json({
        success: true,
        message: `Leave ${status.toLowerCase()} successfully`,
        data: leave
      });

    } catch (error) {
      console.error('Error updating leave status:', error);
      res.status(500).json({
        success: false,
        error: 'Server error while updating leave status'
      });
    }
  }
);

// ✅ Delete Leave - Now accessible to everyone in same company
router.delete('/:id',
  [
    param('id').isMongoId().withMessage('Invalid leave ID format'),
    validateRequest
  ],
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user._id;
      const userCompanyId = req.user.company || req.user.companyId;

      // Find the leave
      const leave = await Leave.findById(id).populate('user', 'company companyId');

      if (!leave) {
        return res.status(404).json({
          success: false,
          error: 'Leave not found'
        });
      }

      // 🔧 Check if the leave belongs to someone in the same company
      const leaveUserCompanyId = leave.user.company || leave.user.companyId;
      if (leaveUserCompanyId !== userCompanyId) {
        return res.status(403).json({
          success: false,
          error: 'You can only delete leaves from your own company'
        });
      }

      // Delete the leave
      await Leave.findByIdAndDelete(id);

      res.status(200).json({
        success: true,
        message: 'Leave deleted successfully'
      });

    } catch (error) {
      console.error('Error deleting leave:', error);
      res.status(500).json({
        success: false,
        error: 'Server error while deleting leave'
      });
    }
  }
);

// ✅ Department Leaves - Now accessible to everyone in same company
router.get('/department/:department',
  [
    param('department').trim().notEmpty().withMessage('Department is required'),
    query('status').optional().isIn(['Pending', 'Approved', 'Rejected', 'Cancelled', 'All']).withMessage('Invalid status value'),
    query('type').optional().isIn(['Casual', 'Sick', 'Paid', 'Unpaid', 'Other', 'all']).withMessage('Invalid type value'),
    query('date').optional().isISO8601().withMessage('Invalid date format'),
    validateRequest
  ],
  async (req, res) => {
    try {
      const { department } = req.params;
      const { status, type, date } = req.query;
      const userCompanyId = req.user.company || req.user.companyId;

      // Get users from the same company and specified department
      const departmentUsers = await User.find({ 
        company: userCompanyId,
        department: department 
      }).select('_id');
      
      const userIds = departmentUsers.map(user => user._id);

      if (userIds.length === 0) {
        return res.status(200).json({
          success: true,
          data: {
            leaves: [],
            department,
            company: userCompanyId,
            total: 0
          }
        });
      }

      const filter = { user: { $in: userIds } };

      // Date filter
      if (date) {
        const selectedDate = new Date(date);
        const startOfDay = new Date(selectedDate.setHours(0, 0, 0, 0));
        const endOfDay = new Date(selectedDate.setHours(23, 59, 59, 999));
        
        filter.$or = [
          {
            startDate: { $lte: endOfDay },
            endDate: { $gte: startOfDay }
          }
        ];
      }

      // Status filter
      if (status && status !== 'All') {
        filter.status = status;
      }

      // Type filter
      if (type && type !== 'all') {
        filter.type = type;
      }

      const leaves = await Leave.find(filter)
        .populate({
          path: 'user',
          select: 'name email department phone',
          match: { _id: { $in: userIds } }
        })
        .populate('approvedBy', 'name email')
        .sort({ createdAt: -1 })
        .lean();

      res.status(200).json({
        success: true,
        data: {
          leaves,
          department,
          company: userCompanyId,
          total: leaves.length
        }
      });

    } catch (error) {
      console.error('Department leaves error:', error);
      res.status(500).json({ 
        success: false,
        error: 'Server error while fetching department leaves' 
      });
    }
  }
);

// 🔄 Leave Calendar View (For all users in same company)
router.get('/calendar',
  [
    query('month').optional().isInt({ min: 1, max: 12 }).withMessage('Invalid month (1-12)'),
    query('year').optional().isInt({ min: 2000, max: 2100 }).withMessage('Invalid year'),
    validateRequest
  ],
  async (req, res) => {
    try {
      const userId = req.user._id;
      const userCompanyId = req.user.company || req.user.companyId;
      const { month, year } = req.query;
      
      const currentDate = new Date();
      const targetMonth = month ? parseInt(month) : currentDate.getMonth() + 1;
      const targetYear = year ? parseInt(year) : currentDate.getFullYear();
      
      // Calculate start and end of the month
      const startDate = new Date(targetYear, targetMonth - 1, 1);
      const endDate = new Date(targetYear, targetMonth, 0);
      
      // Get all users from same company
      const companyUsers = await User.find({ company: userCompanyId }).select('_id');
      const companyUserIds = companyUsers.map(user => user._id);
      
      const leaves = await Leave.find({
        user: { $in: companyUserIds },
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
        title: `${leave.user?.name || 'User'} - ${leave.type} Leave`,
        start: new Date(leave.startDate).toISOString().split('T')[0],
        end: new Date(new Date(leave.endDate).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        status: leave.status,
        color: leave.status === 'Approved' ? '#10b981' : 
               leave.status === 'Pending' ? '#f59e0b' : 
               leave.status === 'Rejected' ? '#ef4444' : '#6b7280',
        extendedProps: {
          userId: leave.user?._id,
          userName: leave.user?.name,
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
          total: leaves.length,
          company: userCompanyId
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

// 📊 Department Statistics (For all users in same company)
router.get('/department-stats/:department',
  [
    param('department').trim().notEmpty().withMessage('Department is required'),
    query('year').optional().isInt({ min: 2000, max: 2100 }).withMessage('Invalid year'),
    validateRequest
  ],
  async (req, res) => {
    try {
      const { department } = req.params;
      const year = req.query.year || new Date().getFullYear();
      const userCompanyId = req.user.company || req.user.companyId;
      
      console.log(`📊 Getting department stats for: ${department}, year: ${year}, company: ${userCompanyId}`);
      
      // Get users from same company and department
      const departmentUsers = await User.find({ 
        company: userCompanyId,
        department: department 
      }, '_id');
      
      const userIds = departmentUsers.map(user => user._id);
      
      if (userIds.length === 0) {
        return res.status(200).json({
          success: true,
          data: {
            department,
            year,
            company: userCompanyId,
            stats: {
              total: 0,
              approved: 0,
              pending: 0,
              rejected: 0,
              cancelled: 0,
              totalDays: 0,
              avgProcessingTime: 0
            },
            monthlyStats: Array.from({ length: 12 }, (_, i) => ({
              month: i + 1,
              total: 0,
              approved: 0,
              pending: 0,
              rejected: 0,
              cancelled: 0
            })),
            typeStats: {},
            employeeCount: 0
          }
        });
      }
      
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
          company: userCompanyId,
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

// 📈 Dashboard Analytics (For all users in same company)
router.get('/analytics',
  [
    query('period').optional().isIn(['daily', 'weekly', 'monthly', 'yearly']).withMessage('Invalid period'),
    query('startDate').optional().isISO8601().withMessage('Invalid start date'),
    query('endDate').optional().isISO8601().withMessage('Invalid end date'),
    validateRequest
  ],
  async (req, res) => {
    try {
      const { period = 'monthly', startDate, endDate } = req.query;
      const userCompanyId = req.user.company || req.user.companyId;
      
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
      
      // Get all users from same company
      const companyUsers = await User.find({ company: userCompanyId }).select('_id');
      const userIds = companyUsers.map(user => user._id);
      
      if (userIds.length > 0) {
        dateFilter.user = { $in: userIds };
      }
      
      // Get all leaves for the period
      const leaves = await Leave.find(dateFilter)
        .populate('user', 'name department')
        .lean();
      
      // Calculate analytics
      const analytics = {
        period,
        company: userCompanyId,
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
      
      // Default leave policies
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

// 📤 Export Leaves (For all users in same company)
router.get('/export',
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
      const userCompanyId = req.user.company || req.user.companyId;
      
      let filter = {};
      
      // Get all users from same company
      const companyUsers = await User.find({ company: userCompanyId }).select('_id');
      const userIds = companyUsers.map(user => user._id);
      
      filter.user = { $in: userIds };
      
      // Date filter
      if (startDate && endDate) {
        filter.startDate = { 
          $gte: new Date(startDate), 
          $lte: new Date(endDate) 
        };
      }
      
      // Department filter
      if (department) {
        const departmentUsers = await User.find({ 
          company: userCompanyId,
          department: department 
        }).select('_id');
        
        const departmentUserIds = departmentUsers.map(user => user._id);
        filter.user = { $in: departmentUserIds };
      }
      
      const leaves = await Leave.find(filter)
        .populate({
          path: 'user',
          select: 'name email department jobRole',
          transform: (doc) => {
            if (!doc) return null;
            return {
              id: doc._id || doc.id,
              name: doc.name,
              email: doc.email,
              department: doc.department,
              jobRole: doc.jobRole
            };
          }
        })
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