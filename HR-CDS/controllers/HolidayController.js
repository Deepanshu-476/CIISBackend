const Holiday = require("../models/Holiday");

// ✅ Add a holiday
module.exports.addHoliday = async (req, res) => {
    try {
        const { title, date, month } = req.body;

        const newHoliday = new Holiday({ title, date, month });
        await newHoliday.save();

        res.status(201).json({ message: "Holiday added successfully", holiday: newHoliday });
    } catch (error) {
        res.status(500).json({ message: "Something went wrong", error: error.message });
    }
};

// ✅ Get holidays (with optional month filter)
module.exports.getHolidays = async (req, res) => {
    try {
        const { month } = req.query;
        let holidays = month ? await Holiday.find({ month }) : await Holiday.find();

        res.status(200).json({ holidays });
    } catch (error) {
        res.status(500).json({ message: "Failed to fetch holidays", error: error.message });
    }
};

// ✅ Update holiday
module.exports.updateHoliday = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, date, month } = req.body;

        const updatedHoliday = await Holiday.findByIdAndUpdate(
            id,
            { title, date, month },
            { new: true }
        );

        if (!updatedHoliday) {
            return res.status(404).json({ message: "Holiday not found" });
        }

        res.status(200).json({ message: "Holiday updated successfully", holiday: updatedHoliday });
    } catch (error) {
        res.status(500).json({ message: "Failed to update holiday", error: error.message });
    }
};

// ✅ Delete holiday
module.exports.deleteHoliday = async (req, res) => {
    try {
        const { id } = req.params;

        const deletedHoliday = await Holiday.findByIdAndDelete(id);

        if (!deletedHoliday) {
            return res.status(404).json({ message: "Holiday not found" });
        }

        res.status(200).json({ message: "Holiday deleted successfully" });
    } catch (error) {
        res.status(500).json({ message: "Failed to delete holiday", error: error.message });
    }
};
