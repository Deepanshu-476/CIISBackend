
const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/AttendanceController');
const { protect } = require('../../middleware/authMiddleware');
const { requirePageAccess } = require('../../middleware/pageAccess');

const upload = require('../../utils/multer');

// Branch rule: editing someone's attendance needs them to be in the viewer's branches.
const AttendanceModel = require('../models/Attendance');
const { requireRecordInBranches } = require('../../utils/branchScope');
const attendanceInBranches = requireRecordInBranches(
  async req => (require('mongoose').isValidObjectId(req.params.id)
    ? (await AttendanceModel.findById(req.params.id).select('user').lean())?.user
    : null),
  { label: 'attendance' }
);
const attendanceUserInBranches = requireRecordInBranches(req => req.body?.user, { label: 'attendance' });

const checkAttendanceAccess = action => requirePageAccess({
  paths: ['/ciisUser/emp-attendance'], action, label: 'Employee Attendance',
});

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

router.get('/all', protect, checkAttendanceAccess('view'), attendanceController.getAllUsersAttendance);
router.post('/preview', protect, checkAttendanceAccess('view'), attendanceController.previewAttendance);
router.post('/manual', protect, checkAttendanceAccess('edit'), attendanceUserInBranches, attendanceController.createManualAttendance);
router.put('/:id', protect, checkAttendanceAccess('edit'), attendanceInBranches, attendanceController.updateAttendanceRecord);
router.delete('/:id', protect, checkAttendanceAccess('delete'), attendanceInBranches, attendanceController.deleteAttendanceRecord);
router.get('/user/:userId', protect, attendanceController.getAttendanceByUser);
router.get('/stats', protect, checkAttendanceAccess('view'), attendanceController.getAttendanceStats);


module.exports = router;