const express = require('express');
const router = express.Router();
const {
  getMeetings,
  getMeeting,
  createMeeting,
  updateMeeting,
  deleteMeeting,
  getTodayMeetings,
  getMeetingsByStatus,
  updateMeetingStatus,
  getMeetingStats,
  searchMeetings
} = require('../controllers/clientMeetingController');

// Basic CRUD routes
router.get('/', getMeetings);
router.get('/stats', getMeetingStats);
router.get('/today', getTodayMeetings);
router.get('/search', searchMeetings);
router.get('/status/:status', getMeetingsByStatus);
router.get('/:id', getMeeting);
router.post('/create', createMeeting);
router.put('/:id', updateMeeting);
router.patch('/:id/status', updateMeetingStatus);
router.delete('/:id', deleteMeeting);


router.get("/test", (req, res) => {
  console.log("Debug user info:", req.user);
  res.json({
    success: true,
    user: req.user
  });
});

module.exports = router;