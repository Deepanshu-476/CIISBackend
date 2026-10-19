const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const CallLog = require('../models/CallLog');
const FollowUp = require('../models/Followup');
const { getOrSetCached, invalidateCache } = require('../utils/inMemoryCache');
const {
  formatLeadForClient,
  formatCallLogForClient,
  formatFollowUpForClient
} = require('./cascadeSyncEngine');

// Server-side paging, filtering and KPI/option summaries for the CRM admin lists.
// The web and app used to download every lead / call log / follow-up of the company (tens of MB) and
// filter in the browser. A request with ?page or ?limit now gets one page plus `stats` and `options`
// computed over the whole list; requests without them keep the old full response for older app builds.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SUMMARY_TTL_MS = 30 * 1000;
const SUMMARY_CACHE_PREFIX = 'crmList|';

const toObjectId = value => (mongoose.isValidObjectId(String(value)) ? new mongoose.Types.ObjectId(String(value)) : value);
const escapeRegex = value => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactI = value => new RegExp(`^${escapeRegex(String(value).trim())}$`, 'i');
const containsI = value => new RegExp(escapeRegex(String(value).trim()), 'i');
const hasValue = value => value !== undefined && value !== null && String(value).trim() !== '' && !/^all\b/i.test(String(value).trim());

const isPagedRequest = req => req?.query?.page !== undefined || req?.query?.limit !== undefined;

const pageParams = (req, { defaultLimit = 10, maxLimit = 200 } = {}) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(req.query.limit, 10) || defaultLimit));
  return { page, limit, skip: (page - 1) * limit };
};

const istDayStart = (date = new Date()) => {
  const local = new Date(date.getTime() + IST_OFFSET_MS);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - IST_OFFSET_MS);
};

const dayKeyStart = key => (/^\d{4}-\d{2}-\d{2}$/.test(String(key || '')) ? new Date(`${key}T00:00:00+05:30`) : null);

// from / to are YYYY-MM-DD India calendar days, both inclusive.
const dayRange = (from, to) => {
  const range = {};
  const start = dayKeyStart(from);
  const end = dayKeyStart(to);
  if (start) range.$gte = start;
  if (end) range.$lt = new Date(end.getTime() + DAY_MS);
  return Object.keys(range).length ? range : null;
};

const dayBuckets = () => {
  const today = istDayStart();
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const dayAfter = new Date(today.getTime() + 2 * DAY_MS);
  return { today, tomorrow, dayAfter };
};

// today | tomorrow | later (after tomorrow) | upcoming (tomorrow or later) | overdue (before today)
const scheduleRange = schedule => {
  const { today, tomorrow, dayAfter } = dayBuckets();
  switch (String(schedule || '').toLowerCase()) {
    case 'today': return { $gte: today, $lt: tomorrow };
    case 'tomorrow': return { $gte: tomorrow, $lt: dayAfter };
    case 'later':
    case 'future': return { $gte: dayAfter };
    case 'upcoming': return { $gte: tomorrow };
    case 'overdue': return { $lt: today };
    default: return null;
  }
};

const addClause = (filter, clause) => {
  if (!clause) return;
  filter.$and = filter.$and || [];
  filter.$and.push(clause);
};

