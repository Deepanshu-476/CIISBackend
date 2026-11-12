
const express = require("express");
const router = express.Router();
const holidayController = require("../controllers/HolidayController");
const { protect } = require('../../middleware/authMiddleware');
const { requirePageAccess } = require('../../middleware/pageAccess');

// Owner and company admin always; anyone else needs the "Holiday" page in Page Management
// (Add / Edit for add and update, Delete for delete). Everyone can still read holidays.
const HOLIDAY_PAGES = ['/ciisUser/holiday'];
const holidayAccess = action => requirePageAccess({ paths: HOLIDAY_PAGES, action, alwaysRoles: ['admin'], label: 'Holiday' });



router.post("/add", protect, holidayAccess("edit"), holidayController.addHoliday);   

router.get("/", protect, holidayController.getHolidays);

router.put("/:id", protect, holidayAccess("edit"), holidayController.updateHoliday);
router.delete("/:id", protect, holidayAccess("delete"), holidayController.deleteHoliday);

module.exports = router;
