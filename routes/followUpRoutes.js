const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const followupController = require("../controllers/followupController");

router.use(protect);

router.post("/", followupController.createFollowUp);
router.get("/today", followupController.getTodayFollowUps);
router.get("/", followupController.getAgentFollowUps);
router.get("/lead/:leadId", followupController.getLeadFollowUps);
router.patch("/:id/complete", followupController.completeFollowUp);

module.exports = router;