// "#LD-1A2B" codes shown in the UI are the last characters of the record id.
const leadCodeClause = (query, field = '_id') => {
  const match = String(query || '').trim().match(/^#?ld-?([0-9a-f]{2,24})$/i);
  if (!match) return null;
  return { $expr: { $regexMatch: { input: { $toString: `$${field}` }, regex: `${match[1]}[0-9a-f]{0,6}$`, options: 'i' } } };
};

const searchClause = (query, fields, codeField = '_id') => {
  if (!hasValue(query)) return null;
  const pattern = containsI(query);
  const branches = fields.map(field => ({ [field]: pattern }));
  const code = leadCodeClause(query, codeField);
  if (code) branches.push(code);
  return { $or: branches };
};

// Accepts an id or a display name (older clients filter by name).
const idOrNameClause = (value, idField, nameFields) => {
  if (!hasValue(value)) return null;
  if (mongoose.isValidObjectId(String(value))) return { [idField]: toObjectId(value) };
  return { $or: nameFields.map(field => ({ [field]: exactI(value) })) };
};

const countOf = rows => rows?.[0]?.n || 0;
const toCountMap = rows => (rows || []).reduce((acc, row) => {
  const key = String(row._id ?? '').trim();
  if (key) acc[key] = (acc[key] || 0) + row.n;
  return acc;
}, {});
const sortedNames = rows => [...new Set((rows || []).map(row => String(row._id ?? '').trim()).filter(Boolean))]
  .sort((a, b) => a.localeCompare(b));
const people = rows => (rows || [])
  .filter(row => row._id)
  .map(row => ({ id: String(row._id), name: row.name || '', count: row.n }))
  .sort((a, b) => a.name.localeCompare(b.name));

const cachedSummary = (name, company, extra, loader) => getOrSetCached(
  `${SUMMARY_CACHE_PREFIX}${name}|${company}|${extra || ''}`,
  loader,
  SUMMARY_TTL_MS
);

const invalidateCrmListSummaries = () => invalidateCache(SUMMARY_CACHE_PREFIX);

const sendPage = (res, { items, total, page, limit, stats, options }) => res.json({
  items,
  total,
  page,
  limit,
  pages: Math.max(1, Math.ceil(total / limit)),
  stats,
  options
});

/* ------------------------------------------------------------------ Leads */

const LEAD_SEARCH_FIELDS = ['name', 'phone', 'email', 'assignedToName', 'leadSourceName', 'leadTypeName', 'source', 'remarks', 'customField1'];
const LEAD_DATE_FIELDS = new Set(['assignedAt', 'createdAt', 'updatedAt', 'nextFollowUp']);

const applyLeadFilters = (req, base) => {
  const q = req.query;
  const filter = { ...base };
  if (q.id && mongoose.isValidObjectId(String(q.id))) addClause(filter, { _id: toObjectId(q.id) });
  if (hasValue(q.assignedTo)) {
    if (/^unassigned$/i.test(String(q.assignedTo))) filter.assignedTo = null;
    else addClause(filter, idOrNameClause(q.assignedTo, 'assignedTo', ['assignedToName']));
  }
  addClause(filter, idOrNameClause(q.source, 'leadSource', ['leadSourceName', 'source']));
  addClause(filter, idOrNameClause(q.leadType || q.type, 'leadType', ['leadTypeName']));
  if (hasValue(q.status)) {
    // Lead statuses are a lowercase enum; exact values keep the status indexes usable.
    const statuses = String(q.status).split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
    addClause(filter, { status: { $in: statuses } });
  }
  if (hasValue(q.schedule)) {
    const range = scheduleRange(q.schedule);
    if (range) addClause(filter, { nextFollowUp: range });
  }
  if (hasValue(q.attempts) && Number.isInteger(Number(q.attempts))) {
    addClause(filter, { callHistory: { $size: Number(q.attempts) } });
  }
  if (q.from || q.to) {
    const field = q.dateField === 'leadDate' ? 'leadDate' : (LEAD_DATE_FIELDS.has(q.dateField) ? q.dateField : 'createdAt');
    if (field === 'leadDate') {
      const range = {};
      if (dayKeyStart(q.from)) range.$gte = q.from;
      if (dayKeyStart(q.to)) range.$lte = q.to;
      if (Object.keys(range).length) addClause(filter, { leadDate: range });
    } else {
      const range = dayRange(q.from, q.to);
      if (range) addClause(filter, { [field]: range });
    }
  }
  addClause(filter, searchClause(q.search, LEAD_SEARCH_FIELDS));
  return filter;
};

const leadSummary = async (name, base) => {
  const { today, tomorrow, dayAfter } = dayBuckets();
  const [facet] = await Lead.aggregate([
    { $match: base },
    {
      $facet: {
        total: [{ $count: 'n' }],
        byStatus: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
        assignees: [
          { $match: { assignedTo: { $ne: null } } },
          { $group: { _id: '$assignedTo', name: { $first: '$assignedToName' }, n: { $sum: 1 } } }
        ],
        sources: [{ $group: { _id: { $ifNull: [{ $cond: [{ $gt: ['$leadSourceName', ''] }, '$leadSourceName', '$source'] }, ''] }, n: { $sum: 1 } } }],
        types: [{ $group: { _id: '$leadTypeName', n: { $sum: 1 } } }],
        assignedToday: [{ $match: { assignedAt: { $gte: today, $lt: tomorrow } } }, { $count: 'n' }],
        updatedToday: [{ $match: { updatedAt: { $gte: today, $lt: tomorrow } } }, { $count: 'n' }],
        schedule: [
          { $match: { nextFollowUp: { $ne: null } } },
          {
            $group: {
              _id: {
                $switch: {
                  branches: [
                    { case: { $lt: ['$nextFollowUp', today] }, then: 'overdue' },
                    { case: { $lt: ['$nextFollowUp', tomorrow] }, then: 'today' },
                    { case: { $lt: ['$nextFollowUp', dayAfter] }, then: 'tomorrow' }
                  ],
                  default: 'later'
                }
              },
              n: { $sum: 1 }
            }
          }
        ]
      }
    }
  ]).allowDiskUse(true);

  const schedule = { overdue: 0, today: 0, tomorrow: 0, later: 0, ...toCountMap(facet.schedule) };
  const assignees = people(facet.assignees);
  return {
    stats: {
      total: countOf(facet.total),
      byStatus: toCountMap(facet.byStatus),
      assignees: assignees.length,
      assignedToday: countOf(facet.assignedToday),
      updatedToday: countOf(facet.updatedToday),
      schedule: { ...schedule, upcoming: schedule.tomorrow + schedule.later }
    },
    options: {
      assignees,
      sources: sortedNames(facet.sources),
      types: sortedNames(facet.types),
      statuses: sortedNames(facet.byStatus)
    }
  };
};

const LEAD_PAGE_PROJECTION = [
  {
    $addFields: {
      callAttempts: { $size: { $ifNull: ['$callHistory', []] } },
      lastCallAt: { $arrayElemAt: [{ $ifNull: ['$callHistory.date', []] }, -1] },
      lastCallType: { $arrayElemAt: [{ $ifNull: ['$callHistory.callType', []] }, -1] }
    }
  },
  { $project: { callHistory: 0, notes: 0 } }
];

// name: cache namespace for this list; base: list-defining filter (company + list condition).
const sendLeadPage = async (req, res, { name, base, sort }) => {
  const { page, limit, skip } = pageParams(req);
  const matchBase = { ...base, company: toObjectId(base.company) };
  const filter = applyLeadFilters(req, matchBase);
  const [items, total, summary] = await Promise.all([
    Lead.aggregate([{ $match: filter }, { $sort: sort }, { $skip: skip }, { $limit: limit }, ...LEAD_PAGE_PROJECTION]),
    Lead.countDocuments(filter),
    cachedSummary(name, String(base.company), '', () => leadSummary(name, matchBase))
  ]);
  return sendPage(res, { items: items.map(formatLeadForClient), total, page, limit, ...summary });
};

/* -------------------------------------------------------------- Call logs */

const CALL_SEARCH_FIELDS = ['leadName', 'leadPhone', 'agentName', 'notes', 'leadSourceName', 'leadTypeName', 'status'];
const OUTBOUND = /^(outbound|outgoing)$/i;
const INBOUND = /^(inbound|incoming)$/i;

const applyCallFilters = (req, base) => {
  const q = req.query;
  const filter = { ...base };
  addClause(filter, idOrNameClause(q.agentId || q.agent || q.assignedTo, 'agent', ['agentName']));
  if (hasValue(q.status)) addClause(filter, { status: String(q.status).trim().toLowerCase() });
  if (hasValue(q.callType)) {
    if (OUTBOUND.test(q.callType)) addClause(filter, { $or: [{ callType: OUTBOUND }, { callType: { $in: [null, ''] } }] });
    else if (INBOUND.test(q.callType)) addClause(filter, { callType: INBOUND });
  }
  addClause(filter, idOrNameClause(q.source, 'leadSource', ['leadSourceName']));
  addClause(filter, idOrNameClause(q.leadType || q.type, 'leadType', ['leadTypeName']));
  const range = dayRange(q.from, q.to);
  if (range) addClause(filter, { createdAt: range });
  addClause(filter, searchClause(q.search, CALL_SEARCH_FIELDS, 'lead'));
  return filter;
};

const callSummary = async base => {
  const [facet] = await CallLog.aggregate([
    { $match: base },
    {
      $facet: {
        total: [{ $count: 'n' }],
        byStatus: [{ $group: { _id: '$status', n: { $sum: 1 } } }],
        byCallType: [{ $group: { _id: { $toLower: { $ifNull: ['$callType', 'outbound'] } }, n: { $sum: 1 } } }],
        agents: [{ $group: { _id: '$agent', name: { $first: '$agentName' }, n: { $sum: 1 } } }],
        sources: [{ $group: { _id: '$leadSourceName', n: { $sum: 1 } } }],
        types: [{ $group: { _id: '$leadTypeName', n: { $sum: 1 } } }]
      }
    }
  ]).allowDiskUse(true);
  const callTypes = toCountMap(facet.byCallType);
  const inbound = (callTypes.inbound || 0) + (callTypes.incoming || 0);
  const total = countOf(facet.total);
  return {
    stats: { total, inbound, outbound: total - inbound, byStatus: toCountMap(facet.byStatus) },
    options: {
      agents: people(facet.agents),
      sources: sortedNames(facet.sources),
      types: sortedNames(facet.types),
      statuses: sortedNames(facet.byStatus)
    }
  };
};

const sendCallLogPage = async (req, res, { name, base }) => {
  const { page, limit, skip } = pageParams(req);
  const matchBase = { ...base, company: toObjectId(base.company) };
  const filter = applyCallFilters(req, matchBase);
  const [items, total, summary] = await Promise.all([
    CallLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate({
        path: 'lead',
        select: 'name phone email source leadSource leadSourceName leadType leadTypeName status address gender remarks',
        populate: [{ path: 'leadSource', select: 'name' }, { path: 'leadType', select: 'name' }]
      })
      .populate('agent', 'name email role companyRole jobRole')
      .lean(),
    CallLog.countDocuments(filter),
    cachedSummary(name, String(base.company), '', () => callSummary(matchBase))
  ]);
  return sendPage(res, { items: items.map(formatCallLogForClient), total, page, limit, ...summary });
};

/* -------------------------------------------------------------- Follow-ups */

const DONE_STATUSES = ['done', 'completed'];
const FOLLOW_UP_SEARCH_FIELDS = ['leadName', 'leadPhone', 'agentName', 'note'];

const applyFollowUpFilters = (req, base) => {
  const q = req.query;
  const filter = { ...base };
  addClause(filter, idOrNameClause(q.agent || q.assignedTo, 'agent', ['agentName']));
  // Every follow-up is a telecaller call; other department/type filters match nothing.
  if (hasValue(q.department) && !/^telecaller$/i.test(q.department)) addClause(filter, { _id: null });
  if (hasValue(q.type) && !/^call$/i.test(q.type)) addClause(filter, { _id: null });
  const schedule = String(q.schedule || '').toLowerCase();
  const { today } = dayBuckets();
  if (schedule === 'completed') addClause(filter, { status: { $in: DONE_STATUSES } });
  else if (schedule === 'overdue') addClause(filter, { status: { $nin: DONE_STATUSES }, date: { $lt: today } });
  else if (schedule === 'pending' || schedule === 'all pending') addClause(filter, { status: { $nin: DONE_STATUSES } });
  else {
    const range = scheduleRange(schedule);
    if (range) addClause(filter, { date: range });
  }
  const range = dayRange(q.from, q.to);
  if (range) addClause(filter, { date: range });
  addClause(filter, searchClause(q.search, FOLLOW_UP_SEARCH_FIELDS, 'lead'));
  return filter;
};

const followUpSummary = async base => {
  const { today, tomorrow, dayAfter } = dayBuckets();
  const [facet] = await FollowUp.aggregate([
    { $match: base },
    {
      $facet: {
        total: [{ $count: 'n' }],
        completed: [{ $match: { status: { $in: DONE_STATUSES } } }, { $count: 'n' }],
        pending: [
          { $match: { status: { $nin: DONE_STATUSES } } },
          {
            $group: {
              _id: {
                $switch: {
                  branches: [
                    { case: { $lt: ['$date', today] }, then: 'overdue' },
                    { case: { $lt: ['$date', tomorrow] }, then: 'today' },
                    { case: { $lt: ['$date', dayAfter] }, then: 'tomorrow' }
                  ],
                  default: 'later'
                }
              },
              n: { $sum: 1 }
            }
          }
        ],
        agents: [{ $group: { _id: '$agent', name: { $first: '$agentName' }, n: { $sum: 1 } } }]
      }
    }
  ]).allowDiskUse(true);
  const pending = { overdue: 0, today: 0, tomorrow: 0, later: 0, ...toCountMap(facet.pending) };
  return {
    stats: {
      total: countOf(facet.total),
      completed: countOf(facet.completed),
      pending: pending.overdue + pending.today + pending.tomorrow + pending.later,
      ...pending
    },
    options: { agents: people(facet.agents) }
  };
};

const sendFollowUpPage = async (req, res, { name, base }) => {
  const { page, limit, skip } = pageParams(req);
  const matchBase = { ...base, company: toObjectId(base.company) };
  const filter = applyFollowUpFilters(req, matchBase);
  const [items, total, summary] = await Promise.all([
    FollowUp.find(filter)
      .sort({ date: 1 })
      .skip(skip)
      .limit(limit)
      .populate('lead', 'name phone')
      .populate('agent', 'name')
      .lean(),
    FollowUp.countDocuments(filter),
    cachedSummary(name, String(base.company), '', () => followUpSummary(matchBase))
  ]);
  return sendPage(res, { items: items.map(formatFollowUpForClient), total, page, limit, ...summary });
};

module.exports = {
  isPagedRequest,
  pageParams,
  sendLeadPage,
  sendCallLogPage,
  sendFollowUpPage,
  invalidateCrmListSummaries,
  // exported for tests
  applyLeadFilters,
  scheduleRange,
  dayRange
};
