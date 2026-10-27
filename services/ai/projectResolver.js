/**
 * services/ai/projectResolver.js
 *
 * Deterministic, Tenant-Safe Project & Assignee Resolver for AI Task Agent.
 * Reuses existing projectController access helpers without modifying them.
 * Never creates real database writes; purely deterministic resolution.
 */

const mongoose = require('mongoose');
const { Project: DefaultProjectModel } = require('../../HR-CDS/models/Project');
const User = require('../../models/User');

const normalizeRole = (value = "") => value.toString().trim().toLowerCase().replace(/[_\s]+/g, "-");

const normalizeId = (value) => {
  if (!value) return "";
  if (value._id && value._id !== value) return normalizeId(value._id);
  if (typeof value.toString === "function") return value.toString();
  return String(value);
};

const idsEqual = (left, right) => {
  if (!left || !right) return false;
  const leftId = left._id || left.id || left;
  const rightId = right._id || right.id || right;
  return leftId.toString() === rightId.toString();
};

const isProjectAdmin = (user = {}) => {
  const roles = [user.role, user.jobRole, user.companyRole].map(normalizeRole);
  return roles.some(role => ["admin", "super-admin", "superadmin", "owner"].includes(role));
};

const getUserCompanyId = (user = {}) => {
  const company = user.company;
  if (!company) return user.companyId || null;
  return company._id || company.id || company;
};

const getUserCompanyCode = (user = {}) => String(
  user.companyCode || user.company?.companyCode || ""
).trim().toUpperCase();

const getProjectCompanyCode = (project = {}) => String(
  project.companyCode || project.company?.companyCode || ""
).trim().toUpperCase();

const projectBelongsToUserCompany = (project, user = {}) => {
  const userCompanyId = normalizeId(getUserCompanyId(user));
  const projectCompanyId = normalizeId(project?.company);
  const userCompanyCode = getUserCompanyCode(user);
  const projectCompanyCode = getProjectCompanyCode(project);

  if (projectCompanyId && userCompanyId) return projectCompanyId === userCompanyId;
  if (projectCompanyCode && userCompanyCode) return projectCompanyCode === userCompanyCode;

  return true;
};

const hasProjectAccess = (project, userId, userRole, user = {}) => {
  if (!projectBelongsToUserCompany(project, user)) {
    return false;
  }

  if (isProjectAdmin({ ...user, role: userRole || user.role })) {
    return true;
  }

  const isUserInProject = (project.users || []).some(u =>
    idsEqual(u, userId)
  );

  const isCreator = idsEqual(project.createdBy, userId);

  return isUserInProject || isCreator;
};

const LOCATIVE_REGEX = /\b(?:mein|me|ke\s+andar|ka\s+task|ke\s+liye)\b/i;
const PROJECT_WORD_REGEX = /\bproject\b/i;

function cleanProjectTokens(name = '') {
  return String(name || '')
    .replace(/\b\d{3,}\b/g, '') // remove trailing or embedded numeric IDs
    .replace(/[^\w\s\u0900-\u097F]/g, ' ')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t && t !== 'project' && t.length > 1);
}

function normalizeProjectString(name = '') {
  return String(name || '')
    .replace(/\b\d{3,}\b/g, '')
    .replace(/[^\w\s\u0900-\u097F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function formatCandidateDate(dateVal) {
  if (!dateVal) return 'No date';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return 'No date';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * Levenshtein distance between two strings
 */
function levenshteinDistance(a = '', b = '') {
  const s1 = String(a || '');
  const s2 = String(b || '');
  const m = s1.length;
  const n = s2.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) d[i][0] = i;
  for (let j = 0; j <= n; j += 1) d[0][j] = j;

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost
      );
    }
  }
  return d[m][n];
}

/**
 * Phonetic normalization for Indian English / Hinglish speech recognition:
 * Maps sound-alike letters (v/w, c/k, ph/f, sh/s/ch, etc.)
 */
