const mongoose = require('mongoose');
const Lead = require('../models/Lead');

exports.overview = async (req, res, next) => {
  try {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29));
    const [result] = await Lead.aggregate([
      { $match: { company: new mongoose.Types.ObjectId(String(req.crmCompany)) } },
      { $facet: {
        totals: [{ $group: {
          _id: null,
          total: { $sum: 1 },
          assigned: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$assignedTo', null] }, null] }, 1, 0] } }
        } }],
        statuses: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        months: [
          { $match: { createdAt: { $gte: start, $lte: now } } },
          { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'UTC' } }, leads: { $sum: 1 }, converted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } } } }
        ],
        days: [
          { $match: { createdAt: { $gte: dayStart, $lte: now } } },
          { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } }, leads: { $sum: 1 }, converted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } } } }
        ]
      } }
    ]);
    const total = result?.totals[0]?.total || 0;
    const assigned = result?.totals[0]?.assigned || 0;
    const statuses = result?.statuses || [];
    const count = status => statuses.find(item => item._id === status)?.count || 0;
    const known = ['new', 'follow-up', 'interested', 'not interested', 'converted'];
    const labels = ['New', 'Follow-up', 'Interested', 'Not Interested', 'Converted'];
    const funnel = known.map((status, index) => ({ name: labels[index], value: count(status) }));
    const other = statuses.filter(item => !known.includes(item._id)).reduce((sum, item) => sum + item.count, 0);
    if (other) funnel.push({ name: 'Other', value: other });
    const trends = Array.from({ length: 6 }, (_, index) => {
      const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + index, 1));
      const key = date.toISOString().slice(0, 7);
      return { month: date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
        leads: result?.months?.find(item => item._id === key)?.leads || 0,
        converted: result?.months?.find(item => item._id === key)?.converted || 0 };
    });
    const days = Array.from({ length: 30 }, (_, index) => {
      const date = new Date(dayStart.getTime() + index * 86400000);
      const item = result?.days?.find(row => row._id === date.toISOString().slice(0, 10));
      return { label: date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }), leads: item?.leads || 0, converted: item?.converted || 0 };
    });
    res.json({ metrics: { total, new: count('new'), assigned, unassigned: total - assigned,
      conversionRate: total ? Number((count('converted') / total * 100).toFixed(1)) : 0,
      interested: count('interested') }, trends, trendsByRange: { '7D': days.slice(-7), '30D': days, '6M': trends.map(item => ({ ...item, label: item.month })) }, funnel });
  } catch (error) { next(error); }
};
