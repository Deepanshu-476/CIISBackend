const mongoose = require('mongoose');
const Lead = require('../models/Lead');
const CallLog = require('../models/CallLog');
const FollowUp = require('../models/Followup');
const User = require('../models/User');
const Assignment = require('../models/LeadAssignmentHistory');
const { telecallerFilter, telecallerUserIds } = require('../utils/telecallerUsers');

const TYPES = new Set(['overview', 'leads', 'calls', 'visits', 'follow-ups', 'team-performance', 'conversion-funnel', 'user-activity']);
const dateFilter = query => {
  for (const key of ['from', 'to']) {
    if (query[key] && !/^\d{4}-\d{2}-\d{2}$/.test(String(query[key]))) throw Object.assign(new Error(`Invalid ${key} date.`), { status: 400 });
  }
  const value = {};
  if (query.from) value.$gte = new Date(`${query.from}T00:00:00.000+05:30`);
  if (query.to) value.$lte = new Date(`${query.to}T23:59:59.999+05:30`);
  if ((value.$gte && !Number.isFinite(value.$gte.getTime())) || (value.$lte && !Number.isFinite(value.$lte.getTime())) || (value.$gte && value.$lte && value.$gte > value.$lte)) {
    throw Object.assign(new Error('Choose a valid report date range.'), { status: 400 });
  }
  return Object.keys(value).length ? value : null;
};
const text = value => value == null || value === '' ? '—' : String(value);
const date = value => value ? new Date(value).toLocaleString('en-IN') : '—';

const shortDate = value => new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
const groupedSeries = (items, keyFor, valuesFor) => {
  const groups = new Map();
  for (const item of items) {
    const key = keyFor(item);
    const current = groups.get(key) || {};
    groups.set(key, { name: key, ...valuesFor(item, current) });
  }
  return [...groups.values()];
};

