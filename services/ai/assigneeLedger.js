/**
 * services/ai/assigneeLedger.js
 *
 * Single Source of Truth: Name Ledger for Task Assignees (Part A)
 * Supports both task_project AND task_assigned_user.
 *
 * States per entry:
 * - 'open': Name mentioned, pending resolution.
 * - 'resolved': Successfully resolved to a specific user (userId + user object).
 * - 'removed_by_user': Dropped by user (e.g. "Kavya ko chhod do" / "Kavya ko hata do").
 * - 'not_member': User exists in company, but is NOT a member of this project (reported with chips).
 * - 'not_found': Name could not be matched to any user (reported with chips).
 * - 'ambiguous': Multiple exact candidate users matched in allowed pool.
 * - 'fuzzy_suggestions': Fuzzy/phonetic suggestion candidates in allowed pool.
 */

const { idsEqual, phoneticNormalize, calculateSimilarity } = require('./projectResolver');
const { cleanAssigneeName, isValidAssigneeCandidate } = require('./hinglishParser');

function fuzzyTokenMatch(token = '', target = '') {
  const t1 = String(token || '').trim().toLowerCase();
  const t2 = String(target || '').trim().toLowerCase();
  if (!t1 || !t2) return false;
  if (t1 === t2 || t2.includes(t1) || t1.includes(t2)) return true;
  const p1 = phoneticNormalize(t1);
  const p2 = phoneticNormalize(t2);
  if (p1 && p2 && (p1 === p2 || p2.includes(p1) || p1.includes(p2))) return true;
  const firstTok = t2.split(/\s+/)[0] || '';
  if (firstTok && (t1 === firstTok || p1 === phoneticNormalize(firstTok))) return true;
  if (typeof calculateSimilarity === 'function') {
    return calculateSimilarity(t1, t2) >= 0.55 || calculateSimilarity(t1, firstTok) >= 0.55;
  }
  return false;
}

function formatAssigneeLabel(user, role) {
  const name = user?.name || 'User';
  const job = role || user?.jobRole || user?.role || user?.department || 'Member';
  return `${name} — ${job}`;
}

function normalizeToken(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\u0900-\u097F]/g, '');
}

/**
 * Creates an initial ledger array from a list of extracted name strings.
 */
function createLedger(names = []) {
  const ledger = [];
  for (const name of names) {
    const raw = String(name || '').trim();
    if (!raw) continue;
    const norm = normalizeToken(raw);
    if (!norm) continue;
    if (!ledger.some((e) => normalizeToken(e.rawName) === norm)) {
      const display = raw.charAt(0).toUpperCase() + raw.slice(1);
      ledger.push({
        rawName: raw,
        displayName: display,
        status: 'open',
        userId: null,
        user: null,
        candidates: [],
        suggestedUser: null,
      });
    }
  }
  return ledger;
}

/**
 * Merges new name tokens into an existing ledger without clearing or resetting existing entries.
 */
function mergeIntoLedger(existingLedger = [], newNames = []) {
  const ledger = Array.isArray(existingLedger)
    ? existingLedger.map((e) => ({ ...e }))
    : [];

  for (const name of newNames) {
    const raw = String(name || '').trim();
    if (!raw) continue;
    const norm = normalizeToken(raw);
    if (!norm) continue;
    const existing = ledger.find((e) => normalizeToken(e.rawName) === norm);
    if (!existing) {
      const display = raw.charAt(0).toUpperCase() + raw.slice(1);
      ledger.push({
        rawName: raw,
        displayName: display,
        status: 'open',
        userId: null,
        user: null,
        candidates: [],
        suggestedUser: null,
      });
    }
  }
  return ledger;
}

/**
 * Synchronizes ALL derived assignee fields from draft.assigneeLedger.
 * Every other field (assignees, assignedUsers, assigneeId, assigneeName, assigneeLabel,
 * pendingAssigneeNames, allMentionedAssignees, removedAssignees) is derived directly from the ledger.
 */
