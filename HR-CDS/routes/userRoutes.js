// HR-CDS/routes/userRoutes.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userControllers');
const { protect, authorize } = require('../../middleware/authMiddleware');

// Public route
router.post('/register', userController.register);

// All routes below require authentication
router.use(protect);

// User routes (for all authenticated users)
router.get('/me', userController.getMe);
router.put('/me', userController.updateMe);
router.put('/change-password', userController.changePassword);

// Admin only routes
router.get('/all', authorize('admin', 'hr', 'manager', 'SuperAdmin'), userController.getAllUsers);
router.get('/deleted', authorize('admin', 'SuperAdmin'), userController.getDeletedUsers);
router.put('/restore/:id', authorize('admin', 'SuperAdmin'), userController.restoreUser);
router.get('/search', authorize('admin', 'hr', 'manager', 'SuperAdmin'), userController.searchUsers);
router.get('/:id', authorize('admin', 'hr', 'manager', 'SuperAdmin'), userController.getUser);
router.put('/:id', authorize('admin', 'hr', 'manager', 'SuperAdmin'), userController.updateUser);
router.delete('/:id', authorize('admin', 'SuperAdmin'), userController.deleteUser);

module.exports = router;