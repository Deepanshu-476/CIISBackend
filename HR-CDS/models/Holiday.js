const mongoose = require("mongoose");

const holidaySchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, "Holiday title is required"],
        trim: true,
        maxlength: [100, "Title cannot exceed 100 characters"]
    },
    date: {
        type: Date,
        required: [true, "Date is required"]
    },
    month: {
        type: String,
        required: [true, "Month is required"],
        enum: [    // Only these 12 months are allowed.
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ]
    },
    description: {
        type: String,
        maxlength: [200, "Description cannot exceed 200 characters"]
    },
    company: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Company",
        required: true   // Every holiday belongs to a company.
    },
    companyCode: {
        type: String,
        required: true,
        trim: true
    },
    isActive: {
        type: Boolean,
        default: true    // For soft delete.
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true   // User who created the holiday.
    }
}, {
    timestamps: true      // createdAt and updatedAt are added automatically.
});

// Ensures a company cannot have duplicate holidays with the same title and date.
holidaySchema.index({ title: 1, company: 1, date: 1 }, { 
    unique: true,
    partialFilterExpression: { isActive: true }
});

// Indexes for faster queries.
holidaySchema.index({ company: 1, month: 1, isActive: 1 });
holidaySchema.index({ company: 1, date: 1, isActive: 1 });

module.exports = mongoose.model("Holiday", holidaySchema);
