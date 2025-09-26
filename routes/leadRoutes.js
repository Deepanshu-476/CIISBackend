const express = require("express");
const router = express.Router();
const auth = require("../middleware/authMiddleware");
const {
  createLead,
  getLeads,
  updateLead,
  assignLead,
  addNote
} = require("../controllers/leadController");

router.use(auth); // protect all routes

router.post("/", createLead);
router.get("/", getLeads);
router.patch("/:id", updateLead);
router.patch("/:id/assign", assignLead);
router.post("/:id/notes", addNote);

module.exports = router;
