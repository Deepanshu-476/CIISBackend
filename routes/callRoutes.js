const express = require("express");
const router = express.Router();
const auth = require("../middleware/authMiddleware");
const { startCall, endCall, getAgentCalls } = require("../controllers/callController");

router.use(auth); // all routes protected

router.post("/start", startCall);
router.post("/end", endCall);
router.get("/", getAgentCalls);

module.exports = router;
