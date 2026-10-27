const Company = require('../../models/Company');
const BulkEmailUsage = require('../models/BulkEmailUsage');
const BulkEmailCampaign = require('../models/BulkEmailCampaign');
const BulkEmailContact = require('../models/BulkEmailContact');
const { sendMailWithRotation, assertEmailAccepted, isEmailModuleEnabled } = require('../../services/emailSettingsService');

const PAGE_ID = 'bulk-email';
const MODULE_KEY = 'bulk_email';
const MAX_RECIPIENTS_PER_SEND = 500;
const DEFAULT_LIMITS = { daily: 100, monthly: 2000 };
const EMAIL_PATTERN = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

const istDay = (now = new Date()) => new Date(now.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
const periodsFor = (now = new Date()) => { const day = istDay(now); return { day, month: day.slice(0, 7) }; };

const normalizeEmail = value => String(value || '').trim().toLowerCase();
const isValidEmail = value => EMAIL_PATTERN.test(normalizeEmail(value)) && normalizeEmail(value).length <= 254;

const getLimits = company => ({
  daily: Number.isInteger(company?.bulkEmailLimits?.daily) ? company.bulkEmailLimits.daily : DEFAULT_LIMITS.daily,
  monthly: Number.isInteger(company?.bulkEmailLimits?.monthly) ? company.bulkEmailLimits.monthly : DEFAULT_LIMITS.monthly,
});

const getUsage = async (companyId, now = new Date()) => {
  const { day, month } = periodsFor(now);
  const docs = await BulkEmailUsage.find({ company: companyId, period: { $in: [day, month] } }).lean();
  const count = period => docs.find(doc => doc.period === period)?.count || 0;
  return { day, month, daily: count(day), monthly: count(month) };
};

const ensureUsageDoc = async (companyId, period) => {
  try {
    await BulkEmailUsage.updateOne({ company: companyId, period }, { $setOnInsert: { count: 0 } }, { upsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
};

// Reserve `n` sends against both limits in one step each, so two parallel sends cannot both pass.
const reserve = async (companyId, n, limits, now = new Date()) => {
  const { day, month } = periodsFor(now);
  await ensureUsageDoc(companyId, day);
  await ensureUsageDoc(companyId, month);
  const daily = await BulkEmailUsage.findOneAndUpdate(
    { company: companyId, period: day, count: { $lte: limits.daily - n } }, { $inc: { count: n } }, { new: true });
  if (!daily) return { ok: false, reason: 'daily' };
  const monthly = await BulkEmailUsage.findOneAndUpdate(
    { company: companyId, period: month, count: { $lte: limits.monthly - n } }, { $inc: { count: n } }, { new: true });
  if (!monthly) {
    await BulkEmailUsage.updateOne({ company: companyId, period: day }, { $inc: { count: -n } });
    return { ok: false, reason: 'monthly' };
  }
  return { ok: true, day, month };
};

// Failed sends do not use up the quota.
const release = async (companyId, n, { day, month }) => {
  if (n <= 0) return;
  await BulkEmailUsage.updateMany({ company: companyId, period: { $in: [day, month] } }, { $inc: { count: -n } });
};

const escapeHtml = value => String(value || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const paragraphs = text => escapeHtml(text).split(/\n{2,}/).map(block => `<p style="margin:0 0 14px;line-height:1.6;">${block.replace(/\n/g, '<br>')}</p>`).join('');
const safeUrl = url => (/^https?:\/\//i.test(String(url || '').trim()) ? String(url).trim() : '');

const buildSimpleHtml = ({ heading, subheading, body, buttonText, buttonUrl, footer }, companyName = '') => {
  const button = buttonText && safeUrl(buttonUrl)
    ? `<p style="margin:22px 0;"><a href="${escapeHtml(safeUrl(buttonUrl))}" style="background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block;">${escapeHtml(buttonText)}</a></p>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">
${companyName ? `<div style="background:#1e3a8a;color:#ffffff;padding:14px 24px;font-weight:700;">${escapeHtml(companyName)}</div>` : ''}
<div style="padding:28px 24px;">
${heading ? `<h1 style="margin:0 0 8px;font-size:24px;">${escapeHtml(heading)}</h1>` : ''}
${subheading ? `<p style="margin:0 0 20px;color:#475569;font-size:15px;">${escapeHtml(subheading)}</p>` : ''}
${paragraphs(body)}
${button}
</div>
${footer ? `<div style="padding:16px 24px;background:#f8fafc;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0;">${paragraphs(footer)}</div>` : ''}
</div></body></html>`;
};

// {{name}} and {{email}} are replaced per recipient in every mode.
const personalize = (text, recipient, html) => String(text || '')
  .replace(/{{\s*name\s*}}/gi, html ? escapeHtml(recipient.name || '') : (recipient.name || ''))
  .replace(/{{\s*email\s*}}/gi, recipient.email);

const companyHasPage = company => (company?.allowedPages || []).map(String).includes(PAGE_ID);

const deliverCampaign = async (campaignId, { companyName, replyTo, reservation }) => {
  const campaign = await BulkEmailCampaign.findById(campaignId);
  if (!campaign) return;
  let failed = 0;
  for (const recipient of campaign.recipients) {
    const html = personalize(campaign.html, recipient, true);
    const subject = personalize(campaign.subject, recipient, false);
    try {
      const { info, mailOptions } = await sendMailWithRotation(config => ({
        from: `"${String(companyName || config.senderName || 'CIIS NETWORK').replace(/"/g, '')}" <${config.emailUser}>`,
        to: recipient.email,
        subject,
        html,
        ...(replyTo ? { replyTo } : {}),
      }));
      assertEmailAccepted(info, mailOptions.to, subject);
      recipient.status = 'sent';
      recipient.sentAt = new Date();
    } catch (error) {
      failed += 1;
      recipient.status = 'failed';
      recipient.error = String(error.message || 'Send failed').slice(0, 300);
    }
  }
  campaign.sentCount = campaign.recipients.filter(item => item.status === 'sent').length;
  campaign.failedCount = failed;
  campaign.status = 'completed';
  campaign.markModified('recipients');
  await campaign.save();
  await release(campaign.company, failed, reservation);
};

const startCampaign = async ({ user, input }) => {
  const companyId = user.company?._id || user.company;
  const company = await Company.findById(companyId).select('companyName allowedPages bulkEmailLimits').lean();
  if (!company) return { status: 404, message: 'Company not found' };
  if (!companyHasPage(company)) return { status: 403, message: 'Bulk Email is not enabled for your company' };
  if (!await isEmailModuleEnabled(MODULE_KEY)) return { status: 503, message: 'Bulk Email sending is turned off in Email Settings' };

  const mode = input.mode === 'html' ? 'html' : 'simple';
  const subject = String(input.subject || '').trim();
  if (!subject) return { status: 400, message: 'Subject is required' };
  if (mode === 'html' && !String(input.html || '').trim()) return { status: 400, message: 'HTML content is required' };
  if (mode === 'simple' && !String(input.body || '').trim() && !String(input.heading || '').trim()) {
    return { status: 400, message: 'Write a heading or message' };
  }

  const seen = new Map();
  const invalid = [];
  for (const raw of Array.isArray(input.recipients) ? input.recipients : []) {
    const email = normalizeEmail(typeof raw === 'string' ? raw : raw?.email);
    if (!email) continue;
    if (!isValidEmail(email)) { invalid.push(email); continue; }
    if (!seen.has(email)) seen.set(email, { email, name: String(raw?.name || '').trim() });
  }
  if (invalid.length) return { status: 400, message: `Invalid email address: ${invalid.slice(0, 5).join(', ')}` };
  const recipients = [...seen.values()];
  if (!recipients.length) return { status: 400, message: 'Add at least one recipient' };
  if (recipients.length > MAX_RECIPIENTS_PER_SEND) return { status: 400, message: `You can send to at most ${MAX_RECIPIENTS_PER_SEND} people at a time` };

  // Fill names from saved contacts, and save any new addresses as contacts.
  const contacts = await BulkEmailContact.find({ company: companyId, email: { $in: recipients.map(r => r.email) } }).lean();
  const contactNames = new Map(contacts.map(contact => [contact.email, contact.name]));
  recipients.forEach(recipient => { recipient.name = recipient.name || contactNames.get(recipient.email) || ''; });
  const newContacts = recipients.filter(recipient => !contactNames.has(recipient.email));
  if (newContacts.length) {
    await BulkEmailContact.insertMany(
      newContacts.map(recipient => ({ company: companyId, email: recipient.email, name: recipient.name, createdBy: user._id || user.id })),
      { ordered: false }).catch(error => { if (error.code !== 11000 && !error.writeErrors) throw error; });
  }

  const limits = getLimits(company);
  const reservation = await reserve(companyId, recipients.length, limits);
  if (!reservation.ok) {
    const usage = await getUsage(companyId);
    const left = reservation.reason === 'daily' ? Math.max(0, limits.daily - usage.daily) : Math.max(0, limits.monthly - usage.monthly);
    return {
      status: 429,
      message: reservation.reason === 'daily'
        ? `Daily email limit reached: ${left} of ${limits.daily} left today`
        : `Monthly email limit reached: ${left} of ${limits.monthly} left this month`,
    };
  }

  const html = mode === 'html' ? String(input.html) : buildSimpleHtml(input, company.companyName);
  const campaign = await BulkEmailCampaign.create({
    company: companyId,
    sentBy: user._id || user.id,
    sentByName: user.name || '',
    template: input.templateId || null,
    templateName: String(input.templateName || ''),
    mode,
    subject,
    heading: String(input.heading || ''),
    html,
    recipients: recipients.map(recipient => ({ ...recipient, status: 'pending' })),
    status: 'sending',
  });

  // Sending can take a while; the page polls the campaign for progress.
  setImmediate(() => {
    deliverCampaign(campaign._id, { companyName: company.companyName, replyTo: user.email, reservation })
      .catch(error => console.error('[bulk-email] delivery failed', String(campaign._id), error.message));
  });
  return { status: 202, campaign };
};

module.exports = {
  PAGE_ID,
  MAX_RECIPIENTS_PER_SEND,
  normalizeEmail,
  isValidEmail,
  getLimits,
  getUsage,
  reserve,
  release,
  buildSimpleHtml,
  companyHasPage,
  startCampaign,
};
