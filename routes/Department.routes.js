
const express = require("express");
const router = express.Router();
const departmentController = require("../controllers/departmentController");
const { protect, authorize } = require("../middleware/authMiddleware");


router.use(protect);


router.get("/", departmentController.getAllDepartments);


router.get("/company/:companyId", departmentController.getDepartmentsByCompany);
router.get("/by-company/:companyId", departmentController.getDepartmentsByCompany);
router.get("/code/:companyCode", departmentController.getDepartmentsByCompany);
router.get("/company-code/:companyCode", departmentController.getDepartmentsByCompany);


router.post("/", departmentController.createDepartment);


router.put("/:id", departmentController.updateDepartment);


router.delete("/:id", departmentController.deleteDepartment);


module.exports = router;
