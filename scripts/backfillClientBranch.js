const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Client = require('../HR-CDS/models/Client');
const User = require('../models/User');
const Company = require('../models/Company');
const Branch = require('../models/Branch');

const args = new Set(process.argv.slice(2));
const applyChanges = args.has('--apply');
const dryRun = !applyChanges || args.has('--dry-run');

const normalizeText = (value) => String(value || '').trim();
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ''));
const toObjectIdString = (value) => (isValidObjectId(value) ? String(value) : '');

const pickFirstValidId = (values = []) => {
  for (const value of values) {
    const id = toObjectIdString(value);
    if (id) return id;
  }
  return '';
};

const getUserBranchCandidate = (user) => pickFirstValidId([
  user?.branch,
  ...(Array.isArray(user?.assignedBranches) ? user.assignedBranches : [])
]);

const companyCache = new Map();

const getCompanyContext = async (companyCode) => {
  const normalizedCompanyCode = normalizeText(companyCode).toUpperCase();
  if (!normalizedCompanyCode) return null;

  if (companyCache.has(normalizedCompanyCode)) {
    return companyCache.get(normalizedCompanyCode);
  }

  const company = await Company.findOne({ companyCode: normalizedCompanyCode }).lean();
  if (!company) {
    companyCache.set(normalizedCompanyCode, null);
    return null;
  }

  const branches = await Branch.find({
    company: company._id,
    isActive: true
  })
    .sort({ isDefault: -1, createdAt: 1 })
    .lean();

  const defaultBranch = branches.find(branch => branch.isDefault) || branches[0] || null;
  const context = {
    company,
    branches,
    defaultBranchId: defaultBranch ? String(defaultBranch._id) : ''
  };

  companyCache.set(normalizedCompanyCode, context);
  return context;
};

const getLinkedUser = async (client, companyCode) => {
  if (isValidObjectId(client?.userId)) {
    const directUser = await User.findOne({
      _id: client.userId,
      companyCode
    })
      .select('_id email companyCode branch assignedBranches companyRole isActive')
      .lean();

    if (directUser) return directUser;
  }

  const email = normalizeEmail(client?.email);
  if (!email) return null;

  return User.findOne({
    email,
    companyCode
  })
    .select('_id email companyCode branch assignedBranches companyRole isActive')
    .lean();
};

const main = async () => {
  await connectDB();

  const targetQuery = {
    $or: [
      { branch: { $exists: false } },
      { branch: null }
    ]
  };

  const clients = await Client.find(targetQuery)
    .select('_id client company companyCode email userId branch createdAt updatedAt')
    .lean();

  let scanned = 0;
  let updated = 0;
  let skippedNoCompany = 0;
  let skippedNoBranch = 0;
  let skippedAlreadySet = 0;
  let resolvedFromUser = 0;
  let resolvedFromEmail = 0;
  let resolvedFromDefaultBranch = 0;

  for (const client of clients) {
    scanned += 1;

    if (isValidObjectId(client.branch)) {
      skippedAlreadySet += 1;
      continue;
    }

    const companyCode = normalizeText(client.companyCode).toUpperCase();
    if (!companyCode) {
      skippedNoCompany += 1;
      continue;
    }

    const companyContext = await getCompanyContext(companyCode);
    if (!companyContext) {
      skippedNoCompany += 1;
      continue;
    }

    const linkedUser = await getLinkedUser(client, companyCode);
    let branchId = getUserBranchCandidate(linkedUser);
    let source = branchId ? 'user' : '';

    if (!branchId && companyContext.defaultBranchId) {
      branchId = companyContext.defaultBranchId;
      source = 'default_branch';
    }

    if (!branchId) {
      skippedNoBranch += 1;
      continue;
    }

    if (!applyChanges) {
      if (source === 'user' && normalizeEmail(client.email)) {
        resolvedFromEmail += linkedUser?.email === normalizeEmail(client.email) ? 1 : 0;
      } else if (source === 'user') {
        resolvedFromUser += 1;
      } else if (source === 'default_branch') {
        resolvedFromDefaultBranch += 1;
      }
      console.log(`[dry-run] client=${client.client} companyCode=${companyCode} branch=${branchId} source=${source}`);
      continue;
    }

    const result = await Client.updateOne(
      { _id: client._id },
      { $set: { branch: branchId } }
    );

    if (result.modifiedCount > 0) {
      updated += 1;
      if (source === 'user') {
        resolvedFromUser += 1;
      } else if (source === 'default_branch') {
        resolvedFromDefaultBranch += 1;
      }
    }
  }

  console.log(JSON.stringify({
    mode: applyChanges ? 'apply' : 'dry-run',
    scanned,
    updated,
    skippedAlreadySet,
    skippedNoCompany,
    skippedNoBranch,
    resolvedFromUser,
    resolvedFromEmail,
    resolvedFromDefaultBranch
  }, null, 2));

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error('Client branch backfill failed:', error);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exitCode = 1;
});
