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
router.get('/all', authorize('admin', 'hr', 'manager'), userController.getAllUsers);
router.get('/deleted', authorize('admin'), userController.getDeletedUsers);
router.put('/restore/:id', authorize('admin'), userController.restoreUser);
router.get('/search', authorize('admin', 'hr', 'manager'), userController.searchUsers);
router.get('/:id', authorize('admin', 'hr', 'manager'), userController.getUser);
router.put('/:id', authorize('admin', 'hr', 'manager'), userController.updateUser);
router.delete('/:id', authorize('admin'), userController.deleteUser);   
module.exports = router;