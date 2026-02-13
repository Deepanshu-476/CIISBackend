// attendanceRoutes.js
const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/AttendanceController');
const { protect, authorize } = require('../../middleware/authMiddleware');

// User routes
router.post('/in', protect, attendanceController.clockIn);
router.post('/out', protect, attendanceController.clockOut);
router.get('/status', protect, attendanceController.getTodayStatus);
router.get('/list', protect, attendanceController.getAttendanceList);

// Admin routes
router.get('/all', protect, attendanceController.getAllUsersAttendance);
router.post('/manual', protect, attendanceController.createManualAttendance);
router.put('/:id', protect, attendanceController.updateAttendanceRecord);
router.delete('/:id', protect, attendanceController.deleteAttendanceRecord);
router.get('/user/:userId', protect, attendanceController.getAttendanceByUser);
router.get('/stats', protect, attendanceController.getAttendanceStats);

// Test routes (development/testing only)
router.get('/test', protect, async (req, res) => {
  try {
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    // Test company code retrieval
    const testUser = await User.findById(req.user._id).select('companyCode company');
    const testCompany = await Company.findOne({ companyCode: userCompanyCode });
    
    res.status(200).json({
      message: "Company filter test",
      data: {
        userCompanyCode,
        user: testUser,
        company: testCompany,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({ 
      message: "Test failed", 
      error: error.message 
    });
  }
});

router.post('/test/attendance-creation', protect, async (req, res) => {
  try {
    const { userId, date } = req.body;
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    if (!userCompanyCode) {
      return res.status(400).json({ 
        message: "Company code not found in user" 
      });
    }
    
    // Create a test attendance record
    const testAttendance = new Attendance({
      user: userId || req.user._id,
      date: date ? new Date(date) : new Date(),
      inTime: new Date(),
      status: "TEST",
      isClockedIn: true,
      companyCode: userCompanyCode,
      notes: "Test attendance record"
    });
    
    await testAttendance.save();
    
    const populated = await Attendance.findById(testAttendance._id)
      .populate({
        path: "user",
        select: "name email companyCode"
      });
    
    res.status(201).json({
      message: "Test attendance created successfully",
      data: populated,
      companyValidation: {
        expectedCompanyCode: userCompanyCode,
        actualCompanyCode: populated.companyCode,
        match: populated.companyCode === userCompanyCode
      }
    });
  } catch (error) {
    res.status(500).json({ 
      message: "Test attendance creation failed", 
      error: error.message 
    });
  }
});

router.get('/test/company-attendance', protect, async (req, res) => {
  try {
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    if (!userCompanyCode) {
      return res.status(400).json({ 
        message: "Company code not found" 
      });
    }
    
    // Get all attendance records for the company
    const companyAttendance = await Attendance.find({ 
      companyCode: userCompanyCode 
    })
    .populate({
      path: "user",
      select: "name email employeeType companyCode"
    })
    .sort({ date: -1 })
    .limit(10);
    
    // Get company users count
    const companyUsers = await User.find({ 
      companyCode: userCompanyCode 
    }).countDocuments();
    
    // Get company info
    const company = await Company.findOne({ 
      companyCode: userCompanyCode 
    }).select('companyName companyCode isActive');
    
    res.status(200).json({
      message: "Company attendance test",
      data: {
        company,
        totalUsers: companyUsers,
        attendanceRecords: companyAttendance.length,
        sampleRecords: companyAttendance,
        validation: {
          allSameCompany: companyAttendance.every(record => record.companyCode === userCompanyCode),
          usersMatchCompany: companyAttendance.every(record => 
            record.user && record.user.companyCode === userCompanyCode
          )
        }
      }
    });
  } catch (error) {
    res.status(500).json({ 
      message: "Company attendance test failed", 
      error: error.message 
    });
  }
});

router.delete('/test/cleanup', protect, async (req, res) => {
  try {
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    if (!userCompanyCode) {
      return res.status(400).json({ 
        message: "Company code not found" 
      });
    }
    
    // Only delete test records
    const result = await Attendance.deleteMany({
      companyCode: userCompanyCode,
      status: "TEST"
    });
    
    res.status(200).json({
      message: "Test cleanup completed",
      data: {
        deletedCount: result.deletedCount,
        companyCode: userCompanyCode
      }
    });
  } catch (error) {
    res.status(500).json({ 
      message: "Cleanup failed", 
      error: error.message 
    });
  }
});

router.get('/test/company-users', protect, async (req, res) => {
  try {
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    if (!userCompanyCode) {
      return res.status(400).json({ 
        message: "Company code not found" 
      });
    }
    
    // Get all users from same company
    const companyUsers = await User.find({ 
      companyCode: userCompanyCode 
    }).select('name email employeeType companyCode isActive');
    
    // Get attendance records for these users
    const attendanceRecords = await Attendance.find({
      companyCode: userCompanyCode,
      date: {
        $gte: new Date(new Date().setDate(new Date().getDate() - 7)) // Last 7 days
      }
    })
    .populate({
      path: "user",
      select: "name email"
    })
    .sort({ date: -1 });
    
    res.status(200).json({
      message: "Company users test",
      data: {
        companyCode: userCompanyCode,
        totalUsers: companyUsers.length,
        users: companyUsers,
        recentAttendance: attendanceRecords,
        validation: {
          allUsersSameCompany: companyUsers.every(user => user.companyCode === userCompanyCode),
          attendanceCompanyMatch: attendanceRecords.every(record => record.companyCode === userCompanyCode)
        }
      }
    });
  } catch (error) {
    res.status(500).json({ 
      message: "Company users test failed", 
      error: error.message 
    });
  }
});

module.exports = router;