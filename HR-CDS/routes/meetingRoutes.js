import express from "express";
import {
  createMeeting,
  getUserMeetings,
  markAsViewed,
  getViewStatus,
} from "../controllers/meetingController.js";

const router = express.Router();

// Admin: Create meeting
router.post("/create", createMeeting);

// Employee: Get own meetings
router.get("/user/:userId", getUserMeetings);

// Employee: Mark meeting as viewed
router.post("/mark-viewed", markAsViewed);

// Admin: Get who viewed
router.get("/view-status/:meetingId", getViewStatus);

export default router;