function syncAssigneeLedgerDerivedFields(draft) {
  if (!draft) return;
  if (!Array.isArray(draft.assigneeLedger)) {
    draft.assigneeLedger = [];
  }

  // Resolved entries that were NOT removed (deduplicated by userId)
  const resolved = draft.assigneeLedger.filter(
    (e) => e.status === 'resolved' && e.userId && e.user
  );

  const seenIds = new Set();
  const uniqueResolved = [];
  for (const e of resolved) {
    const id = String(e.userId);
    if (!seenIds.has(id)) {
      seenIds.add(id);
      uniqueResolved.push(e);
    }
  }

  draft.assignees = uniqueResolved.map((e) => ({
    id: String(e.userId),
    _id: String(e.userId),
    name: e.user.name,
    label: e.user.label || formatAssigneeLabel(e.user, e.user.jobRole || e.user.role || e.user.department),
    department: e.user.department || e.user.jobRole || e.user.role || 'Member',
  }));

  draft.assignedUsers = uniqueResolved.map((e) => String(e.userId));

  if (draft.intent === 'create_project') {
    draft.members = draft.assignees.map((a) => ({
      id: a.id,
      _id: a.id,
      name: a.name,
      label: a.label,
      department: a.department,
    }));
  }

  if (draft.assignees.length === 1) {
    draft.assigneeId = draft.assignees[0].id;
    draft.assigneeName = draft.assignees[0].name;
    draft.assigneeLabel = draft.assignees[0].label;
  } else if (draft.assignees.length > 1) {
    draft.assigneeId = draft.assignees[0].id;
    draft.assigneeName = draft.assignees.map((a) => a.name).join(', ');
    draft.assigneeLabel = draft.assignees.map((a) => a.name).join(', ');
  } else {
    // When no assignees are resolved yet, preserve the mentioned name string from active entries
    const activeEntries = draft.assigneeLedger.filter(
      (e) => e.status !== 'removed_by_user'
    );
    draft.assigneeId = null;
    draft.assigneeName = activeEntries.length > 0
      ? activeEntries.map((e) => e.displayName || e.rawName).join(', ')
      : null;
    draft.assigneeLabel = null;
  }

  // pendingAssigneeNames contains tokens that are not yet resolved or removed
  draft.pendingAssigneeNames = draft.assigneeLedger
    .filter((e) => e.status !== 'resolved' && e.status !== 'removed_by_user')
    .map((e) => e.displayName || e.rawName);

  // allMentionedAssignees
  draft.allMentionedAssignees = draft.assigneeLedger.map((e) => e.displayName || e.rawName);

  // removedAssignees
  draft.removedAssignees = draft.assigneeLedger
    .filter((e) => e.status === 'removed_by_user')
    .map((e) => e.displayName || e.rawName);
}

/**
 * Pre-ready guard:
 * Status can become 'ready' only if:
 * 1. User mentioned no names (self task or unassigned project task), OR
 * 2. User mentioned names AND at least one entry is resolved AND every entry is resolved or removed_by_user.
 */
function isAssigneeLedgerComplete(draft) {
  if (!draft) return true;
  const ledger = Array.isArray(draft.assigneeLedger) ? draft.assigneeLedger : [];
  if (ledger.length === 0) {
    return true;
  }

  // If names were mentioned, every single entry must be resolved or removed_by_user
  const hasIncomplete = ledger.some(
    (e) => e.status !== 'resolved' && e.status !== 'removed_by_user'
  );
  if (hasIncomplete) return false;

  // Must have at least one resolved user if names were in ledger
  const hasResolved = ledger.some((e) => e.status === 'resolved' && e.userId);
  return hasResolved;
}

/**
 * Returns the first ledger entry requiring user input or resolution.
 */
function getFirstUnresolvedLedgerEntry(draft) {
  if (!draft || !Array.isArray(draft.assigneeLedger)) return null;
  return draft.assigneeLedger.find(
    (e) => e.status !== 'resolved' && e.status !== 'removed_by_user'
  ) || null;
}

/**
 * Resolves a ledger entry against an allowed pool of users.
 * - task_project: allowedPool = project.users
 * - task_assigned_user: allowedPool = accessible users in scope
 */
