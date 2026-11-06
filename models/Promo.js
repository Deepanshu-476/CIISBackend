const mongoose = require('mongoose');

// A promotion: images/videos shown as a carousel.
//  scope "platform" = made by the platform owner (Super Admin page)
//    audience "public"    -> login screens, everyone, before login
//    audience "companies" -> popup after login, for allCompanies or the chosen companyIds
//  scope "company"  = made by a company admin, popup after login for that company only
const mediaSchema = new mongoose.Schema({
  url: { type: String, required: true },
  type: { type: String, enum: ['image', 'video'], required: true },
  name: { type: String, default: '' },
  size: { type: Number, default: 0 },
}, { _id: true });

const promoSchema = new mongoose.Schema({
  scope: { type: String, enum: ['platform', 'company'], required: true, index: true },
  audience: { type: String, enum: ['public', 'companies'], required: true },
  // platform + companies: every company, or only companyIds
  allCompanies: { type: Boolean, default: false },
  companyIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Company' }],
  // scope company: the owning company
  company: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true },
  title: { type: String, trim: true, maxlength: 120, default: '' },
  message: { type: String, trim: true, maxlength: 1000, default: '' },
  media: { type: [mediaSchema], default: [] },
  startAt: { type: Date, default: Date.now },
  endAt: { type: Date, required: true, index: true },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastNotifiedAt: { type: Date, default: null },
  lastNotifyResult: { type: Object, default: null },
}, { timestamps: true });

promoSchema.index({ scope: 1, audience: 1, isActive: 1, endAt: 1 });

module.exports = mongoose.model('Promo', promoSchema);
