
const mongoose = require("mongoose");

const branchSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Branch name is required"],
      trim: true,
      maxlength: [100, "Branch name cannot exceed 100 characters"],
    },
        
    branchCode: {  
      type: String,  
      required: [true, "Branch code is required"],
      uppercase: true,
      trim: true,
      minlength: [5, "Branch code must be at least 5 characters"],
      maxlength: [20, "Branch code cannot exceed 20 characters"],
    },

    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Company",
      required: [true, "Company is required"],
      index: true
    },

    companyCode: {
      type: String,
      required: [true, "Company code is required"],
      uppercase: true,
      trim: true,
      index: true
    },

    address: {
      type: String,
      trim: true,
      default: "",
    },

    phone: {
      type: String,
      trim: true,
      default: "",
    },

    officeLocation: {
      latitude: {
        type: Number,
        min: [-90, "Latitude must be between -90 and 90"],
        max: [90, "Latitude must be between -90 and 90"],
        default: null,
      },
      longitude: {
        type: Number,
        min: [-180, "Longitude must be between -180 and 180"],
        max: [180, "Longitude must be between -180 and 180"],
        default: null,
      },
      allowedRadiusMeters: {
        type: Number,
        min: [10, "Allowed radius must be at least 10 meters"],
        max: [10000, "Allowed radius cannot exceed 10000 meters"],
        default: 100,
      },
      allowedRadiusEnabled: {
        type: Boolean,
        default: true,
      },
      updatedAt: {
        type: Date,
        default: null,
      },
    },

    dashboardConfig: {
      type: [{
        componentId: { type: String, required: true },
        componentName: { type: String, required: true },
        isEnabled: { type: Boolean, default: true },
        sortOrder: { type: Number, default: 0 },
        settings: {
          attendanceMode: {
            type: String,
            enum: ["normal", "location", "image", "both"],
            default: "normal"
          }
        }
      }],
      default: [
        { componentId: "header", componentName: "Welcome Header", isEnabled: true, sortOrder: 1 },
        { componentId: "clock-in", componentName: "Attendance Timer & Clock In", isEnabled: true, sortOrder: 2, settings: { attendanceMode: "normal" } },
        { componentId: "stats", componentName: "Monthly Stats Grid", isEnabled: true, sortOrder: 3 },
        { componentId: "calendar", componentName: "Attendance Calendar Grid", isEnabled: true, sortOrder: 4 },
        { componentId: "activity", componentName: "Recent Activity Timeline", isEnabled: true, sortOrder: 5 }
      ]
    },

    isDefault: {
      type: Boolean,
      default: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);


branchSchema.index({ name: 1, company: 1 }, { unique: true });


branchSchema.index({ branchCode: 1, company: 1 }, { unique: true });

module.exports = mongoose.model("Branch", branchSchema);