function evaluateLedgerEntry(entry, allowedPool = [], fullCompanyUsers = [], options = {}) {
  if (!entry) return;
  if (entry.status === 'resolved' || entry.status === 'removed_by_user') return;

  const clean = String(entry.rawName || '').trim().toLowerCase();
  if (!clean) return;

  // Deduplicate allowedPool by user ID to prevent false duplicates causing ambiguous match
  const uniquePool = [];
  const seenIds = new Set();
  for (const u of (allowedPool || [])) {
    const uId = String(u._id || u.id || u);
    if (!seenIds.has(uId)) {
      seenIds.add(uId);
      uniquePool.push(u);
    }
  }

  const tokens = clean.split(/\s+/).filter(Boolean);

  // Exact whole-word matches against allowedPool
  const exactMatches = uniquePool.filter((u) => {
    const uName = String(u.name || '').trim().toLowerCase();
    const uEmail = String(u.email || '').trim().toLowerCase();
    const uWords = uName.split(/\s+/).filter(Boolean);
    const isWordMatch = tokens.every((t) => uWords.includes(t)) ||
      (tokens.length === 1 && uWords.some((w) => w === tokens[0])) ||
      clean === uName;
    return isWordMatch || (uEmail && clean === uEmail);
  });

  if (exactMatches.length === 1) {
    const u = exactMatches[0];
    entry.status = 'resolved';
    entry.userId = String(u._id || u.id || u);
    entry.user = {
      id: String(u._id || u.id || u),
      _id: String(u._id || u.id || u),
      name: u.name,
      label: formatAssigneeLabel(u, u.jobRole || u.role || u.department),
      department: u.department || u.jobRole || u.role || 'Member',
    };
    entry.candidates = [];
    entry.suggestedUser = null;
    return;
  }

  if (exactMatches.length > 1) {
    entry.status = 'ambiguous';
    entry.candidates = exactMatches.map((m) => ({
      id: String(m._id || m.id || m),
      _id: String(m._id || m.id || m),
      name: m.name,
      label: formatAssigneeLabel(m, m.jobRole || m.role || m.department),
      department: m.department || m.jobRole || m.role || 'Member',
    }));
    entry.suggestedUser = null;
    return;
  }

  // Check fuzzy / phonetic match in allowedPool
  const phoneticMatches = uniquePool.filter((u) => {
    const uName = String(u.name || '').trim().toLowerCase();
    const uNorm = phoneticNormalize(uName);
    const cleanNorm = phoneticNormalize(clean);
    return fuzzyTokenMatch(clean, uName) || (cleanNorm.length >= 3 && (uNorm.includes(cleanNorm) || cleanNorm.includes(uNorm)));
  });

  if (phoneticMatches.length > 0) {
    const sug = phoneticMatches[0];
    entry.status = 'fuzzy_suggestions';
    entry.suggestedUser = {
      id: String(sug._id || sug.id || sug),
      _id: String(sug._id || sug.id || sug),
      name: sug.name,
      label: formatAssigneeLabel(sug, sug.jobRole || sug.role || sug.department),
      department: sug.department || sug.jobRole || sug.role || 'Member',
    };
    entry.candidates = phoneticMatches.slice(0, 4).map((m) => ({
      id: String(m._id || m.id || m),
      _id: String(m._id || m.id || m),
      name: m.name,
      label: formatAssigneeLabel(m, m.jobRole || m.role || m.department),
      department: m.department || m.jobRole || m.role || 'Member',
    }));
    return;
  }

  // In project task context, any user not in allowed project members is reported as not_member
  if (options.isProject) {
    entry.status = 'not_member';
    entry.candidates = uniquePool.slice(0, 8).map((m) => ({
      id: String(m._id || m.id || m),
      _id: String(m._id || m.id || m),
      name: m.name,
      label: formatAssigneeLabel(m, m.jobRole || m.role || m.department),
      department: m.department || m.jobRole || m.role || 'Member',
    }));
    entry.suggestedUser = null;
    return;
  }

  // Check if name belongs to someone in company who is NOT in allowedPool
  if (Array.isArray(fullCompanyUsers) && fullCompanyUsers.length > 0) {
    const uniqueCompany = [];
    const seenCompIds = new Set();
    for (const cu of fullCompanyUsers) {
      const cId = String(cu._id || cu.id || cu);
      if (!seenCompIds.has(cId)) {
        seenCompIds.add(cId);
        uniqueCompany.push(cu);
      }
    }

    const companyMatches = uniqueCompany.filter((u) => {
      const uName = String(u.name || '').trim().toLowerCase();
      const uWords = uName.split(/\s+/).filter(Boolean);
      return tokens.every((t) => uWords.includes(t)) ||
        (tokens.length === 1 && uWords.some((w) => w === tokens[0])) ||
        clean === uName;
    });

    if (companyMatches.length > 0) {
      entry.status = 'not_member';
      entry.candidates = uniquePool.slice(0, 8).map((m) => ({
        id: String(m._id || m.id || m),
        _id: String(m._id || m.id || m),
        name: m.name,
        label: formatAssigneeLabel(m, m.jobRole || m.role || m.department),
        department: m.department || m.jobRole || m.role || 'Member',
      }));
      entry.suggestedUser = null;
      return;
    }
  }

  // Not found anywhere
  entry.status = 'not_found';
  entry.candidates = uniquePool.slice(0, 6).map((m) => ({
    id: String(m._id || m.id || m),
    _id: String(m._id || m.id || m),
    name: m.name,
    label: formatAssigneeLabel(m, m.jobRole || m.role || m.department),
    department: m.department || m.jobRole || m.role || 'Member',
  }));
  entry.suggestedUser = null;
}

