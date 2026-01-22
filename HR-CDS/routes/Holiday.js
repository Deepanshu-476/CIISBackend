// routes/holidayRoutes.js
const express = require("express");
const router = express.Router();
const holidayController = require("../controllers/HolidayController");
const { protect, authorize } = require('../../middleware/authMiddleware');


// ✅ Add holiday (Manager only)
router.post("/add", protect, authorize('manager'), holidayController.addHoliday);   
// ✅ Get holidays (all users can view, optional month filter => ?month=January)
router.get("/", protect, holidayController.getHolidays);
// routes/holidayRoutes.js
router.put("/:id", protect, authorize('manager'), holidayController.updateHoliday);
router.delete("/:id", protect, authorize('manager'), holidayController.deleteHoliday);

module.exports = router;
