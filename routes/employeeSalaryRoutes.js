const router = require("express").Router();
const { protect } = require("../middleware/authMiddleware");
const { requirePayrollPagePermission, requireAnyPayrollPagePermission } = require("../middleware/payrollPagePermission");
const controller = require("../controllers/employeeSalaryController");

router.use(protect);

const assignmentView = requirePayrollPagePermission("/ciisUser/salary-assignment", "view");
const assignmentEdit = requirePayrollPagePermission("/ciisUser/salary-assignment", "edit");
const assignmentDelete = requirePayrollPagePermission("/ciisUser/salary-assignment", "delete");
const processView = requirePayrollPagePermission("/ciisUser/payroll-process", "view");
const processEdit = requirePayrollPagePermission("/ciisUser/payroll-process", "edit");
const processGenerate = requirePayrollPagePermission("/ciisUser/payroll-process", "generate");
const processLock = requirePayrollPagePermission("/ciisUser/payroll-process", "lock");
const processUnlock = requirePayrollPagePermission("/ciisUser/payroll-process", "unlock");
const payslipView = requirePayrollPagePermission("/ciisUser/payslip", "view");
const payslipEdit = requirePayrollPagePermission("/ciisUser/payslip", "edit");
const payslipOrReportsView = requireAnyPayrollPagePermission(["/ciisUser/payslip", "/ciisUser/payroll-reports", "/ciisUser/payroll-process"], "view");

const processStatusPermission = (req, res, next) => {
  const action = String(req.body?.action || "").trim().toLowerCase();
  if (action === "lock") return processLock(req, res, next);
  if (["unlock", "reopen"].includes(action)) return processUnlock(req, res, next);
  return processEdit(req, res, next);
};

// Branch rule: one employee's salary can be seen / changed only by owner/admin or by
// someone whose branches include that employee.
const EmployeeSalary = require("../models/EmployeeSalary");
const { requireRecordInBranches } = require("../utils/branchScope");
const salaryInBranches = requireRecordInBranches(
  async req => (require("mongoose").isValidObjectId(req.params.id)
    ? (await EmployeeSalary.findById(req.params.id).select("user").lean())?.user
    : null),
  { label: "salaries" }
);
const salaryUserInBranches = requireRecordInBranches(req => req.body?.user, { label: "salaries" });

router.get("/", assignmentView, controller.list);
router.post("/", assignmentEdit, salaryUserInBranches, controller.create);
router.get("/payroll-preview", processView, controller.payrollPreview);
router.get("/payroll-run", processView, controller.getPayrollRun);
router.post("/payroll-run/generate", processGenerate, controller.generatePayrollRun);
router.post("/payroll-run/recalculate-employee", processGenerate, controller.payrollEmployeeBranchGuard, controller.recalculateSingleEmployee);
router.patch("/payroll-run/status", processStatusPermission, controller.payrollCompanyWideGuard, controller.updatePayrollRunStatus);
router.patch("/payroll-run/settings", processEdit, controller.payrollCompanyWideGuard, controller.updatePayrollSettings);
router.patch("/payroll-run/employee-status", processStatusPermission, controller.payrollEmployeeBranchGuard, controller.updatePayrollEmployeeStatus);
router.patch("/payroll-run/adjustment", processEdit, controller.payrollEmployeeBranchGuard, controller.addPayrollAdjustment);
router.delete("/payroll-run/adjustment", processEdit, controller.payrollEmployeeBranchGuard, controller.removePayrollAdjustment);
router.get("/payroll-payslips", payslipOrReportsView, controller.getPayrollPayslips);
router.get("/payroll-payslips/history", payslipView, controller.payrollEmployeeBranchGuard, controller.getPayslipHistory);
router.post("/payroll-payslips/email", payslipEdit, controller.payrollEmployeeBranchGuard, controller.emailPayslip);
router.delete("/:id/history/:historyId", assignmentDelete, salaryInBranches, controller.removeHistoryRevision);
const userSalaryViewPermission = (req, res, next) => {
  const isSelf = String(req.user?._id || req.user?.id) === String(req.params.userId);
  if (isSelf) return next();
  return assignmentView(req, res, next);
};

router.get("/user/:userId", userSalaryViewPermission, controller.getByUserId);
router.get("/:id", assignmentView, salaryInBranches, controller.getById);
router.put("/:id", assignmentEdit, salaryInBranches, controller.update);
router.delete("/:id", assignmentDelete, salaryInBranches, controller.remove);

module.exports = router;
