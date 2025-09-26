// routes/holidayRoutes.js
const express = require("express");
const router = express.Router();
const holidayController = require("../controllers/HolidayController");
const auth = require("../../middleware/authMiddleware");
const isManager = require("../../middleware/isManager"); 

// ✅ Add holiday (Manager only)
router.post("/add", auth, isManager, holidayController.addHoliday);

// ✅ Get holidays (all users can view, optional month filter => ?month=January)
router.get("/", auth, holidayController.getHolidays);
// routes/holidayRoutes.js
router.put("/:id", auth, isManager, holidayController.updateHoliday);
router.delete("/:id", auth, isManager, holidayController.deleteHoliday);

module.exports = router;
