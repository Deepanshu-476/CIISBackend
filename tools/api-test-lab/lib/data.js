const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const BACKEND_DIR = path.resolve(__dirname, '..', '..', '..');
const STATE_FILE = path.join(__dirname, '..', '.lab-state.json');

// Every dummy record belongs to a company whose code starts with this prefix,
// and every dummy login email ends with LAB_EMAIL_DOMAIN. Delete uses both.
const LAB_CODE_PREFIX = 'ZZLAB';
const LAB_EMAIL_DOMAIN = 'zzlab-test.example.com';
const LAB_PASSWORD = 'ZzLab@12345';

// Collections kept when a new test run resets the previous run's records
// (logins, departments, job roles and the client stay; everything else is redone).
const KEEP_ON_RESET = new Set(['companies', 'users', 'departments', 'jobroles', 'clients', 'services', 'leavetypes', 'leavepolicies']);

const models = () => ({
  Company: require(path.join(BACKEND_DIR, 'models/Company')),
  User: require(path.join(BACKEND_DIR, 'models/User')),
  Department: require(path.join(BACKEND_DIR, 'models/Department')),
});

const readState = () => {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
};

const writeState = (state) => {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  return state;
};

const clearStateFile = () => {
  try { fs.unlinkSync(STATE_FILE); } catch { /* none */ }
};

const describeMongo = (uri = '') => {
  const m = String(uri).match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)\/?([^?]*)/);
  const hosts = m ? m[1] : '?';
  const db = m && m[2] ? m[2] : '(default)';
  const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?(,|$)/.test(hosts);
  return { hosts, db, isLocal };
};

let connectPromise = null;
const connect = async (uri) => {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!connectPromise) {
    connectPromise = mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 }).catch(err => {
      connectPromise = null;
      throw err;
    });
  }
  await connectPromise;
  return mongoose.connection;
};

const randomSuffix = () => Math.random().toString(36).slice(2, 7).toUpperCase();

// Creates only what cannot be created through a normal company API:
// the company itself and its owner login. Everything else is created by the
// test run through the real APIs (so those APIs get tested as well).
const seedCompany = async ({ log = () => {} } = {}) => {
  const { Company, User, Department } = models();
  const code = `${LAB_CODE_PREFIX}${randomSuffix()}`;
  const lower = code.toLowerCase();
  const company = await Company.create({
    companyName: `ZZ Lab Test Co ${code}`,
    companyEmail: `company.${lower}@${LAB_EMAIL_DOMAIN}`,
    companyAddress: 'ZZ Lab dummy address (auto-created by API Test Lab)',
    companyPhone: `9${Date.now().toString().slice(-9)}`,
    ownerName: 'ZZ Lab Owner',
    companyCode: code,
    loginUrl: `/login/${lower}`,
    dbIdentifier: lower,
    isActive: true,
    subscriptionExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  });
  log(`Company ${code} created`);

  const ownerDept = await Department.create({
    name: 'ZZ Management',
    company: company._id,
    companyCode: code,
    workingDays: 7,
  });

  const ownerEmail = `owner.${lower}@${LAB_EMAIL_DOMAIN}`;
  const owner = await User.create({
    name: 'ZZ Lab Owner',
    email: ownerEmail,
    password: LAB_PASSWORD,
    company: company._id,
    companyCode: code,
    department: String(ownerDept._id),
    departmentName: ownerDept.name,
    jobRole: 'owner',
    jobRoleName: 'Owner',
    companyRole: 'owner',
    isActive: true,
    registrationStatus: 'active',
    isVerified: true,
  });
  log(`Owner login ${ownerEmail} created`);

  return writeState({
    createdAt: new Date().toISOString(),
    companyCode: code,
    companyId: String(company._id),
    companyName: company.companyName,
    ownerDeptId: String(ownerDept._id),
    password: LAB_PASSWORD,
    users: {
      owner: { id: String(owner._id), email: ownerEmail, name: owner.name, password: LAB_PASSWORD },
    },
  });
};

const labCompanies = async () => {
  const db = mongoose.connection.db;
  return db.collection('companies')
    .find({ companyCode: { $regex: `^${LAB_CODE_PREFIX}` } })
    .project({ _id: 1, companyCode: 1, companyName: 1 })
    .toArray();
};

const buildCompanyFilter = ({ companyIds, codes, userIds }) => {
  const codeVariants = [...new Set(codes.flatMap(c => [c, c.toLowerCase()]))];
  const idVariants = [...companyIds, ...companyIds.map(String)];
  const userVariants = [...userIds, ...userIds.map(String)];
  const or = [
    { companyCode: { $in: codeVariants } },
    { company: { $in: idVariants } },
    { companyId: { $in: idVariants } },
  ];
  if (userVariants.length) {
    for (const f of ['user', 'userId', 'createdBy', 'sender', 'recipient', 'actor', 'participants', 'members', 'employee']) {
      or.push({ [f]: { $in: userVariants } });
    }
  }
  return { $or: or };
};

