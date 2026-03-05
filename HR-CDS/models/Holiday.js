const mongoose = require("mongoose");

const holidaySchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, "Holiday title dena zaroori hai"],
        trim: true,
        maxlength: [100, "Title 100 characters se bada nahi ho sakta"]
    },
    date: {
        type: Date,
        required: [true, "Date dena zaroori hai"]
    },
    month: {
        type: String,
        required: [true, "Month dena zaroori hai"],
        enum: [    // Sirf yehi 12 months allow honge
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ]
    },
    description: {
        type: String,
        maxlength: [200, "Description 200 characters se bada nahi ho sakta"]
    },
    company: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Company",
        required: true   // Har holiday kisi na kisi company ka hoga
    },
    companyCode: {
        type: String,
        required: true,
        trim: true
    },
    isActive: {
        type: Boolean,
        default: true    // Soft delete ke liye
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true   // Kis user ne banaya
    }
}, {
    timestamps: true      // createdAt, updatedAt automatically add honge
});

// Ye ensure karega ki ek company me same title + same date ka duplicate holiday na ho
holidaySchema.index({ title: 1, company: 1, date: 1 }, { 
    unique: true,
    partialFilterExpression: { isActive: true }
});

// Fast query ke liye indexes
holidaySchema.index({ company: 1, month: 1, isActive: 1 });
holidaySchema.index({ company: 1, date: 1, isActive: 1 });

module.exports = mongoose.model("Holiday", holidaySchema);