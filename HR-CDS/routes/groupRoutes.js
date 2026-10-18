const express = require('express');
const router = express.Router();
const groupController = require('../controllers/groupController');
const { protect, authorize } = require('../../middleware/authMiddleware');
const upload = require('../chat/middleware/upload');

const uploadGroupImage = (req, res, next) => {
  upload.single('avatar')(req, res, error => {
    if (!error) return next();
    return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      success: false,
      message: error.code === 'LIMIT_FILE_SIZE' ? 'Channel image must be 100 MB or smaller' : error.message,
      error: error.code === 'LIMIT_FILE_SIZE' ? 'Channel image must be 100 MB or smaller' : error.message,
    });
  });
};

router.post('/', protect, uploadGroupImage, groupController.createGroup);
router.get('/', protect, groupController.getGroups);

router.get('/assignable/groups', protect, groupController.getAssignableGroups);
router.get('/:groupId', protect, groupController.getGroupById);
router.put('/:groupId', protect, uploadGroupImage, groupController.updateGroup);
router.delete('/:groupId', protect, groupController.deleteGroup);
router.post('/:groupId/members', protect, groupController.addMembersToGroup);
router.delete('/:groupId/members/:userId', protect, groupController.removeMemberFromGroup);

module.exports = router;