/**
 * Updates a specific ledger entry from user chip pick or text confirmation.
 * Never resets or rebuilds the ledger.
 */
function updateLedgerWithPick(draft, { assigneeId, name, targetName, pool = [] }) {
  if (!draft) return;
  if (!Array.isArray(draft.assigneeLedger)) draft.assigneeLedger = [];

  let targetEntry = null;
  if (targetName) {
    const targetNorm = normalizeToken(targetName);
    targetEntry = draft.assigneeLedger.find((e) => normalizeToken(e.rawName) === targetNorm || normalizeToken(e.displayName) === targetNorm);
  }
  if (!targetEntry) {
    // Pick first entry that is not yet resolved and not removed
    targetEntry = draft.assigneeLedger.find(
      (e) => e.status !== 'resolved' && e.status !== 'removed_by_user'
    );
  }

  const selectedUser = pool.find((u) => idsEqual(u._id || u.id || u, assigneeId)) || {
    _id: assigneeId,
    id: assigneeId,
    name: name || 'Member',
    department: 'Member',
  };

  const idStr = String(selectedUser._id || selectedUser.id || assigneeId);
  const userObj = {
    id: idStr,
    _id: idStr,
    name: selectedUser.name || name || 'Member',
    label: formatAssigneeLabel(selectedUser, selectedUser.jobRole || selectedUser.role || selectedUser.department),
    department: selectedUser.department || selectedUser.jobRole || selectedUser.role || 'Member',
  };

  if (targetEntry) {
    targetEntry.status = 'resolved';
    targetEntry.userId = idStr;
    targetEntry.user = userObj;
    targetEntry.candidates = [];
    targetEntry.suggestedUser = null;
  } else {
    // If this user is already resolved in the ledger, do not add a duplicate entry
    if (draft.assigneeLedger.some((e) => idsEqual(e.userId, idStr))) {
      syncAssigneeLedgerDerivedFields(draft);
      return;
    }
    // User picked someone not originally in ledger
    draft.assigneeLedger.push({
      rawName: selectedUser.name.toLowerCase(),
      displayName: selectedUser.name,
      status: 'resolved',
      userId: idStr,
      user: userObj,
      candidates: [],
      suggestedUser: null,
    });
  }

  syncAssigneeLedgerDerivedFields(draft);
}

/**
 * Marks an entry as removed_by_user when user clicks "${name} ko chhod do" or says "hata do".
 */
function removeLedgerEntry(draft, { name, userId }) {
  if (!draft || !Array.isArray(draft.assigneeLedger)) return false;

  let target = null;
  if (name) {
    const norm = normalizeToken(name);
    target = draft.assigneeLedger.find(
      (e) => normalizeToken(e.rawName) === norm || normalizeToken(e.displayName) === norm
    );
    if (!target) {
      target = draft.assigneeLedger.find(
        (e) => normalizeToken(e.rawName).includes(norm) || norm.includes(normalizeToken(e.rawName))
      );
    }
  } else if (userId) {
    target = draft.assigneeLedger.find((e) => idsEqual(e.userId, userId));
  }

  if (target) {
    target.status = 'removed_by_user';
    syncAssigneeLedgerDerivedFields(draft);
    return true;
  }
  return false;
}

/**
 * Builds standard reply, speech, and chip options for an unresolved ledger entry.
 */
