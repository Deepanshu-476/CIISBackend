const mongoose = require('mongoose');

// One row per page opened (type "view") or per change a user made (type "action": add, edit,
// delete ...). Read by the company "User Activity" page and the super admin company usage view.
// Rows expire after ACTIVITY_RETENTION_DAYS (default 180).
const RETENTION_DAYS = Math.max(7, parseInt(process.env.ACTIVITY_RETENTION_DAYS, 10) || 180);

const pageActivitySchema = new mongoose.Schema({
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // The user's branches when the row was written, so branch-limited viewers can filter quickly.
  branches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Branch' }],
  type: { type: String, enum: ['view', 'action', 'login'], required: true },
  // Website path pattern of the page, e.g. /ciisUser/emp-leaves (ids replaced by :id).
  path: { type: String, default: '' },
  // For actions: HTTP method and API path pattern, e.g. POST /api/leaves/:id/approve.
  method: { type: String, default: '' },
  endpoint: { type: String, default: '' },
  status: { type: Number },
  source: { type: String, enum: ['web', 'app', 'unknown'], default: 'unknown' },
  // How long the page stayed open (views only; sent by the client when the user leaves it).
  durationMs: { type: Number },
  createdAt: { type: Date, default: Date.now },
}, { versionKey: false });

pageActivitySchema.index({ company: 1, createdAt: -1 });
pageActivitySchema.index({ company: 1, user: 1, createdAt: -1 });
pageActivitySchema.index({ company: 1, path: 1, createdAt: -1 });
pageActivitySchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_DAYS * 24 * 60 * 60 });

module.exports = mongoose.models.PageActivity || mongoose.model('PageActivity', pageActivitySchema);
module.exports.RETENTION_DAYS = RETENTION_DAYS;