// Deletes the dummy data. With keepBase, only the previous run's activity is
// removed (company, users, departments, job roles and the client stay).
const wipe = async ({ keepBase = false, log = () => {} } = {}) => {
  const db = mongoose.connection.db;
  const companies = await labCompanies();
  const companyIds = companies.map(c => c._id);
  const codes = companies.map(c => c.companyCode);
  const users = companyIds.length
    ? await db.collection('users').find({ $or: [{ company: { $in: companyIds } }, { companyCode: { $in: codes } }] }).project({ _id: 1 }).toArray()
    : [];
  const labEmailUsers = await db.collection('users').find({ email: { $regex: `@${LAB_EMAIL_DOMAIN.replace(/\./g, '\\.')}$` } }).project({ _id: 1 }).toArray();
  const userIds = [...new Map([...users, ...labEmailUsers].map(u => [String(u._id), u._id])).values()];

  const removed = {};
  if (!companyIds.length && !userIds.length) {
    log('No dummy data found');
    if (!keepBase) clearStateFile();
    return { removed, companies: [] };
  }

  const filter = buildCompanyFilter({ companyIds, codes, userIds });
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  for (const { name } of collections) {
    if (name.startsWith('system.')) continue;
    if (keepBase && KEEP_ON_RESET.has(name)) continue;
    if (['companies', 'users'].includes(name)) continue; // handled below with exact ids
    try {
      const r = await db.collection(name).deleteMany(filter);
      if (r.deletedCount) removed[name] = r.deletedCount;
    } catch (err) {
      log(`Skip ${name}: ${err.message}`, 'warn');
    }
  }

  // Login OTPs for dummy emails
  const otp = await db.collection('loginotps').deleteMany({ email: { $regex: `@${LAB_EMAIL_DOMAIN.replace(/\./g, '\\.')}$` } }).catch(() => ({ deletedCount: 0 }));
  if (otp.deletedCount) removed.loginotps = (removed.loginotps || 0) + otp.deletedCount;

  if (!keepBase) {
    const u = await db.collection('users').deleteMany({ _id: { $in: userIds } });
    if (u.deletedCount) removed.users = u.deletedCount;
    const c = await db.collection('companies').deleteMany({ _id: { $in: companyIds } });
    if (c.deletedCount) removed.companies = c.deletedCount;
    clearStateFile();
  }

  log(`${keepBase ? 'Reset' : 'Deleted'}: ${Object.entries(removed).map(([k, v]) => `${k}=${v}`).join(', ') || 'nothing'}`);
  return { removed, companies: codes };
};

// Counts what exists for the dummy company (shown on the page).
const inventory = async () => {
  const db = mongoose.connection.db;
  const companies = await labCompanies();
  if (!companies.length) return { companies: [], counts: {} };
  const companyIds = companies.map(c => c._id);
  const codes = companies.map(c => c.companyCode);
  const users = await db.collection('users').find({ company: { $in: companyIds } }).project({ _id: 1 }).toArray();
  const filter = buildCompanyFilter({ companyIds, codes, userIds: users.map(u => u._id) });
  const counts = {};
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  for (const { name } of collections) {
    if (name.startsWith('system.')) continue;
    try {
      const n = name === 'companies'
        ? companies.length
        : await db.collection(name).countDocuments(filter);
      if (n) counts[name] = n;
    } catch { /* ignore */ }
  }
  return { companies: codes, counts };
};

// Pages enabled for the dummy company, the way a super-admin plan enables them:
// every HR page, every CRM admin page and every telecaller page.
const ensureCompanyPages = async (state) => {
  const src = fs.readFileSync(path.join(BACKEND_DIR, 'routes/pagePermissions.js'), 'utf8');
  const hrKeys = [...src.matchAll(/pageKey:\s*'([^']+)'/g)].map(m => m[1]);
  const crmKeys = require(path.join(BACKEND_DIR, 'utils/crmPermissionPages')).map(p => p.pageKey);
  const telecaller = ['dashboard', 'call-dashboard', 'assigned-calls', 'todays-calls', 'pending-calls', 'scheduled-calls', 'completed-calls', 'call-history', 'follow-ups', 'converted-leads', 'call-workspace', 'lead-detail'].map(s => `admin-telecaller-${s}`);
  const pages = [...new Set(['crm', 'admin-crm', 'telecaller', 'dashboard-overview', 'user-dashboard', ...hrKeys, ...crmKeys, ...telecaller])];
  await mongoose.connection.db.collection('companies').updateOne({ companyCode: state.companyCode }, { $set: { allowedPages: pages } });
  return pages.length;
};

// Removes attendance rows of these users for one India day (so a re-run can clock in again).
const removeAttendanceForDay = async (userIds, dayStart, dayEnd) => {
  const db = mongoose.connection.db;
  const ids = userIds.map(id => new mongoose.Types.ObjectId(id));
  return db.collection('attendances').deleteMany({ user: { $in: ids }, date: { $gte: dayStart, $lte: dayEnd } });
};

const readLoginOtp = async (email) => {
  const db = mongoose.connection.db;
  const row = await db.collection('loginotps').find({ email: email.toLowerCase() }).sort({ createdAt: -1 }).limit(1).next();
  return row ? row.otp : null;
};

module.exports = {
  BACKEND_DIR, LAB_CODE_PREFIX, LAB_EMAIL_DOMAIN, LAB_PASSWORD,
  readState, writeState, clearStateFile, describeMongo, connect,
  seedCompany, wipe, inventory, removeAttendanceForDay, readLoginOtp, ensureCompanyPages,
};
