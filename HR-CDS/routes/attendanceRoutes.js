
const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/AttendanceController');
const { protect } = require('../../middleware/authMiddleware');
const PagePermission = require('../../models/PagePermission');

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

const normalizeRole = value => String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '_');

const privilegedAttendanceRoles = [
  'super_admin', 'superadmin',
  'owner', 'company_owner', 'companyowner',
  'admin', 'company_admin', 'companyadmin',
  'hr', 'hr_manager', 'manager'
];
const adminOrHrRoles = [
  'super_admin', 'superadmin',
  'owner', 'company_owner', 'companyowner',
  'admin', 'company_admin', 'companyadmin',
  'hr', 'hr_manager'
];

const checkAttendanceAccess = (requiredPermission = 'view') => async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Not authorized' });
  }

  // 1. Super Admin or Company Owner check
  if (req.user.isSuperAdmin || req.user.isCompanyOwner) {
    return next();
  }

  // 2. Direct role match
  const userRoles = [
    req.user.jobRole,
    req.user.jobRoleName,
    req.user.companyRole,
    req.user.role,
    req.user.userType
  ].filter(Boolean).map(normalizeRole);

  const allowedRoleList = requiredPermission === 'delete' ? adminOrHrRoles : privilegedAttendanceRoles;
  if (userRoles.some(r => allowedRoleList.includes(r))) {
    return next();
  }

  // 3. Dynamic PagePermission check for /ciisUser/emp-attendance
  try {
    const company = req.user?.company?._id || req.user?.company || req.user?.companyId;
    const userId = String(req.user?._id || req.user?.id || '');
    if (company && userId) {
      const page = await PagePermission.findOne({
        company,
        path: '/ciisUser/emp-attendance'
      }).lean();

      if (page) {
        const viewIds = new Set([
          ...(page.viewUsers || []).map(u => String(u?.user?._id || u?.user || '')),
          ...(page.editUsers || []).map(u => String(u?.user?._id || u?.user || '')),
          ...(page.deleteUsers || []).map(u => String(u?.user?._id || u?.user || '')),
          ...(page.approvers || []).map(u => String(u?.user?._id || u?.user || ''))
        ]);
        const editIds = new Set([
          ...(page.editUsers || []).map(u => String(u?.user?._id || u?.user || '')),
          ...(page.approvers || []).map(u => String(u?.user?._id || u?.user || ''))
        ]);
        const deleteIds = new Set([
          ...(page.deleteUsers || []).map(u => String(u?.user?._id || u?.user || '')),
          ...(page.approvers || []).map(u => String(u?.user?._id || u?.user || ''))
        ]);

        if (requiredPermission === 'view' && viewIds.has(userId)) return next();
        if (requiredPermission === 'edit' && editIds.has(userId)) return next();
        if (requiredPermission === 'delete' && deleteIds.has(userId)) return next();
      }
    }
  } catch (err) {
    console.error('Error checking attendance page permission:', err);
  }

  return res.status(403).json({
    success: false,
    message: 'You do not have permission to access this attendance resource'
  });
};

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