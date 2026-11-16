const express = require('express');
const router = express.Router();
const userController = require('../controllers/userControllers');
const { protect } = require('../../middleware/authMiddleware');


router.post('/register', protect, userController.register);


router.use(protect);

// Branch rule for register requests: same as the list (utils/branchScope) - a branch-limited
// viewer may act on requests for their branches and on requests without a branch yet.
const RegisterUser = require('../../models/User');
const { allowedBranchIds, registerRequestBranchCondition } = require('../../utils/branchScope');
// Editing / deleting / restoring an employee: owner/admin, or the employee is in your branches.
const userInBranches = require('../../utils/branchScope').requireRecordInBranches(req => req.params.id, { message: 'This employee is not in your branches.' });
const registerRequestInBranches = async (req, res, next) => {
  try {
    if (allowedBranchIds(req.user) === null) return next();
    if (!require('mongoose').isValidObjectId(req.params.id)) return next();
    const ok = await RegisterUser.exists({ _id: req.params.id, ...registerRequestBranchCondition(req.user) });
    if (ok) return next();
    return res.status(403).json({ success: false, message: 'This registration request belongs to another branch.' });
  } catch (error) {
    return next(error);
  }
};


router.get('/me', userController.getMe);
router.put('/me', userController.updateMe);
router.put('/change-password', userController.changePassword);


router.get('/department-users', userController.getCompanydepartmentUsers);
router.get('/company-users', userController.getCompanyUsers);


router.get('/all', userController.getAllUsers);
router.get('/deleted', userController.getDeletedUsers);
router.get('/register-requests', userController.getRegisterRequests);
router.get('/register-requests/count', userController.getRegisterRequestsCount);
router.put('/register-requests/:id', registerRequestInBranches, userController.updateRegisterRequest);
router.patch('/register-requests/:id/verify-section', registerRequestInBranches, userController.verifyRegisterRequestSection);
router.patch('/register-requests/:id/activate', registerRequestInBranches, userController.activateRegisterRequest);
router.patch('/register-requests/:id/status', registerRequestInBranches, userController.setRegisterRequestStatus);
router.delete('/register-requests/:id', registerRequestInBranches, userController.rejectRegisterRequest);
router.put('/restore/:id', userInBranches, userController.restoreUser);
router.put('/admin-update/:id', userInBranches, userController.updateUser);
router.put('/admin-update-by-email', userController.updateUser);
router.delete('/:id', userInBranches, userController.deleteUser);
router.get('/:id/groups', require('../controllers/groupController').getUserGroups);


router.get('/search', userController.searchUsers);

router.use('/:id/documents', require('./employeeDocumentRoutes'));


router.get('/profile', (req, res, next) => {
  req.params.id = req.user._id.toString();
  return require('../controllers/profileController').getUserProfile(req, res, next);
});
router.get('/profile/:id', (req, res, next) => {
  return require('../controllers/profileController').getUserProfile(req, res, next);
});
router.get('/:id', userController.getUser);
router.put('/profile-update/:id', userController.updateSelfUser);
router.put('/:id', userInBranches, userController.updateUser);

module.exports = router;
