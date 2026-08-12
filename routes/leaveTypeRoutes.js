const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const controller = require("../controllers/leavePolicyController");

const router = express.Router();
router.use(protect);
router.route("/").get(controller.getLeaveTypes).post(controller.requireLeavePolicyEdit, controller.createLeaveType);
router.delete("/:id", controller.requireLeavePolicyDelete, controller.deleteLeaveType);

module.exports = router;
