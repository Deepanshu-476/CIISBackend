const express = require('express');
const router = express.Router();
const groupController = require('../controllers/groupController');
const auth = require('../../middleware/authMiddleware');

// Group CRUD operations
router.post('/', auth, groupController.createGroup);
router.get('/', auth, groupController.getGroups);
router.get('/:groupId', auth, groupController.getGroupById);
router.put('/:groupId', auth, groupController.updateGroup);
router.delete('/:groupId', auth, groupController.deleteGroup);
router.post('/:groupId/members', auth, groupController.addMembersToGroup);
router.delete('/:groupId/members/:userId', auth, groupController.removeMemberFromGroup);

// Get groups for task assignment
router.get('/assignable/groups', auth, groupController.getAssignableGroups);

module.exports = router;