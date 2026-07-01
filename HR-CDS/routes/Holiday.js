
const express = require("express");
const router = express.Router();
const holidayController = require("../controllers/HolidayController");
const { protect, authorize } = require('../../middleware/authMiddleware');



router.post("/add", protect,  holidayController.addHoliday);   

router.get("/", protect, holidayController.getHolidays);

router.put("/:id", protect,  holidayController.updateHoliday);
router.delete("/:id", protect,  holidayController.deleteHoliday);

module.exports = router;
