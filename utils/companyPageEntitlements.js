const Company = require('../models/Company');
const Plan = require('../models/Plan');

const aliases = {
  'employee-details': 'emp-details',
  'employee-leaves': 'emp-leaves',
  'employee-assets': 'emp-assets',
  'employee-attendance': 'emp-attendance',
  'job-role-management': 'jobrolemanagement',
  'job-roles': 'jobrolemanagement',
  'companyassets': 'company-assets',
  'asset-management': 'company-assets',
  'company-ai': 'company-ai-settings',
  'company-all-task-tasks': 'company-all-task/tasks',
};

const normalizeKey = value => {
  const key = String(value || '').trim().toLowerCase()
    .replace(/^\/+/, '').replace(/^(ciisuser|ciis-network)\//, '').replace(/\/+$/, '');
  return Object.hasOwn(aliases, key) ? aliases[key] : key;
};

const crmKeys = new Map(require('./crmPermissionPages').map(page => [normalizeKey(page.path), normalizeKey(page.pageKey)]));

const keysFor = values => new Set((Array.isArray(values) ? values : []).map(normalizeKey).filter(Boolean));

const getCompanyPageEntitlements = async companyId => {
  const company = await Company.findById(companyId).select('selectedPlan allowedPages').lean();
  if (!company) return { plan: new Set(), company: new Set() };
  const companyPages = keysFor(company.allowedPages);
  if (!company.selectedPlan) return { plan: companyPages, company: null };
  const plan = await Plan.findById(company.selectedPlan).select('allowedPages').lean();
  return { plan: keysFor(plan?.allowedPages), company: companyPages.size ? companyPages : null };
};

const matchesPage = (keys, page) => {
  const path = normalizeKey(page.path);
  if (keys.has(path) || (page.pageKey && keys.has(normalizeKey(page.pageKey)))) return true;
  // Client Services is a dialog inside Client Management. Keep its existing
  // action grants while deriving subscription eligibility from its parent.
  if (path === 'client-services') return keys.has('emp-client');
  if (path.startsWith('crm/')) return keys.has(crmKeys.get(path)) || keys.has('crm') || keys.has('admin-crm');
  if (path.startsWith('telecaller/')) {
    return ['telecaller', 'admin-telecaller', 'crm'].some(key => keys.has(key)) ||
      keys.has(`admin-telecaller-${path.slice('telecaller/'.length)}`);
  }
  return false;
};

const isPageEntitled = ({plan, company}, page) =>
  matchesPage(plan, page) && (!company || matchesPage(company, page));

module.exports = {getCompanyPageEntitlements, isPageEntitled, normalizePageEntitlementKey: normalizeKey};
