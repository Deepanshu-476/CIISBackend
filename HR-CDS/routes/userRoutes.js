const express = require('express');
const router = express.Router();
const userController = require('../controllers/userControllers');
const auth = require('../../middleware/authMiddleware');
const isHR = require('../../middleware/isHR');
const isAdmin = require('../../middleware/isAdmin');
// Get all users (Admin only)
router.get('/all-users', auth, isAdmin, userController.getAllUsers);
// Update user (Admin only)
router.put('/update-user/:id', auth, isAdmin, userController.updateUser);
// Delete user (Admin only) - Hard delete
router.delete('/delete-user/:id', auth, isAdmin, userController.deleteUser);
// Soft delete user (Admin only) - Optional
router.patch('/deactivate-user/:id', auth, isAdmin, userController.softDeleteUser);
module.exports = router;