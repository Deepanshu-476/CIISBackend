const mongoose = require('mongoose');
const User = require('../../models/User');
const Department = require('../../models/Department');
const { levenshtein } = require('./sttNormalizer');

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function resolveAssignee({ name, requester }, deps = {}) {
  const UserModel = deps.User || User;
  const DeptModel = deps.Department || Department;

  const rawName = String(name || '').trim();
  if (!rawName) {
    return { status: 'none', candidates: [] };
  }

  const companyId = requester?.company?._id || requester?.company || requester?.companyId || requester?.companyCode;
  // Fail-closed: company ke bina kabhi search nahi.
  if (!companyId && !Array.isArray(deps.companyUsers)) {
    return { status: 'none', candidates: [] };
  }

  const rawCompanyCode = requester?.companyCode || requester?.company?.companyCode || '';
  const baseCode = typeof rawCompanyCode === 'string' ? rawCompanyCode.split('-')[0].trim() : '';
  const companyCodeFilter = baseCode
    ? { $regex: new RegExp('^' + escapeRegex(baseCode) + '(-|$)', 'i') }
    : (rawCompanyCode || undefined);

  const DEVANAGARI_NAME_MAP = {
    '\u0935\u0902\u0936': 'vansh',
    '\u0915\u093e\u0935\u094d\u092f\u093e': 'kavya',
    '\u0930\u093e\u0939\u0941\u0932': 'rahul',
    '\u0938\u093f\u092e\u0930\u0928': 'simran',
    '\u0917\u094c\u0930\u0935': 'gaurav',
    '\u0906\u0930\u0935': 'aarav',
    '\u0926\u093f\u0935\u094d\u092f\u093e': 'divya',
    '\u092a\u094d\u0930\u093f\u092f\u093e': 'priya',
    '\u0905\u092e\u0928': 'aman',
    '\u0930\u094b\u0939\u093f\u0924': 'rohit',
  };

  const latinName = DEVANAGARI_NAME_MAP[rawName] || rawName;
  const escapedName = escapeRegex(rawName);
  const escapedLatin = escapeRegex(latinName);
  const nameRegex = new RegExp('(?:^|\\s)(?:' + escapedName + '|' + escapedLatin + ')', 'i');

  const filter = {
    isActive: true,
    name: { $regex: nameRegex },
    company: companyId,
    ...(companyCodeFilter ? { companyCode: companyCodeFilter } : {}),
  };

  let users;
  if (Array.isArray(deps.companyUsers)) {
    users = deps.companyUsers.filter((u) => nameRegex.test(u.name));
  } else {
    users = await UserModel.find(filter)
      .select('_id name employeeId jobRole department branch')
      .limit(5)
      .lean();
  }

  let isFuzzy = false;
  if (!users || users.length === 0) {
    let pool = [];
    if (Array.isArray(deps.companyUsers)) {
      pool = deps.companyUsers;
    } else {
      pool = await UserModel.find({
        isActive: true,
        company: companyId,
        ...(companyCodeFilter ? { companyCode: companyCodeFilter } : {}),
      })
        .select('_id name employeeId jobRole department branch')
        .limit(25)
        .lean();
    }

    const target = (latinName || rawName).trim().toLowerCase();
    const fuzzyCandidates = (pool || []).filter((u) => {
      const first = (u.name || '').trim().split(/\s+/)[0].toLowerCase();
      const dist = levenshtein(target, first);
      return dist <= 1 || (target.length >= 4 && dist <= 2);
    });

    if (fuzzyCandidates.length > 0) {
      users = fuzzyCandidates;
      isFuzzy = true;
    }
  }

  if (!users || users.length === 0) {
    return { status: 'none', candidates: [] };
  }

  const deptIdsToLookup = users
    .map((u) => String(u.department || ''))
    .filter((d) => mongoose.Types.ObjectId.isValid(d));

  const deptMap = new Map();
  if (deptIdsToLookup.length > 0) {
    const deptDocs = await DeptModel.find({
      _id: { $in: deptIdsToLookup },
      company: companyId,
    })
      .select('_id name departmentName')
      .lean();
    (deptDocs || []).forEach((d) => {
      deptMap.set(String(d._id), d.name || d.departmentName || '');
    });
  }

  const candidates = users.map((u) => {
    let deptDisplay = String(u.department || '').trim();
    if (mongoose.Types.ObjectId.isValid(deptDisplay) && deptMap.has(deptDisplay)) {
      deptDisplay = deptMap.get(deptDisplay);
    }
    const id = String(u._id || u.id);
    const cand = {
      id,
      _id: id,
      name: u.name,
      employeeId: u.employeeId || '',
      jobRole: u.jobRole && u.jobRole !== 'user' ? u.jobRole : '',
      department: deptDisplay || 'General',
    };
    const meta = [];
    if (cand.employeeId) meta.push(cand.employeeId);
    if (cand.jobRole) meta.push(cand.jobRole);
    else if (cand.department) meta.push(cand.department);
    cand.label = meta.length > 0 ? `${cand.name} (${meta.join(', ')})` : cand.name;
    return cand;
  });

  if (isFuzzy) {
    return {
      status: 'fuzzy',
      isFuzzy: true,
      suggestedName: candidates[0].name,
      user: candidates[0],
      candidates,
    };
  }

  if (candidates.length > 1) {
    return { status: 'multiple', candidates };
  }

  return { status: 'single', user: candidates[0], candidates };
}

module.exports = {
  resolveAssignee,
  escapeRegex,
};