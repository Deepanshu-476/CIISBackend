const express = require('express');
const router = express.Router();
const userController = require('../controllers/userControllers');
const { protect } = require('../../middleware/authMiddleware');


router.post('/register', protect, userController.register);


router.use(protect);


router.get('/me', userController.getMe);
router.put('/me', userController.updateMe);
router.put('/change-password', userController.changePassword);


router.get('/department-users', userController.getCompanydepartmentUsers);
router.get('/company-users', userController.getCompanyUsers);


router.get('/all', userController.getAllUsers);
router.get('/deleted', userController.getDeletedUsers);
router.get('/register-requests', userController.getRegisterRequests);
router.put('/register-requests/:id', userController.updateRegisterRequest);
router.patch('/register-requests/:id/verify-section', userController.verifyRegisterRequestSection);
router.patch('/register-requests/:id/activate', userController.activateRegisterRequest);
router.patch('/register-requests/:id/status', userController.setRegisterRequestStatus);
router.delete('/register-requests/:id', userController.rejectRegisterRequest);
router.put('/restore/:id', userController.restoreUser);
router.put('/admin-update/:id', userController.updateUser);
router.put('/admin-update-by-email', userController.updateUser);
router.delete('/:id', userController.deleteUser);
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
router.put('/:id', userController.updateUser);

module.exports = router;
