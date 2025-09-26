const express = require("express");
const router = express.Router();
const auth = require("../middleware/authMiddleware");
const { getDashboardSummary } = require("../controllers/dashboardController");

router.use(auth); // only logged-in users allowed
router.get("/summary", getDashboardSummary);

module.exports = router;



// const express = require("express");
// const router = express.Router();
// const { getDashboardSummary } = require("../controllers/dashboardController");
// const { verifyToken, isAdmin } = require("../middleware/authMiddleware");

// router.get("/summary", verifyToken, isAdmin, getDashboardSummary);

// module.exports = router;

