const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const CallLog = require('../models/CallLog');
const FollowUp = require('../models/Followup');
const User = require('../models/User');
const LeadAssignmentHistory = require('../models/LeadAssignmentHistory');
const { telecallerFilter, telecallerUserIds } = require('../utils/telecallerUsers');
require('../models/LeadSource');
require('../models/LeadType');

function getDayBounds(date = new Date()) {
  const istOffset = 5.5 * 60 * 60000;
  const local = new Date(date.getTime() + istOffset);
  local.setUTCHours(0, 0, 0, 0);
  const start = new Date(local.getTime() - istOffset);
  const end = new Date(start.getTime() + 24 * 60 * 60000);
  return { start, end };
}

// 1. Dashboard Aggregations
exports.dashboard = async (req, res, next) => {
  try {
    const company = req.crmCompany;
    const now = new Date();
    const { start: todayStart, end: todayEnd } = getDayBounds(now);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60000);
    const eligibleTelecallers = await telecallerUserIds(company);

    const [
      totalLeads,
      totalCalls,
      todaysCalls,
      convertedLeads,
      unassignedLeads,
      pendingFollowUps,
      activeUsersList,
      leadStatusFacet,
      recentCallsList
    ] = await Promise.all([
      Lead.countDocuments({ company }),
      CallLog.countDocuments({ company }),
      CallLog.countDocuments({ company, createdAt: { $gte: todayStart, $lt: todayEnd } }),
      Lead.countDocuments({ company, status: 'converted' }),
      Lead.countDocuments({ company, assignedTo: null }),
      FollowUp.countDocuments({ company, status: 'pending' }),
      User.find(telecallerFilter(company, eligibleTelecallers)).select('name email role companyRole jobRole').lean(),
      Lead.aggregate([
        { $match: { company: new mongoose.Types.ObjectId(String(company)) } },
        { $group: { _id: { status: '$status', assigned: { $ne: ['$assignedTo', null] } }, count: { $sum: 1 } } }
      ]),
      CallLog.find({ company })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('lead', 'name phone source')
        .populate('agent', 'name')
        .lean()
    ]);

    const activeUsersCount = activeUsersList.length;
    const conversionRate = totalLeads ? Number(((convertedLeads / totalLeads) * 100).toFixed(1)) : 0;

    // Pipeline Distribution
    const statusMap = (leadStatusFacet || []).reduce((acc, curr) => {
      const status = String(curr._id?.status || '').toLowerCase();
      acc[status] = (acc[status] || 0) + curr.count;
      acc[`${status}:${curr._id?.assigned ? 'assigned' : 'unassigned'}`] = curr.count;
      return acc;
    }, {});

    const pipelineData = [
      { name: 'New', value: statusMap['new:unassigned'] || 0, color: '#06b6d4' },
      { name: 'Assigned', value: statusMap['new:assigned'] || 0, color: '#3b82f6' },
      { name: 'Interested', value: statusMap['interested'] || 0, color: '#10b981' },
      { name: 'Follow-up', value: statusMap['follow-up'] || 0, color: '#f59e0b' },
      { name: 'Converted', value: convertedLeads, color: '#8b5cf6' },
      { name: 'Closed', value: statusMap['closed'] || 0, color: '#ef4444' }
    ];

    // 30-Day Trend Aggregations for Leads and Calls
    const [leadDays, callDays] = await Promise.all([
      Lead.aggregate([
        { $match: { company: new mongoose.Types.ObjectId(String(company)), createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: '+05:30' } }, count: { $sum: 1 } } }
      ]),
      CallLog.aggregate([
        { $match: { company: new mongoose.Types.ObjectId(String(company)), createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: '+05:30' } }, count: { $sum: 1 } } }
      ])
    ]);

    const leadDayMap = (leadDays || []).reduce((acc, r) => ({ ...acc, [r._id]: r.count }), {});
    const callDayMap = (callDays || []).reduce((acc, r) => ({ ...acc, [r._id]: r.count }), {});

    const trendData = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60000);
      const key = d.toISOString().slice(0, 10);
      const dayStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      trendData.push({
        date: dayStr,
        leads: leadDayMap[key] || 0,
        calls: callDayMap[key] || 0,
        visits: 0
      });
    }

    // Team Performance Aggregation
    const agentCallsFacet = await CallLog.aggregate([
      { $match: { company: new mongoose.Types.ObjectId(String(company)) } },
      { $group: { _id: '$agent', totalCalls: { $sum: 1 } } }
    ]);
    const agentCallMap = (agentCallsFacet || []).reduce((acc, c) => ({ ...acc, [String(c._id)]: c.totalCalls }), {});

    const agentLeadsFacet = await Lead.aggregate([
      { $match: { company: new mongoose.Types.ObjectId(String(company)), assignedTo: { $ne: null } } },
      { $group: {
        _id: '$assignedTo',
        totalLeads: { $sum: 1 },
        converted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } }
      } }
    ]);
    const agentLeadMap = (agentLeadsFacet || []).reduce((acc, l) => ({ ...acc, [String(l._id)]: l }), {});

    const teamPerformance = activeUsersList.map(user => {
      const uId = String(user._id);
      const uCalls = agentCallMap[uId] || 0;
      const uLeadStats = agentLeadMap[uId] || { totalLeads: 0, converted: 0 };
      const uConvRate = uLeadStats.totalLeads
        ? `${((uLeadStats.converted / uLeadStats.totalLeads) * 100).toFixed(1)}%`
        : '0%';

      return {
        id: uId,
        member: user.name || 'User',
        role: user.jobRole || user.companyRole || user.role || 'Telecaller',
        roleBadge: 'blue',
        calls: uCalls,
        visits: 0,
        leads: uLeadStats.totalLeads,
        conversion: uConvRate,
        conversionHigh: parseFloat(uConvRate) >= 10
      };
    });

    const recentActivities = (recentCallsList || []).map((call, idx) => ({
      id: idx + 1,
      title: `Call: ${call.lead?.name || 'Lead'}`,
      role: call.agent?.name || 'Agent',
      roleType: 'telecaller',
      action: `Call Logged (${call.status || 'answered'})`,
      time: new Date(call.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
      type: 'call'
    }));

    res.json({
      metrics: {
        totalLeads,
        totalCalls,
        todaysCalls,
        todaysVisits: 0,
        conversionRate: `${conversionRate}%`,
        pendingFollowUps,
        activeUsers: activeUsersCount,
        unassignedLeads
      },
      trendData,
      pipelineData,
      teamPerformance,
      recentActivities
    });
  } catch (error) { next(error); }
};

