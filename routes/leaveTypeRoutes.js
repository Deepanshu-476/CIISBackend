const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const controller = require("../controllers/leavePolicyController");

const router = express.Router();
router.use(protect);
router.route("/").get(controller.getLeaveTypes).post(controller.createLeaveType);
router.delete("/:id", controller.deleteLeaveType);

module.exports = router;
