const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const controller = require("../controllers/leavePolicyController");

const router = express.Router();
router.use(protect);
router.get("/applicable", controller.getApplicableLeavePolicies);
router.route("/").get(controller.getLeavePolicies).post(controller.createLeavePolicy);
router.route("/:id").put(controller.updateLeavePolicy).delete(controller.deleteLeavePolicy);

module.exports = router;
