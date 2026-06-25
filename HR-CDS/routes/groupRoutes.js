const express = require('express');
const router = express.Router();
const groupController = require('../controllers/groupController');
const { protect, authorize } = require('../../middleware/authMiddleware');

// Group CRUD operations
router.post('/', protect, groupController.createGroup);
router.get('/', protect, groupController.getGroups);
// Get groups for task assignment
router.get('/assignable/groups', protect, groupController.getAssignableGroups);
router.get('/:groupId', protect, groupController.getGroupById);
router.put('/:groupId', protect, groupController.updateGroup);
router.delete('/:groupId', protect, groupController.deleteGroup);
router.post('/:groupId/members',  groupController.addMembersToGroup);
router.delete('/:groupId/members/:userId', groupController.removeMemberFromGroup);

module.exports = router;
