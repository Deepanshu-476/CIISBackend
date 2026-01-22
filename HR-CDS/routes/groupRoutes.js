const express = require('express');
const router = express.Router();
const groupController = require('../controllers/groupController');
const { protect, authorize } = require('../../middleware/authMiddleware');

// Group CRUD operations
router.post('/', protect, authorize('admin', 'hr', 'manager'), groupController.createGroup);
router.get('/', protect, groupController.getGroups);
router.get('/:groupId', protect, groupController.getGroupById);
router.put('/:groupId', protect, authorize('admin', 'hr', 'manager'), groupController.updateGroup);
router.delete('/:groupId', protect, authorize('admin', 'hr', 'manager'), groupController.deleteGroup);
router.post('/:groupId/members', protect, authorize('admin', 'hr', 'manager'), groupController.addMembersToGroup);
router.delete('/:groupId/members/:userId', protect, authorize('admin', 'hr', 'manager'), groupController.removeMemberFromGroup);
// Get groups for task assignment
router.get('/assignable/groups', protect, groupController.getAssignableGroups);

module.exports = router;