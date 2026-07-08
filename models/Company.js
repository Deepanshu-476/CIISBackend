
const mongoose = require("mongoose");
const validator = require("validator");

const companySchema = new mongoose.Schema( 
  {
    companyName: {
      type: String,
      required: [true, "Company name is required"],
      unique: true, 
      trim: true,
      minlength: [2, "Company name must be at least 2 characters"],
      maxlength: [100, "Company name cannot exceed 100 characters"],
    }, 

    companyEmail: {
      type: String,
      required: [true, "Company email is required"],
      unique: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: validator.isEmail,
        message: "Please provide a valid company email",
      },
    },

    companyAddress: {
      type: String,
      required: [true, "Company address is required"],
      trim: true,
    },

    companyPhone: {
      type: String,
      required: [true, "Company phone is required"],
      unique: true,
      trim: true,
    },

    ownerName: {
      type: String,
      required: [true, "Owner name is required"],
      trim: true,
    },

    logo: {
      type: String,
      default: null,
    },

    
    companyCode: {
      type: String,
      unique: true,
      uppercase: true,
      minlength: [3, "Company code must be at least 3 characters"],
      maxlength: [10, "Company code cannot exceed 10 characters"],
    },

    
    loginUrl: {
      type: String,
      unique: true,
       default: function() {
      return `/company/${this.companyCode}/login`;
    }
    },

    
    dbIdentifier: {
      type: String,
      unique: true,
    },

    
    companyDomain: {
      type: String,
      default: null,
    },

    loginToken: {
      type: String,
      default: null,
      select: false,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    deactivatedAt: {
      type: Date,
      default: null,
    },

    subscriptionExpiry: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },

    subscriptionPlan: {
      type: String,
      trim: true,
      default: "Standard",
    },

    selectedPlan: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Plan",
      default: null,
    },

    planFeatures: {
      type: [String],
      default: [],
    },

    planDurationDays: {
      type: Number,
      default: 0,
      min: 0,
    },

    subscriptionAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    subscriptionPaymentStatus: {
      type: String,
      enum: ["paid", "unpaid", "partial", "waived"],
      default: "unpaid",
    },

    subscriptionPayments: {
      type: [{
        amount: {
          type: Number,
          default: 0,
          min: 0,
        },
        paymentDate: {
          type: Date,
          default: Date.now,
        },
        paymentMode: {
          type: String,
          enum: ["cash", "upi", "bank_transfer", "card", "cheque", "other"],
          default: "other",
        },
        transactionId: {
          type: String,
          trim: true,
          default: "",
        },
        status: {
          type: String,
          enum: ["paid", "unpaid", "partial", "waived"],
          default: "paid",
        },
        subscriptionStartDate: Date,
        subscriptionExpiry: Date,
        planName: {
          type: String,
          trim: true,
          default: "Standard",
        },
        notes: {
          type: String,
          trim: true,
          default: "",
        },
        recordedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          default: null,
        },
      }],
      default: [],
    },

    allowedPages: {
      type: [String],
      default: [],
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
            enum: ['normal', 'location', 'image', 'both'],
            default: 'normal'
          }
        }
      }],
      default: [
        { componentId: 'header', componentName: 'Welcome Header', isEnabled: true, sortOrder: 1 },
        { componentId: 'clock-in', componentName: 'Attendance Timer & Clock In', isEnabled: true, sortOrder: 2, settings: { attendanceMode: 'normal' } },
        { componentId: 'stats', componentName: 'Monthly Stats Grid', isEnabled: true, sortOrder: 3 },
        { componentId: 'calendar', componentName: 'Attendance Calendar Grid', isEnabled: true, sortOrder: 4 },
        { componentId: 'activity', componentName: 'Recent Activity Timeline', isEnabled: true, sortOrder: 5 }
      ]
    },

    accessConfiguredAt: {
      type: Date,
      default: null,
    },

    accessUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);


companySchema.pre("save", async function (next) {
  if (!this.isNew) return next();

  
  if (!this.companyCode) {
    const code = this.companyName
      .replace(/[^a-zA-Z0-9]/g, "")
      .substring(0, 6)
      .toUpperCase();

    this.companyCode = code || `CMP${Date.now().toString().slice(-4)}`;
  }

  
  if (!this.dbIdentifier) {
    this.dbIdentifier = `company_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 9)}`;
  }

  
  if (!this.companyDomain && this.companyEmail) {
    this.companyDomain = this.companyEmail.split("@")[1];
  }

  
  if (!this.loginUrl) {
    const urlCode = this.companyName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .substring(0, 20);

    this.loginUrl = `/company/${urlCode}-${Date.now().toString(36)}/login`;
  }

  next();
});



module.exports = mongoose.model("Company", companySchema);
