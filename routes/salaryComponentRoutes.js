const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const controller = require("../controllers/salaryComponentController");

const router = express.Router();
router.use(protect);
router.get("/", controller.list);
router.post("/", controller.create);
router.put("/:id", controller.update);
router.delete("/:id", controller.remove);

module.exports = router;