// 2. Call Overview (KPIs, Weekly Trends, Outcome Donut, Recent Calls)
exports.overview = async (req, res, next) => {
  try {
    const company = req.crmCompany;
    const now = new Date();
    const { start: todayStart, end: todayEnd } = getDayBounds(now);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60000);

    const [
      assignedLeads,
      todaysCalls,
      pendingFollowups,
      convertedCalls,
      pendingCalls,
      scheduledCalls,
      completedCalls,
      totalCalls,
      recentLogs,
      trendLogs,
      outcomeLogs
    ] = await Promise.all([
      Lead.countDocuments({ company, assignedTo: { $ne: null } }),
      CallLog.countDocuments({ company, createdAt: { $gte: todayStart, $lt: todayEnd } }),
      FollowUp.countDocuments({ company, status: 'pending' }),
      Lead.countDocuments({ company, status: 'converted' }),
      Lead.countDocuments({ company, assignedTo: { $ne: null }, status: { $in: ['new', 'follow-up'] } }),
      Lead.countDocuments({ company, nextFollowUp: { $gt: now } }),
      Lead.countDocuments({ company, status: { $in: ['converted', 'closed'] } }),
      CallLog.countDocuments({ company }),
      CallLog.find({ company })
        .sort({ createdAt: -1 })
        .limit(20)
        .populate({ path: 'lead', select: 'name phone source leadType leadSource', populate: [{ path: 'leadType', select: 'name' }, { path: 'leadSource', select: 'name' }] })
        .populate('agent', 'name email')
        .lean(),
      CallLog.aggregate([
        { $match: { company: new mongoose.Types.ObjectId(String(company)), createdAt: { $gte: thirtyDaysAgo } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: '+05:30' } },
          total: { $sum: 1 },
          connected: { $sum: { $cond: [{ $eq: ['$status', 'answered'] }, 1, 0] } }
        } }
      ]),
      CallLog.aggregate([
        { $match: { company: new mongoose.Types.ObjectId(String(company)) } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ])
    ]);

    // Trend Data for 7 days & 30 days
    const trendMap = (trendLogs || []).reduce((acc, row) => ({ ...acc, [row._id]: row }), {});
    const daysName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    
    // Helper to format date string matching MongoDB's '+05:30' timezone
    const getISTKey = (date) => {
      const istDate = new Date(date.getTime() + (5.5 * 60 * 60 * 1000));
      return istDate.toISOString().slice(0, 10);
    };

    // 7-day trend
    const trendData = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60000);
      const key = getISTKey(d);
      const entry = trendMap[key] || { total: 0, connected: 0 };
      trendData.push({
        day: daysName[d.getDay()],
        date: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        calls: entry.total,
        connected: entry.connected
      });
    }

    // 30-day trend
    const trendData30d = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60000);
      const key = getISTKey(d);
      const entry = trendMap[key] || { total: 0, connected: 0 };
      trendData30d.push({
        day: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        date: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        calls: entry.total,
        connected: entry.connected
      });
    }

    // Outcome Data
    const totalOutcomes = outcomeLogs.reduce((sum, item) => sum + item.count, 0) || 1;
    const colorMap = {
      answered: '#10b981',
      missed: '#f59e0b',
      'not reachable': '#06b6d4',
      rejected: '#ef4444'
    };
    const outcomeData = outcomeLogs.map(item => ({
      name: (item._id || 'answered').toUpperCase(),
      value: item.count,
      percent: `${((item.count / totalOutcomes) * 100).toFixed(1)}% of calls`,
      color: colorMap[String(item._id).toLowerCase()] || '#6366f1'
    }));

    // Recent calls formatting
    const recentCalls = recentLogs.map((log, index) => ({
      sl: index + 1,
      id: log._id,
      lead: `#LD-${String(log.lead?._id || index + 1).slice(-3)}`,
      name: log.lead?.name || 'Lead',
      phone: log.lead?.phone || '—',
      source: log.lead?.leadSource?.name || log.lead?.source || 'Direct',
      leadType: log.lead?.leadType?.name || 'General',
      callType: 'Outbound',
      outcome: log.status ? log.status.charAt(0).toUpperCase() + log.status.slice(1) : 'Answered',
      remarks: log.notes || '—',
      callTime: new Date(log.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      caller: log.agent?.name || 'Agent',
      duration: log.duration ? `${Math.floor(log.duration / 60)}m ${log.duration % 60}s` : '0s'
    }));

    res.json({
      statCards: [
        { title: "Assigned Leads", value: String(assignedLeads), badge: "Active Leads", badgeType: "purple" },
        { title: "Today's Calls", value: String(todaysCalls), badge: "Completed Today", badgeType: "teal" },
        { title: "Pending Follow Ups", value: String(pendingFollowups), badge: "Needs Attention", badgeType: "amber" },
        { title: "Converted Calls", value: String(convertedCalls), badge: "Total Converted", badgeType: "cyan" }
      ],
      quickAccessCounts: {
        assigned: assignedLeads,
        today: todaysCalls,
        pending: pendingCalls,
        scheduled: scheduledCalls,
        completed: completedCalls,
        converted: convertedCalls,
        transferred: 0,
        history: totalCalls,
        followUps: pendingFollowups
      },
      trendData,
      trendData30d,
      outcomeData: outcomeData.length ? outcomeData : [
        { name: 'Answered', value: 0, percent: '0% of calls', color: '#10b981' }
      ],
      recentCalls
    });
  } catch (error) { next(error); }
};

