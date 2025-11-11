const express = require("express");
const {
  createMeeting,
  getUserMeetings,
  markAsViewed,
  getViewStatus,
} = require("../controllers/meetingController");

const router = express.Router();

// 🟢 Admin: Create meeting
router.post("/create", createMeeting);

// 👨‍💻 Employee: Get own meetings
router.get("/user/:userId", getUserMeetings);

// 👀 Employee: Mark meeting as viewed
router.post("/mark-viewed", markAsViewed);

// 📊 Admin: Check who viewed the meeting
router.get("/view-status/:meetingId", getViewStatus);

module.exports = router;
