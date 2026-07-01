const express = require("express");
const {
  createMeeting,
  updateMeeting,
  getUserMeetings,
  markAsViewed,
  getViewStatus,
  getAllMeetings,   
  deleteMeeting,
} = require("../controllers/meetingController");

const router = express.Router();


router.post("/create", createMeeting);


router.put("/:meetingId", updateMeeting);

router.delete("/:meetingId", deleteMeeting);


router.get("/user/:userId", getUserMeetings);


router.post("/mark-viewed", markAsViewed);


router.get("/view-status/:meetingId", getViewStatus);


router.get("/", getAllMeetings);  
router.get("/test", (req, res) => {
  void 0;
  res.json({
    success: true,
    user: req.user
  });
});
module.exports = router;
