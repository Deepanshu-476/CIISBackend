// routes/branchRoutes.js
const express = require("express");
const router = express.Router();
const branchController = require("../controllers/branchController");

// Standard Branch Routes
router.post("/", branchController.createBranch);
router.get("/company/:companyId", branchController.getAllBranches);
router.get("/:id", branchController.getBranchById);
router.put("/:id", branchController.updateBranch);
router.delete("/:id", branchController.deleteBranch);

module.exports = router;