// 3. Assigned Calls List
exports.assignedCalls = async (req, res, next) => {
  try {
    const company = req.crmCompany;
    const { assignedTo, source, type, from, to, search } = req.query;

    const filter = { company, assignedTo: { $ne: null } };
    if (assignedTo && mongoose.isValidObjectId(assignedTo)) filter.assignedTo = assignedTo;
    if (source && mongoose.isValidObjectId(source)) filter.leadSource = source;
    if (type && mongoose.isValidObjectId(type)) filter.leadType = type;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(`${to}T23:59:59.999Z`);
    }

    let items = await Lead.find(filter)
      .sort({ assignedAt: -1, createdAt: -1 })
      .populate('leadSource', 'name')
      .populate('leadType', 'name')
      .populate('assignedTo', 'name email')
      .lean();

    if (search) {
      const q = String(search).trim().toLowerCase();
      items = items.filter(i =>
        (i.name && i.name.toLowerCase().includes(q)) ||
        (i.phone && i.phone.includes(q)) ||
        (i.assignedTo?.name && i.assignedTo.name.toLowerCase().includes(q))
      );
    }

    res.json({ items });
  } catch (error) { next(error); }
};

// 4. Today's Calls List
exports.todaysCalls = async (req, res, next) => {
  try {
    const company = req.crmCompany;
    const { start: todayStart, end: todayEnd } = getDayBounds(new Date());

    const calls = await CallLog.find({
      company,
      createdAt: { $gte: todayStart, $lt: todayEnd }
    })
      .sort({ createdAt: -1 })
      .populate({ path: 'lead', populate: [{ path: 'leadType', select: 'name' }, { path: 'leadSource', select: 'name' }] })
      .populate('agent', 'name email')
      .lean();

    res.json({ items: calls });
  } catch (error) { next(error); }
};

