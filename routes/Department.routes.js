const express = require("express");
const router = express.Router();
const departmentController = require("../controllers/departmentController");
const auth  = require("../middleware/authMiddleware");

// ✅ Apply authentication middleware to all routes
// router.use(auth);

// ✅ Public routes (authenticated users can view)
router.get("/", departmentController.getAllDepartments);

// ✅ Admin-only routes
router.post("/",auth,departmentController.createDepartment);
router.put("/:id",auth,departmentController.updateDepartment);
router.delete("/:id",auth, departmentController.deleteDepartment);

module.exports = router;