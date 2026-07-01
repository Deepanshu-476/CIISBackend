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
  searchMeetings,
  markAsViewed,
  markAttendance,
  getViewStatus,
  getMeetingHistory
} = require('../controllers/clientMeetingController');


router.get('/', getMeetings);
router.get('/stats', getMeetingStats);
router.get('/today', getTodayMeetings);
router.get('/search', searchMeetings);
router.get('/history', getMeetingHistory);
router.get('/status/:status', getMeetingsByStatus);
router.get('/view-status/:meetingId', getViewStatus);
router.post('/create', createMeeting);
router.post('/mark-viewed', markAsViewed);
router.post('/attendance', markAttendance);
router.get('/:id', getMeeting);
router.put('/:id', updateMeeting);
router.patch('/:id/status', updateMeetingStatus);
router.delete('/:id', deleteMeeting);


router.get("/test", (req, res) => {
  void 0;
  res.json({
    success: true,
    user: req.user
  });
});

module.exports = router;
