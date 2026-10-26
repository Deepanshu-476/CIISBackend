const mongoose = require('mongoose');

// Lazy cache: pehli baar dashboard open hone par generate, phir sirf DB se serve (0 tokens).
const dailyAiSummarySchema = new mongoose.Schema(
    {
        company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        companyCode: { type: String, required: true, index: true },
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        date: { type: String, required: true, index: true }, // YYYY-MM-DD (Asia/Kolkata)
        kind: { type: String, enum: ['employee_daily', 'executive'], default: 'employee_daily', index: true },
        metrics: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
            alias: 'metricsSnapshot',
        },
        summary: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
            alias: 'summaryText',
        },
        model: { type: String, default: null },
        tokenEstimate: { type: Number, default: 0 },
        generatedAt: { type: Date, default: Date.now },
    },
    { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

dailyAiSummarySchema.index({ company: 1, user: 1, date: 1, kind: 1 }, { unique: true });

module.exports = mongoose.models.DailyAiSummary || mongoose.model('DailyAiSummary', dailyAiSummarySchema);
