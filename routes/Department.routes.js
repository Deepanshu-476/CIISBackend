
const express = require("express");
const router = express.Router();
const departmentController = require("../controllers/departmentController");
const { protect, authorize } = require("../middleware/authMiddleware");
const { requirePageAccess } = require("../middleware/pageAccess");

const DEPARTMENT_PAGES = ["/ciisUser/department", "/Ciis-network/department", "department"];
const canEditDepartments = requirePageAccess({ paths: DEPARTMENT_PAGES, action: "edit", fallbackRoles: ["admin", "hr"], label: "Department Management" });
const canDeleteDepartments = requirePageAccess({ paths: DEPARTMENT_PAGES, action: "delete", fallbackRoles: ["admin", "hr"], label: "Department Management" });


router.use(protect);


router.get("/", departmentController.getAllDepartments);


router.get("/company/:companyId", departmentController.getDepartmentsByCompany);
router.get("/by-company/:companyId", departmentController.getDepartmentsByCompany);
router.get("/code/:companyCode", departmentController.getDepartmentsByCompany);
router.get("/company-code/:companyCode", departmentController.getDepartmentsByCompany);


router.post("/", canEditDepartments, departmentController.createDepartment);


router.put("/:id", canEditDepartments, departmentController.updateDepartment);


router.delete("/:id", canDeleteDepartments, departmentController.deleteDepartment);


module.exports = router;
