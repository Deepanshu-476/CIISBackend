const mongoose = require('mongoose');

/**
 * How breaks work for a company, a branch, a department or a shift. The same shape sits on all four;
 * the most specific one that is not "INHERIT" applies to an employee (see HR-CDS/utils/breaks.js).
 *
 *   OFF       breaks are not tracked at all — the default, so nothing changes until it is set up
 *   FIXED     everyone breaks at the same time; the windows below are deducted on their own
 *   FLEXIBLE  everyone punches their own breaks, and the admin is notified each time
 */
const fixedBreakSchema = new mongoose.Schema({
  name: { type: String, trim: true, default: 'Break', maxlength: 60 },
  // 'HH:mm' in India time.
  start: { type: String, trim: true, required: true },
  end: { type: String, trim: true, required: true },
  // Deduct this window from working time even when nobody presses anything.
  autoDeduct: { type: Boolean, default: true },
}, { _id: false });

const breakLimitsSchema = new mongoose.Schema({
  // The master switch for every number below.
  enabled: { type: Boolean, default: false },
  maxBreaksPerDay: { type: Number, default: 0, min: 0, max: 50 },
  maxMinutesPerDay: { type: Number, default: 0, min: 0, max: 720 },
  // The next break may only start this many minutes after the last one ended.
  minGapMinutes: { type: Number, default: 0, min: 0, max: 720 },
  // One break longer than this is an overstay: the admin and the employee are told once.
  maxSingleBreakMinutes: { type: Number, default: 0, min: 0, max: 480 },
  // WARN: the break starts and everyone is told. BLOCK: the next break is refused.
  enforce: { type: String, enum: ['WARN', 'BLOCK'], default: 'WARN' },
}, { _id: false });

const breakPolicySchema = new mongoose.Schema({
  mode: { type: String, enum: ['INHERIT', 'OFF', 'FIXED', 'FLEXIBLE'], default: 'INHERIT' },
  fixedBreaks: { type: [fixedBreakSchema], default: [] },
  // Fixed companies: may someone take a break outside the scheduled windows?
  allowExtraBreak: { type: Boolean, default: true },
  // Flexible: notify on every break. Fixed: only an extra break is notified.
  notifyAdmin: { type: Boolean, default: true },
  limits: { type: breakLimitsSchema, default: () => ({}) },
  // What a break can be tagged as (Lunch, Tea, Personal…); empty means the default list.
  reasons: { type: [String], default: [] },
  // Must the employee pick a tag before the break starts?
  requireReason: { type: Boolean, default: false },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  updatedAt: { type: Date, default: null },
}, { _id: false });

module.exports = { breakPolicySchema, fixedBreakSchema, breakLimitsSchema };
