const express = require("express");
const {
  createMeeting,
  getUserMeetings,
  markAsViewed,
  getViewStatus,
  getAllMeetings,   
  deleteMeeting,
} = require("../controllers/meetingController");

const router = express.Router();

// 🟢 Create new meeting (Admin)
router.post("/create", createMeeting);

router.delete("/:meetingId", deleteMeeting);

// 👨‍💻 Get meetings assigned to a specific user (Employee)
router.get("/user/:userId", getUserMeetings);

// 🟢 Mark meeting as viewed (Employee)
router.post("/mark-viewed", markAsViewed);

// 🧾 Get who viewed which meeting (Admin)
router.get("/view-status/:meetingId", getViewStatus);

// 🟢 Get all meetings (Admin dashboard)
router.get("/", getAllMeetings);  // ✅ new route added here
router.get("/test", (req, res) => {
  console.log("Debug user info:", req.user);
  res.json({
    success: true,
    user: req.user
  });
});
module.exports = router;
