const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { requirePayrollPagePermission } = require("../middleware/payrollPagePermission");
const controller = require("../controllers/salaryComponentController");

const router = express.Router();
router.use(protect);
router.get("/", requirePayrollPagePermission("/ciisUser/salary-component", "view"), controller.list);
router.post("/", requirePayrollPagePermission("/ciisUser/salary-component", "edit"), controller.create);
router.put("/:id", requirePayrollPagePermission("/ciisUser/salary-component", "edit"), controller.update);
router.delete("/:id", requirePayrollPagePermission("/ciisUser/salary-component", "delete"), controller.remove);

module.exports = router;
