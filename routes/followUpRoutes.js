const express = require("express");
const router = express.Router();
const auth = require("../middleware/authMiddleware");
const { createFollowUp, getTodayFollowUps, completeFollowUp } = require("../controllers/followupController");

router.use(auth);

router.post("/", createFollowUp);
router.get("/today", getTodayFollowUps);
router.patch("/:id/complete", completeFollowUp);

module.exports = router;