function buildUnresolvedEntryPrompt(entry, resolvedPrefixHinglish = '', resolvedPrefixHindi = '') {
  const name = entry?.displayName || entry?.rawName || 'Member';
  const chips = [];

  if (entry.status === 'not_member') {
    (entry.candidates || []).slice(0, 5).forEach((c) => {
      chips.push({
        label: c.label || `${c.name} (${c.jobRole || c.department || 'Member'})`,
        action: { type: 'set', field: 'assignee', value: c.name, assigneeId: String(c.id || c._id) },
      });
    });
    chips.push({
      label: `${name} ko chhod do`,
      action: { type: 'remove_pending_assignee', name: entry.rawName },
    });
    chips.push({ label: 'Cancel', action: { type: 'cancel' } });

    const reply = `${resolvedPrefixHinglish}${name} is project ke member nahi hain. Kripya project members mein se chunein ya unhe chhod dein:`;
    const speech = `${resolvedPrefixHindi}${name} इस प्रोजेक्ट के सदस्य नहीं हैं। कृपया प्रोजेक्ट मेंबर चुनें या उन्हें छोड़ दें।`;
    return { status: 'needs_input', reply, speech, chips, field: 'assignee' };
  }

  if (entry.status === 'fuzzy_suggestions') {
    if (entry.suggestedUser) {
      chips.push({
        label: `Haan, ${entry.suggestedUser.name}`,
        action: {
          type: 'set',
          field: 'assignee',
          value: entry.suggestedUser.name,
          assigneeId: String(entry.suggestedUser.id || entry.suggestedUser._id),
        },
      });
    }
    (entry.candidates || []).slice(0, 4).forEach((c) => {
      if (!entry.suggestedUser || !idsEqual(c.id || c._id, entry.suggestedUser.id || entry.suggestedUser._id)) {
        chips.push({
          label: c.label || `${c.name} (${c.jobRole || c.department || 'Member'})`,
          action: { type: 'set', field: 'assignee', value: c.name, assigneeId: String(c.id || c._id) },
        });
      }
    });
    chips.push({
      label: `${name} ko chhod do`,
      action: { type: 'remove_pending_assignee', name: entry.rawName },
    });
    chips.push({ label: 'Cancel', action: { type: 'cancel' } });

    const sugName = entry.suggestedUser ? entry.suggestedUser.name : 'member';
    const reply = `${resolvedPrefixHinglish}"${name}" nahi mile. Kya aapka matlab "${sugName}" se tha?`;
    const speech = `${resolvedPrefixHindi}"${name}" नहीं मिले। क्या आपका मतलब "${sugName}" से था?`;
    return { status: 'needs_input', reply, speech, chips, field: 'assignee' };
  }

  if (entry.status === 'ambiguous') {
    (entry.candidates || []).forEach((c) => {
      chips.push({
        label: c.label || `${c.name} (${c.jobRole || c.department || 'Member'})`,
        action: { type: 'set', field: 'assignee', value: c.name, assigneeId: String(c.id || c._id) },
      });
    });
    chips.push({
      label: `${name} ko chhod do`,
      action: { type: 'remove_pending_assignee', name: entry.rawName },
    });
    chips.push({ label: 'Cancel', action: { type: 'cancel' } });

    const reply = `${resolvedPrefixHinglish}"${name}" ke multiple members mile hain. Sahi member chunein:`;
    const speech = `${resolvedPrefixHindi}"${name}" के कई सदस्य मिले हैं। कृपया सही सदस्य चुनें।`;
    return { status: 'needs_disambiguation', reply, speech, chips, field: 'assignee' };
  }

  // status === 'not_found' or other
  (entry.candidates || []).slice(0, 5).forEach((c) => {
    chips.push({
      label: c.label || `${c.name} (${c.jobRole || c.department || 'Member'})`,
      action: { type: 'set', field: 'assignee', value: c.name, assigneeId: String(c.id || c._id) },
    });
  });
  chips.push({
    label: `${name} ko chhod do`,
    action: { type: 'remove_pending_assignee', name: entry.rawName },
  });
  chips.push({ label: 'Cancel', action: { type: 'cancel' } });

  const reply = `${resolvedPrefixHinglish}"${name}" nahi mile. Kripya sahi member chunein ya unhe chhod dein:`;
  const speech = `${resolvedPrefixHindi}"${name}" नहीं मिले। कृपया सही सदस्य चुनें या उन्हें छोड़ दें।`;
  return { status: 'needs_input', reply, speech, chips, field: 'assignee' };
}

module.exports = {
  createLedger,
  mergeIntoLedger,
  syncAssigneeLedgerDerivedFields,
  isAssigneeLedgerComplete,
  getFirstUnresolvedLedgerEntry,
  evaluateLedgerEntry,
  updateLedgerWithPick,
  removeLedgerEntry,
  formatAssigneeLabel,
  buildUnresolvedEntryPrompt,
};