// 5. Call History List
exports.callHistory = async (req, res, next) => {
  try {
    const company = req.crmCompany;
    const { agentId, status, from, to } = req.query;

    const filter = { company };
    if (agentId && mongoose.isValidObjectId(agentId)) filter.agent = agentId;
    if (status) filter.status = status;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(`${to}T23:59:59.999Z`);
    }

    const items = await CallLog.find(filter)
      .sort({ createdAt: -1 })
      .populate({ path: 'lead', select: 'name phone source leadType leadSource', populate: [{ path: 'leadType', select: 'name' }, { path: 'leadSource', select: 'name' }] })
      .populate('agent', 'name email')
      .lean();

    res.json({ items });
  } catch (error) { next(error); }
};

// 6. Pending Calls List
exports.pendingCalls = async (req, res, next) => {
  try {
    const company = req.crmCompany;
    const { assignedTo, source, leadType } = req.query;

    const filter = {
      company,
      assignedTo: { $ne: null },
      status: { $in: ['new', 'follow-up', 'interested'] }
    };
    if (assignedTo && mongoose.isValidObjectId(assignedTo)) filter.assignedTo = assignedTo;
    if (source && mongoose.isValidObjectId(source)) filter.leadSource = source;
    if (leadType && mongoose.isValidObjectId(leadType)) filter.leadType = leadType;

    const items = await Lead.find(filter)
      .sort({ assignedAt: -1, createdAt: -1 })
      .populate('leadSource', 'name')
      .populate('leadType', 'name')
      .populate('assignedTo', 'name email')
      .lean();

    res.json({ items });
  } catch (error) { next(error); }
};

