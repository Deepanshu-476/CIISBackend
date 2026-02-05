const express = require('express');
const router = express.Router();
const userController = require('../controllers/userControllers');
const { protect } = require('../../middleware/authMiddleware');

// ✅ Register user (only logged-in user can create)
router.post('/register', protect, userController.register);

// ✅ All routes below require authentication
router.use(protect);

// ✅ User profile routes
router.get('/me', userController.getMe);
router.put('/me', userController.updateMe);
router.put('/change-password', userController.changePassword);

// ✅ Company users routes - EXACT MATCH FIRST
router.get('/company-users', userController.getCompanyUsers);
// router.get('/company-users/paginated', userController.getCompanyUsersPaginated);

// ✅ Users management
router.get('/all', userController.getAllUsers);
router.get('/deleted', userController.getDeletedUsers);
router.put('/restore/:id', userController.restoreUser);
router.delete('/:id', userController.deleteUser);

// ✅ Search users
router.get('/search', userController.searchUsers);

// ✅ Single user routes - THESE MUST COME LAST
router.get('/:id', userController.getUser);
router.put('/:id', userController.updateUser);

module.exports = router;