exports.report = async (req, res, next) => {
  try {
    const type = req.params.type;
    if (!TYPES.has(type)) return res.status(404).json({ message: 'Report not found.' });
    const company = req.crmCompany;
    const range = dateFilter(req.query);
    const created = range ? { createdAt: range } : {};

    if (type === 'overview') {
      const [totalLeads, assigned, converted, calls, pendingFollowUps] = await Promise.all([
        Lead.countDocuments({ company, ...created }), Lead.countDocuments({ company, assignedTo: { $ne: null }, ...created }),
        Lead.countDocuments({ company, status: 'converted', ...created }), CallLog.countDocuments({ company, ...created }),
        FollowUp.countDocuments({ company, status: 'pending', ...(range ? { date: range } : {}) })
      ]);
      return res.json({ summary: [
        { label: 'Total Leads', value: totalLeads }, { label: 'Assigned Leads', value: assigned },
        { label: 'Calls Logged', value: calls }, { label: 'Converted', value: converted },
        { label: 'Pending Follow-ups', value: pendingFollowUps }
      ], chartData: [{ date: range ? 'Selected period' : 'All time', leads: totalLeads, calls, conversions: converted }], columns: ['Metric', 'Value'], rows: [
        { Metric: 'Unassigned Leads', Value: totalLeads - assigned },
        { Metric: 'Conversion Rate', Value: totalLeads ? `${((converted / totalLeads) * 100).toFixed(1)}%` : '0%' }
      ] });
    }

    if (type === 'leads') {
      const items = await Lead.find({ company, ...created }).sort({ createdAt: -1 }).limit(1000)
        .populate('leadSource', 'name').populate('leadType', 'name').populate('assignedTo', 'name').lean();
      const chartData = groupedSeries(items, item => text(item.leadSource?.name || item.source), (item, current) => ({ leads: (current.leads || 0) + 1, qualified: (current.qualified || 0) + (['interested', 'converted'].includes(item.status) ? 1 : 0) }));
      return res.json({ summary: [{ label: 'Matching Leads', value: items.length }], chartData, columns: ['Lead', 'Phone', 'Source', 'Type', 'Status', 'Assigned To', 'Created'],
        rows: items.map(item => ({ Lead: text(item.name), Phone: text(item.phone), Source: text(item.leadSource?.name || item.source), Type: text(item.leadType?.name), Status: text(item.status), 'Assigned To': text(item.assignedTo?.name), Created: date(item.createdAt) })) });
    }

    if (type === 'calls') {
      const items = await CallLog.find({ company, ...created }).sort({ createdAt: -1 }).limit(1000).populate('lead', 'name phone').populate('agent', 'name').lean();
      const chartData = groupedSeries(items, item => shortDate(item.createdAt), (item, current) => ({ totalCalls: (current.totalCalls || 0) + 1, connected: (current.connected || 0) + (item.status === 'answered' ? 1 : 0) }));
      return res.json({ summary: [{ label: 'Calls Logged', value: items.length }], chartData: chartData.map(({ name, ...values }) => ({ day: name, ...values })).reverse(), columns: ['Lead', 'Phone', 'Telecaller', 'Outcome', 'Duration', 'Date'],
        rows: items.map(item => ({ Lead: text(item.lead?.name), Phone: text(item.lead?.phone), Telecaller: text(item.agent?.name), Outcome: text(item.status), Duration: `${Number(item.duration) || 0}s`, Date: date(item.createdAt) })) });
    }

    if (type === 'visits') {
      return res.json({ summary: [{ label: 'Visits', value: 0 }], columns: ['Status'], rows: [], message: 'Field Marketing is disabled, so no visit records are collected.' });
    }

    if (type === 'follow-ups') {
      const filter = { company, ...(range ? { date: range } : {}) };
      const items = await FollowUp.find(filter).sort({ date: -1 }).limit(1000).populate('lead', 'name phone').populate('agent', 'name').lean();
      const chartData = groupedSeries(items, item => shortDate(item.date), (item, current) => ({ completed: (current.completed || 0) + (item.status === 'done' ? 1 : 0), pending: (current.pending || 0) + (item.status === 'pending' ? 1 : 0) }));
      return res.json({ summary: [{ label: 'Follow-ups', value: items.length }, { label: 'Pending', value: items.filter(item => item.status === 'pending').length }], chartData: chartData.reverse(), columns: ['Lead', 'Phone', 'Telecaller', 'Scheduled For', 'Status', 'Note'],
        rows: items.map(item => ({ Lead: text(item.lead?.name), Phone: text(item.lead?.phone), Telecaller: text(item.agent?.name), 'Scheduled For': date(item.date), Status: text(item.status), Note: text(item.note) })) });
    }

    if (type === 'conversion-funnel') {
      const match = { company: new mongoose.Types.ObjectId(String(company)), ...(range ? { createdAt: range } : {}) };
      const stages = await Lead.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }, { $sort: { count: -1 } }]);
      const total = stages.reduce((sum, stage) => sum + stage.count, 0);
      const rows = stages.map(stage => ({ Stage: text(stage._id), Leads: stage.count, Share: total ? `${((stage.count / total) * 100).toFixed(1)}%` : '0%' }));
      const colors = ['#6366f1', '#3b82f6', '#06b6d4', '#eab308', '#f97316', '#10b981'];
      return res.json({ summary: [{ label: 'Total Leads', value: total }], funnelStages: rows.map((row, index) => ({ step: index + 1, name: row.Stage, count: row.Leads, pct: row.Share, color: colors[index % colors.length] })), columns: ['Stage', 'Leads', 'Share'], rows });
    }

    if (type === 'team-performance') {
      const ids = await telecallerUserIds(company);
      const users = await User.find(telecallerFilter(company, ids)).select('name email').sort({ name: 1 }).lean();
      const objectIds = users.map(user => user._id);
      const [leadStats, callStats] = await Promise.all([
        Lead.aggregate([{ $match: { company: new mongoose.Types.ObjectId(String(company)), assignedTo: { $in: objectIds }, ...(range ? { createdAt: range } : {}) } }, { $group: { _id: '$assignedTo', leads: { $sum: 1 }, converted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } } } }]),
        CallLog.aggregate([{ $match: { company: new mongoose.Types.ObjectId(String(company)), agent: { $in: objectIds }, ...(range ? { createdAt: range } : {}) } }, { $group: { _id: '$agent', calls: { $sum: 1 } } }])
      ]);
      const leads = new Map(leadStats.map(row => [String(row._id), row])); const calls = new Map(callStats.map(row => [String(row._id), row.calls]));
      const rows = users.map(user => {
        const stat = leads.get(String(user._id)) || { leads: 0, converted: 0 }; return { Telecaller: text(user.name), Email: text(user.email), 'Assigned Leads': stat.leads, Calls: calls.get(String(user._id)) || 0, Converted: stat.converted, Conversion: stat.leads ? `${((stat.converted / stat.leads) * 100).toFixed(1)}%` : '0%' };
      });
      return res.json({ summary: [{ label: 'Active Telecallers', value: users.length }], chartData: rows.map(row => ({ agent: row.Telecaller, calls: row.Calls, conversions: row.Converted })), columns: ['Telecaller', 'Email', 'Assigned Leads', 'Calls', 'Converted', 'Conversion'], rows });
    }

    const [calls, assignments] = await Promise.all([
      CallLog.find({ company, ...created }).sort({ createdAt: -1 }).limit(500).populate('lead', 'name').populate('agent', 'name').lean(),
      Assignment.find({ company, ...created }).sort({ createdAt: -1 }).limit(500).populate('lead', 'name').populate('performedBy', 'name').populate('toUser', 'name').lean()
    ]);
    const rows = [
      ...calls.map(item => ({ Activity: 'Call logged', Lead: text(item.lead?.name), User: text(item.agent?.name), Detail: text(item.status), Date: date(item.createdAt), sortDate: item.createdAt })),
      ...assignments.map(item => ({ Activity: text(item.action), Lead: text(item.lead?.name), User: text(item.performedBy?.name), Detail: item.toUser?.name ? `To ${item.toUser.name}` : 'Unassigned', Date: date(item.createdAt), sortDate: item.createdAt }))
    ].sort((a, b) => new Date(b.sortDate) - new Date(a.sortDate)).slice(0, 1000).map(({ sortDate, ...row }) => row);
    const chartData = groupedSeries(rows, item => item.Activity, (item, current) => ({ events: (current.events || 0) + 1 }));
    return res.json({ summary: [{ label: 'Activities', value: rows.length }], chartData, columns: ['Activity', 'Lead', 'User', 'Detail', 'Date'], rows });
  } catch (error) { next(error); }
};