// 7. Scheduled Calls List
exports.scheduledCalls = async (req, res, next) => {
  try {
    const company = req.crmCompany;
    const { assignedTo, date, source, leadType } = req.query;

    const filter = {
      company,
      nextFollowUp: { $ne: null }
    };
    if (assignedTo && mongoose.isValidObjectId(assignedTo)) filter.assignedTo = assignedTo;
    if (source && mongoose.isValidObjectId(source)) filter.leadSource = source;
    if (leadType && mongoose.isValidObjectId(leadType)) filter.leadType = leadType;
    if (date) {
      const dStart = new Date(`${date}T00:00:00.000Z`);
      const dEnd = new Date(`${date}T23:59:59.999Z`);
      filter.nextFollowUp = { $gte: dStart, $lte: dEnd };
    }

    const items = await Lead.find(filter)
      .sort({ nextFollowUp: 1 })
      .populate('leadSource', 'name')
      .populate('leadType', 'name')
      .populate('assignedTo', 'name email')
      .lean();

    res.json({ items });
  } catch (error) { next(error); }
};

// 8. Completed Calls List
exports.completedCalls = async (req, res, next) => {
  try {
    const company = req.crmCompany;
    const items = await Lead.find({
      company,
      status: { $in: ['converted', 'closed'] }
    })
      .sort({ updatedAt: -1 })
      .populate('leadSource', 'name')
      .populate('leadType', 'name')
      .populate('assignedTo', 'name email')
      .lean();

    res.json({ items });
  } catch (error) { next(error); }
};

// 9. Converted Calls List
exports.convertedCalls = async (req, res, next) => {
  try {
    const company = req.crmCompany;
    const items = await Lead.find({
      company,
      status: 'converted'
    })
      .sort({ updatedAt: -1 })
      .populate('leadSource', 'name')
      .populate('leadType', 'name')
      .populate('assignedTo', 'name email')
      .lean();

    res.json({ items });
  } catch (error) { next(error); }
};

// 10. Transferred Calls List
exports.transferredCalls = async (req, res, next) => {
  try {
    const company = req.crmCompany;
    const history = await LeadAssignmentHistory.find({ company, action: 'reassigned' })
      .sort({ createdAt: -1 })
      .populate({ path: 'lead', select: 'name phone remarks status callHistory' })
      .populate('fromUser', 'name email jobRole role')
      .populate('toUser', 'name email jobRole role')
      .populate('performedBy', 'name email jobRole role')
      .lean();

    const items = history.filter(entry => entry.lead).map(entry => {
      const callsAfterTransfer = (entry.lead.callHistory || []).filter(c =>
        String(c.agent) === String(entry.toUser?._id) && new Date(c.date) >= new Date(entry.createdAt)
      );
      const isHandled = callsAfterTransfer.length > 0 || ['converted', 'closed', 'interested', 'not interested'].includes(entry.lead.status);
      const status = isHandled ? 'Handled' : 'Transferred';

      const methodLabel = entry.method === 'round-robin' ? 'Round Robin'
        : entry.method === 'load-balanced' ? 'Load Balanced'
          : entry.method === 'equal-distribution' ? 'Equal Distribution'
            : entry.method === 'single' ? 'Manual Reassignment' : entry.method || '';
      const transferReason = entry.reason || entry.lead.remarks || (methodLabel ? `Reassigned via ${methodLabel}` : 'Lead reassigned');

      return {
        _id: entry._id,
        leadId: entry.lead._id,
        name: entry.lead.name,
        phone: entry.lead.phone,
        status,
        transferredFrom: entry.fromUser,
        assignedTo: entry.toUser,
        transferredBy: entry.performedBy,
        transferReason,
        method: methodLabel || 'Manual Reassignment',
        assignedAt: entry.createdAt,
        remarks: entry.lead.remarks || ''
      };
    });

    res.json({ items });
  } catch (error) { next(error); }
};


// 11. Follow-Up Center List
exports.followUps = async (req, res, next) => {
  try {
    const company = req.crmCompany;
    const items = await FollowUp.find({ company })
      .sort({ date: 1 })
      .populate({ path: 'lead', select: 'name phone source leadType leadSource', populate: [{ path: 'leadType', select: 'name' }, { path: 'leadSource', select: 'name' }] })
      .populate('agent', 'name email')
      .lean();

    res.json({ items });
  } catch (error) { next(error); }
};
