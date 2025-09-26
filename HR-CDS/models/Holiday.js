const mongoose = require("mongoose");

const holidaySchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    date: {
        type: Date,
        required: true
    },
    month: {
        type: String,
        required: true
    }
});

module.exports = mongoose.model("Holiday", holidaySchema);
