
const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/AttendanceController');
const { protect, restrictTo } = require('../../middleware/authMiddleware');

const upload = require('../../utils/multer');

const privilegedAttendanceRoles = ['super_admin', 'superadmin', 'owner', 'company_owner', 'admin', 'hr', 'manager'];
const adminOrHrRoles = ['super_admin', 'superadmin', 'owner', 'company_owner', 'admin', 'hr'];

router.post('/in', protect, attendanceController.clockIn);
router.post('/out', protect, attendanceController.clockOut);
router.post('/upload-selfie', protect, upload.single('selfie'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }
    const selfieUrl = `/api/uploads/tasks/${req.file.filename}`;
    return res.status(200).json({
      success: true,
      selfieUrl
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});
router.get('/status', protect, attendanceController.getTodayStatus);
router.get('/list', protect, attendanceController.getAttendanceList);

router.get('/all', protect, restrictTo(...privilegedAttendanceRoles), attendanceController.getAllUsersAttendance);
router.post('/manual', protect, restrictTo(...privilegedAttendanceRoles), attendanceController.createManualAttendance);
router.put('/:id', protect, restrictTo(...privilegedAttendanceRoles), attendanceController.updateAttendanceRecord);
router.delete('/:id', protect, restrictTo(...adminOrHrRoles), attendanceController.deleteAttendanceRecord);
router.get('/user/:userId', protect, attendanceController.getAttendanceByUser);
router.get('/stats', protect, restrictTo(...privilegedAttendanceRoles), attendanceController.getAttendanceStats);
// Gate all /test routes from production
router.use('/test', (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({
      success: false,
      message: 'Not found'
    });
  }
  next();
});

router.get('/test', protect, restrictTo(...adminOrHrRoles), async (req, res) => {
  try {
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    
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

router.post('/test/attendance-creation', protect, restrictTo(...adminOrHrRoles), async (req, res) => {
  try {
    const { userId, date } = req.body;
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    if (!userCompanyCode) {
      return res.status(400).json({ 
        message: "Company code not found in user" 
      });
    }
    
    if (userId && String(userId) !== String(req.user._id)) {
      const targetUser = await User.findById(userId).select('companyCode company');
      const targetCompanyCode = targetUser?.companyCode || (targetUser?.company ? targetUser.company.companyCode : null);
      if (!targetUser || targetCompanyCode !== userCompanyCode) {
        return res.status(403).json({ 
          message: "Access denied: cannot create attendance for user in another company" 
        });
      }
    }
    
    
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

router.get('/test/company-attendance', protect, restrictTo(...adminOrHrRoles), async (req, res) => {
  try {
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    if (!userCompanyCode) {
      return res.status(400).json({ 
        message: "Company code not found" 
      });
    }
    
    
    const companyAttendance = await Attendance.find({ 
      companyCode: userCompanyCode 
    })
    .populate({
      path: "user",
      select: "name email employeeType companyCode"
    })
    .sort({ date: -1 })
    .limit(10);
    
    
    const companyUsers = await User.find({ 
      companyCode: userCompanyCode 
    }).countDocuments();
    
    
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

router.delete('/test/cleanup', protect, restrictTo(...adminOrHrRoles), async (req, res) => {
  try {
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    if (!userCompanyCode) {
      return res.status(400).json({ 
        message: "Company code not found" 
      });
    }
    
    
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

router.get('/test/company-users', protect, restrictTo(...adminOrHrRoles), async (req, res) => {
  try {
    const userCompanyCode = req.user.companyCode || (req.user.company ? req.user.company.companyCode : null);
    
    if (!userCompanyCode) {
      return res.status(400).json({ 
        message: "Company code not found" 
      });
    }
    
    
    const companyUsers = await User.find({ 
      companyCode: userCompanyCode 
    }).select('name email employeeType companyCode isActive');
    
    
    const attendanceRecords = await Attendance.find({
      companyCode: userCompanyCode,
      date: {
        $gte: new Date(new Date().setDate(new Date().getDate() - 7)) 
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