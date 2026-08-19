const router = require("express").Router();
const { protect } = require("../middleware/authMiddleware");
const controller = require("../controllers/salaryStructureController");
router.use(protect);
router.get("/", controller.list);
router.post("/", controller.create);
router.put("/:id", controller.update);
router.delete("/:id", controller.remove);
module.exports = router;
