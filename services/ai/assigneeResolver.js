const mongoose = require('mongoose');
const User = require('../../models/User');
const Department = require('../../models/Department');

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

  const companyId = requester?.company?._id || requester?.company || requester?.companyId;
  // Fail-closed: company ke bina kabhi search nahi.
  if (!companyId) {
    return { status: 'none', candidates: [] };
  }

  const rawCompanyCode = requester?.companyCode || requester?.company?.companyCode || '';
  const baseCode = typeof rawCompanyCode === 'string' ? rawCompanyCode.split('-')[0].trim() : '';
  const companyCodeFilter = baseCode
    ? { $regex: new RegExp('^' + escapeRegex(baseCode) + '(-|$)', 'i') }
    : (rawCompanyCode || undefined);

  const escapedName = escapeRegex(rawName);
  const nameRegex = new RegExp('(?:^|\\s)' + escapedName, 'i');

  const filter = {
    isActive: true,
    name: { $regex: nameRegex },
    company: companyId,
    ...(companyCodeFilter ? { companyCode: companyCodeFilter } : {}),
  };

  const users = await UserModel.find(filter)
    .select('_id name employeeId jobRole department branch')
    .limit(5)
    .lean();

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

  if (candidates.length > 1) {
    return { status: 'multiple', candidates };
  }

  return { status: 'single', user: candidates[0], candidates };
}

module.exports = {
  resolveAssignee,
  escapeRegex,
};