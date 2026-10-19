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

const { protect } = require("../../middleware/authMiddleware");

const router = express.Router();

// These routes were mounted without authentication, so anyone could list, edit or delete any
// company's meetings. All handlers now require login and are scoped to the caller's company.
router.use(protect);


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
