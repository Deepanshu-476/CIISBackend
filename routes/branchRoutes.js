const express = require("express");
const router = express.Router();
const branchController = require("../controllers/branchController");
const { protect } = require("../middleware/authMiddleware");

// All branch routes require authentication
router.use(protect);

router.post("/", branchController.createBranch);
router.get("/company/:companyId", branchController.getAllBranches);
router.get("/:id", branchController.getBranchById);
router.put("/:id", branchController.updateBranch);
router.delete("/:id", branchController.deleteBranch);

module.exports = router;