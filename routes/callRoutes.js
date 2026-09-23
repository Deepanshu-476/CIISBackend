const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const callController = require("../controllers/callController");

router.use(protect);

router.post("/start", callController.startCall);
router.post("/end", callController.endCall);
router.get("/", callController.getAgentCalls);
router.get("/lead/:leadId", callController.getLeadCalls);

module.exports = router;