function phoneticNormalize(str = '') {
  return String(str || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/ph/g, 'f')
    .replace(/w/g, 'v')
    .replace(/ch/g, 'sh')
    .replace(/sh/g, 's')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/k/g, 'c')
    .replace(/q/g, 'c')
    .replace(/z/g, 's')
    .replace(/(.)\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculates string similarity (0 to 1) using normalized and phonetic edit distance.
 */
function calculateSimilarity(a = '', b = '') {
  const s1 = normalizeProjectString(a);
  const s2 = normalizeProjectString(b);
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;

  const maxLen = Math.max(s1.length, s2.length);
  const rawDist = levenshteinDistance(s1, s2);
  const rawSim = 1 - rawDist / maxLen;

  const p1 = phoneticNormalize(s1);
  const p2 = phoneticNormalize(s2);
  const pMaxLen = Math.max(p1.length, p2.length);
  const pDist = levenshteinDistance(p1, p2);
  const pSim = pMaxLen > 0 ? 1 - pDist / pMaxLen : 0;

  return Math.max(rawSim, pSim);
}

/**
 * Tenant-safe retrieval of projects accessible by the current user.
 */
async function getAccessibleProjects(req = {}, deps = {}) {
  if (Array.isArray(deps.accessibleProjects)) {
    return deps.accessibleProjects;
  }
  if (typeof deps.getAccessibleProjects === 'function') {
    return await deps.getAccessibleProjects(req, deps);
  }
  if (mongoose.connection.readyState === 0 && !deps.Project && !deps.ProjectModel) {
    return [];
  }

  const ProjectModel = deps.Project || deps.ProjectModel || DefaultProjectModel;
  const user = req?.user || {};
  const userId = user._id || user.id;

  const companyId = user.company?._id || user.company || user.companyId;
  const companyCode = user.companyCode || user.company?.companyCode;

  const companyFilters = [];
  if (companyId) companyFilters.push({ company: companyId });
  if (companyCode) companyFilters.push({ companyCode });

  if (companyFilters.length === 0 && !userId) {
    return [];
  }

  const isAdmin = isProjectAdmin(user);
  let query;

  if (isAdmin) {
    query = companyFilters.length > 0 ? { $or: companyFilters } : {};
  } else {
    const memberOrCreatorFilter = {
      $or: [
        { users: userId },
        { createdBy: userId },
      ],
    };
    query = companyFilters.length > 0
      ? { $and: [{ $or: companyFilters }, memberOrCreatorFilter] }
      : memberOrCreatorFilter;
  }

  const projects = await ProjectModel.find(query)
    .select('projectName description status startDate endDate users createdBy company companyCode')
    .populate('users', '_id name email role jobRole profileImage')
    .lean();

  // Guard against any leakage via hasProjectAccess
  return projects.filter((p) => hasProjectAccess(p, userId, user.role, user));
}

/**
 * Fuzzy matches accessible projects against query / text.
 * Ignores trailing numeric IDs, accepts partial names, case-insensitive and token-based.
 */
function matchProjects(queryText = '', accessibleProjects = []) {
  if (!queryText || !Array.isArray(accessibleProjects) || accessibleProjects.length === 0) {
    return [];
  }

  const cleanQuery = normalizeProjectString(queryText);
  const queryTokens = cleanProjectTokens(queryText);

  // Exact ID match check if 24 hex chars
  if (/^[a-f\d]{24}$/i.test(queryText.trim())) {
    const exactId = accessibleProjects.filter((p) => String(p._id) === queryText.trim());
    if (exactId.length > 0) return exactId;
  }

  const exactMatches = [];
  const tokenMatches = [];

  for (const proj of accessibleProjects) {
    const cleanProjName = normalizeProjectString(proj.projectName);
    const projTokens = cleanProjectTokens(proj.projectName);

    // 1. Exact or full substring match
    if (cleanQuery === cleanProjName || (cleanProjName.length >= 3 && cleanQuery.includes(cleanProjName))) {
      exactMatches.push(proj);
      continue;
    }

    // 2. Token based matching:
    // If projTokens has tokens (e.g. ['auto', 'import']), check if all of them exist in cleanQuery
    if (projTokens.length > 0) {
      const allTokensInQuery = projTokens.every((token) => cleanQuery.includes(token));
      if (allTokensInQuery) {
        tokenMatches.push(proj);
        continue;
      }
    }

    // 3. Query tokens in project name:
    if (queryTokens.length > 0) {
      const allQueryTokensInProj = queryTokens.every((token) => cleanProjName.includes(token));
      if (allQueryTokensInProj) {
        tokenMatches.push(proj);
      }
    }
  }

  if (exactMatches.length > 0) return exactMatches;
  return tokenMatches;
}

/**
 * Builds candidate chips for multiple project matches.
 * Format: name, status, start date, member count and the last 6 characters of the id.
 */
function buildProjectCandidateChips(projects = []) {
  return projects.map((p) => {
    const last6 = String(p._id || '').slice(-6);
    const memberCount = Array.isArray(p.users) ? p.users.length : 0;
    const dateStr = formatCandidateDate(p.startDate);
    const statusText = p.status ? (p.status.charAt(0).toUpperCase() + p.status.slice(1)) : 'Active';

    return {
      label: `${p.projectName} (${statusText}) • ${dateStr} • ${memberCount} members • #${last6}`,
      value: String(p._id),
      action: {
        type: 'pickProject',
        projectId: String(p._id),
        pickProject: { projectId: String(p._id) },
      },
      project: {
        id: String(p._id),
        name: p.projectName,
        status: p.status,
        memberCount,
        last6,
      },
    };
  });
}

/**
 * Builds chips for accessible projects when none matched (up to 5).
 */
function buildAccessibleProjectChips(projects = [], limit = 5) {
  return projects.slice(0, limit).map((p) => ({
    label: p.projectName,
    value: String(p._id),
    action: {
      type: 'pickProject',
      projectId: String(p._id),
      pickProject: { projectId: String(p._id) },
    },
  }));
}

/**
 * Checks whether distinguishing details (startDate, #last6) are required for a project.
 * Required when accessibleProjects contains 2 or more projects with the same normalized name.
 */
function requiresProjectDistinguishing(project, accessibleProjects = []) {
  if (!project || !Array.isArray(accessibleProjects) || accessibleProjects.length <= 1) {
    return false;
  }
  const cleanName = normalizeProjectString(project.projectName || '');
  if (!cleanName) return false;
  const count = accessibleProjects.filter(
    (p) => normalizeProjectString(p.projectName || '') === cleanName
  ).length;
  return count > 1;
}

/**
 * Resolves project outcome for a turn.
 * Accepts either an options object or positional (query, reqOrDeps, deps).
 */
async function resolveProject(queryOrOptions, reqOrDeps = {}, maybeDeps = {}) {
  let req;
  let message = '';
  let projectNameText = null;
  let pickedProjectId = null;
  let currentProjectId = null;
  let accessibleProjects = null;
  let deps = {};

  if (typeof queryOrOptions === 'string') {
    projectNameText = queryOrOptions;
    message = queryOrOptions;
    req = reqOrDeps?.req || (reqOrDeps?.user ? reqOrDeps : { user: reqOrDeps });
    deps = maybeDeps || {};
  } else if (queryOrOptions && typeof queryOrOptions === 'object') {
    req = queryOrOptions.req;
    message = queryOrOptions.message || '';
    projectNameText = queryOrOptions.projectNameText || null;
    pickedProjectId = queryOrOptions.pickedProjectId || null;
    currentProjectId = queryOrOptions.currentProjectId || null;
    accessibleProjects = queryOrOptions.accessibleProjects || null;
    deps = reqOrDeps || {};
  }

  const allAccessible = accessibleProjects || await getAccessibleProjects(req, deps);

  // 1. Explicit pickProject from client or previous draft
  const targetId = pickedProjectId || currentProjectId;
  if (targetId) {
    const verified = allAccessible.find((p) => idsEqual(p._id, targetId));
    if (verified) {
      return {
        status: 'single',
        project: verified,
        accessibleProjects: allAccessible,
      };
    }
    // If forged or inaccessible id
    return {
      status: 'none',
      reason: 'forbidden_or_not_found',
      reply: 'Chuna gaya project nahi mila ya aapke paas iska access nahi hai.',
      speech: 'चुना गया प्रोजेक्ट नहीं मिला या आपके पास इसका एक्सेस नहीं है।',
      chips: buildAccessibleProjectChips(allAccessible, 5),
      accessibleProjects: allAccessible,
    };
  }

  // 2. Resolve by projectNameText or message
  const textToMatch = projectNameText || message;
  const matches = matchProjects(textToMatch, allAccessible);

  if (matches.length === 1) {
    return {
      status: 'single',
      project: matches[0],
      accessibleProjects: allAccessible,
    };
  }

  if (matches.length > 1) {
    const candidates = matches.map((p) => ({
      ...p,
      memberCount: Array.isArray(p.users) ? p.users.length : (p.memberCount || 0),
      last6: String(p._id || '').slice(-6),
    }));
    return {
      status: 'multiple',
      projects: candidates,
      candidates,
      chips: buildProjectCandidateChips(matches),
      reply: 'Ek se zyada project match hue hain. Kripya sahi project chun lein:',
      speech: 'एक से ज्यादा प्रोजेक्ट मैच हुए हैं। कृपया सही प्रोजेक्ट चुन लें।',
      accessibleProjects: allAccessible,
    };
  }

  // 3. Fuzzy matching fallback using phonetic & Levenshtein similarity
  const fuzzyScored = allAccessible.map((p) => ({
    project: p,
    similarity: Math.max(
      calculateSimilarity(textToMatch, p.projectName),
      calculateSimilarity(textToMatch, cleanProjectTokens(p.projectName).join(' '))
    ),
  })).filter((x) => x.similarity >= 0.55)
    .sort((a, b) => b.similarity - a.similarity);

  if (fuzzyScored.length > 0) {
    const fuzzyProjects = fuzzyScored.map((x) => x.project);
    const candidates = fuzzyProjects.map((p) => ({
      ...p,
      memberCount: Array.isArray(p.users) ? p.users.length : (p.memberCount || 0),
      last6: String(p._id || '').slice(-6),
    }));
    return {
      status: 'multiple',
      projects: candidates,
      candidates,
      chips: buildProjectCandidateChips(fuzzyProjects),
      reply: 'Kya aapka matlab inme se kisi project se tha? Kripya sahi project chun lein:',
      speech: 'क्या आपका मतलब इनमें से किसी प्रोजेक्ट से था? कृपया सही प्रोजेक्ट चुन लें।',
      accessibleProjects: allAccessible,
    };
  }

  // 4. None matched
  return {
    status: 'none',
    reason: 'no_match',
    reply: allAccessible.length > 0
      ? 'Aapke kisi accessible project se match nahi hua. Inme se chun lein ya project ka naam batayein:'
      : 'Aapke account mein abhi koi accessible project nahi hai.',
    speech: allAccessible.length > 0
      ? 'आपके किसी प्रोजेक्ट से मैच नहीं हुआ। इनमें से चुन लें या प्रोजेक्ट का नाम बताएं।'
      : 'आपके अकाउंट में अभी कोई प्रोजेक्ट नहीं है।',
    chips: buildAccessibleProjectChips(allAccessible, 5),
    accessibleProjects: allAccessible,
  };
}

/**
 * Resolves assignee ONLY against project members.
 */
function resolveProjectAssignee(firstArg = {}, maybeProject = {}, maybeUser = {}, maybeStatus = 'pending') {
  let text = '';
  let project = {};
  let currentUser = {};
  let status = 'pending';

  if (typeof firstArg === 'string') {
    text = firstArg;
    project = maybeProject || {};
    currentUser = maybeUser?.user || maybeUser || {};
    status = maybeStatus;
  } else if (firstArg && typeof firstArg === 'object') {
    text = firstArg.text || '';
    project = firstArg.project || {};
    currentUser = firstArg.currentUser || firstArg.user || {};
    status = firstArg.status || 'pending';
  }

  const members = Array.isArray(project.users) ? project.users : [];
  const cleanText = String(text || '').trim().toLowerCase();

  // Self assignment check: "mujhe" / "mere liye"
  const isSelf = /\b(?:mujhe|mere\s+liye|khud\s+ko|apne\s+ko|me|self)\b/i.test(cleanText);
  if (isSelf) {
    const currentUserId = currentUser._id || currentUser.id;
    const isMember = members.some((m) => idsEqual(m._id || m, currentUserId));
    if (isMember) {
      const currentMember = members.find((m) => idsEqual(m._id || m, currentUserId));
      return {
        status: 'single',
        user: currentMember || currentUser,
      };
    }
    // Not a member!
    const memberChips = members.slice(0, 8).map((m) => ({
      label: m.name,
      action: { type: 'set', field: 'assignee', value: m.name, assigneeId: String(m._id) },
    }));
    if (status !== 'in progress' && status !== 'in-progress') {
      memberChips.push({ label: 'Bina assignee ke', action: { type: 'skip', field: 'assignee' } });
    }
    memberChips.push({ label: 'Cancel', action: { type: 'cancel' } });

    return {
      status: 'not_member',
      reply: 'Aap is project ke member nahi hain, isliye aapko task assign nahi ho sakta. Inme se kisi member ko chunein:',
      speech: 'आप इस प्रोजेक्ट के मेंबर नहीं हैं, इसलिए आपको टास्क असाइन नहीं हो सकता। इनमें से किसी मेंबर को चुनें।',
      chips: memberChips,
    };
  }

  // Check if user named multiple people
  const andSplit = cleanText.split(/\b(?:aur|and|,)\b/).map((s) => s.trim()).filter(Boolean);
  if (andSplit.length > 1) {
    const matchedMembers = members.filter((m) => {
      const mName = String(m.name || '').trim().toLowerCase();
      const firstTok = mName.split(/\s+/)[0];
      return andSplit.some((part) => (
        mName.includes(part) ||
        part.includes(mName) ||
        (firstTok && firstTok.length >= 3 && part.includes(firstTok))
      ));
    });
    if (matchedMembers.length > 1) {
      return {
        status: 'multiple_requested',
        reply: 'Filhal ek baar mein ek hi member ko task assign kar sakte hain. Kripya kisi ek member ko chunein:',
        speech: 'फ़िलहाल एक बार में एक ही मेंबर को टास्क असाइन कर सकते हैं। कृपया किसी एक मेंबर को चुनें।',
        chips: matchedMembers.map((m) => ({
          label: m.name,
          action: { type: 'set', field: 'assignee', value: m.name, assigneeId: String(m._id) },
        })),
      };
    }
  }

  // Name matching against members
  const matched = members.filter((m) => {
    const mName = String(m.name || '').trim().toLowerCase();
    const mEmail = String(m.email || '').trim().toLowerCase();
    return cleanText.includes(mName) || mName.includes(cleanText) || (mEmail && cleanText.includes(mEmail));
  });

  if (matched.length === 1) {
    return {
      status: 'single',
      user: matched[0],
    };
  }

  if (matched.length > 1) {
    return {
      status: 'ambiguous',
      candidates: matched.map((m) => ({
        id: String(m._id),
        name: m.name,
        email: m.email,
        jobRole: m.jobRole || m.role,
      })),
      chips: matched.map((m) => ({
        label: `${m.name} (${m.jobRole || m.role || 'Member'})`,
        action: { type: 'set', field: 'assignee', value: m.name, assigneeId: String(m._id) },
      })),
      reply: `Multiple members mile: "${text}". Kripya sahi member chun lein:`,
      speech: 'कई सदस्य मिले। कृपया सही सदस्य चुन लें।',
    };
  }

  // Fuzzy phonetic match check against members
  const fuzzyMembers = members.map((m) => {
    const mName = String(m.name || '').trim().toLowerCase();
    const firstTok = mName.split(/\s+/)[0] || '';
    const sim = Math.max(
      calculateSimilarity(cleanText, mName),
      calculateSimilarity(cleanText, firstTok)
    );
    return { member: m, similarity: sim };
  }).filter((x) => x.similarity >= 0.55)
    .sort((a, b) => b.similarity - a.similarity);

  if (fuzzyMembers.length > 0) {
    const top = fuzzyMembers[0].member;
    const chips = fuzzyMembers.slice(0, 3).map((fm) => ({
      label: `Haan, ${fm.member.name}`,
      action: { type: 'set', field: 'assignee', value: fm.member.name, assigneeId: String(fm.member._id) },
    }));
    // Also include other members up to 5
    const otherMembers = members.filter((m) => !fuzzyMembers.some((fm) => idsEqual(fm.member._id, m._id))).slice(0, 5);
    otherMembers.forEach((m) => {
      chips.push({
        label: m.name,
        action: { type: 'set', field: 'assignee', value: m.name, assigneeId: String(m._id) },
      });
    });
    if (status !== 'in progress' && status !== 'in-progress') {
      chips.push({ label: 'Bina assignee ke', action: { type: 'skip', field: 'assignee' } });
    }
    chips.push({ label: 'Cancel', action: { type: 'cancel' } });

    return {
      status: 'fuzzy_suggestions',
      suggestedUser: top,
      reply: `Kya aapka matlab "${top.name}" se tha? Ya kisi aur member ko chunein:`,
      speech: `क्या आपका मतलब ${top.name} से था?`,
      chips,
    };
  }

  // Named person is NOT a member
  const memberChips = members.slice(0, 8).map((m) => ({
    label: m.name,
    action: { type: 'set', field: 'assignee', value: m.name, assigneeId: String(m._id) },
  }));
  if (status !== 'in progress' && status !== 'in-progress') {
    memberChips.push({ label: 'Bina assignee ke', action: { type: 'skip', field: 'assignee' } });
  }
  memberChips.push({ label: 'Cancel', action: { type: 'cancel' } });

  const displayName = text || 'Ye person';
  return {
    status: 'not_member',
    reply: `${displayName} is project ke member nahi hain. Kripya kisi existing member ko chunein:`,
    speech: `${displayName} इस प्रोजेक्ट के मेंबर नहीं हैं। कृपया किसी मौजूदा मेंबर को चुनें।`,
    chips: memberChips,
  };
}

module.exports = {
  getAccessibleProjects,
  matchProjects,
  buildProjectCandidateChips,
  buildAccessibleProjectChips,
  resolveProject,
  resolveProjectAssignee,
  cleanProjectTokens,
  normalizeProjectString,
  formatCandidateDate,
  calculateSimilarity,
  phoneticNormalize,
  levenshteinDistance,
  requiresProjectDistinguishing,
  LOCATIVE_REGEX,
  PROJECT_WORD_REGEX,
  hasProjectAccess,
  isProjectAdmin,
  projectBelongsToUserCompany,
  idsEqual,
};
