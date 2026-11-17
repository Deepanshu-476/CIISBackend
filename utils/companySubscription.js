const { endOfIstDay } = require('../HR-CDS/utils/subscriptionDates');

const subscriptionFields = 'companyName companyCode companyEmail companyPhone companyAddress companyDomain ownerName createdAt updatedAt logo isActive subscriptionExpiry subscriptionPlan selectedPlan subscriptionAmount planDurationDays planFeatures allowedPages allowedSuperAdminPages loginUrl dbIdentifier';

const subscriptionState = (company, now = new Date()) => {
  const expiry = company?.subscriptionExpiry ? endOfIstDay(company.subscriptionExpiry) : null;
  const expired = Boolean(expiry && now.getTime() > expiry.getTime());
  return { expired, readOnly: expired, expiresAt: expiry, serverTime: now };
};

const companyDetails = company => company ? {
  ...Object.fromEntries(subscriptionFields.split(' ').map(key => [key, company[key]])),
  _id: company._id,
  allowedPages: company.allowedPages || [],
  allowedSuperAdminPages: company.allowedSuperAdminPages || [],
  subscription: subscriptionState(company),
} : null;

// Session maintenance and passive read receipts must work while the company is read-only.
const isReadOnlyRequest = req => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(String(req.method).toUpperCase())) return true;
  const path = String(req.originalUrl || req.url || '').split('?')[0].replace(/\/$/, '');
  return /\/auth\/(logout|refresh-token|refresh|verify-token)$/.test(path) ||
    /\/notifications\/devices(?:\/[^/]+)?(?:\/(?:register|unregister))?$/.test(path) ||
    /\/activity\/views$/.test(path) ||
    /\/chat\/(?:message\/[^/]+\/seen|messages\/delivered)$/.test(path) ||
    /\/notifications\/(?:[^/]+\/read|read-all|mark-all-read)$/.test(path) ||
    /\/alerts\/(?:[^/]+\/read|mark-all\/read)$/.test(path);
};

const expiredResponse = company => ({
  success: false,
  errorCode: 'SUBSCRIPTION_EXPIRED',
  message: 'Plan expired. You can view your data. Please renew a plan to make changes.',
  subscription: subscriptionState(company),
});

module.exports = { subscriptionFields, subscriptionState, companyDetails, isReadOnlyRequest, expiredResponse };
