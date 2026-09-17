const mongoose = require('mongoose');
const Lead = require('../../models/Lead');

function formatLeadId(id) {
  return id ? `#LD-${String(id).slice(-6).toUpperCase()}` : '#LD-000';
}

function timeAgo(date) {
  if (!date) return '';
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

exports.getOverview = async (req, res, next) => {
  try {
    const company = req.crmCompany;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    // 1. Top Stat Cards
    const [assignedLeads, convertedCalls, pendingFollowUps] = await Promise.all([
      Lead.countDocuments({
        company,
        assignedTo: { $ne: null },
        status: { $nin: ['converted', 'closed'] }
      }),
      Lead.countDocuments({
        company,
        status: 'converted'
      }),
      Lead.countDocuments({
        company,
        nextFollowUp: { $lte: endOfToday },
        status: { $nin: ['converted', 'closed'] }
      })
    ]);

    // Unwind callHistory to compute today's calls, outcomes, trends, and recent calls
    const callAggregations = await Lead.aggregate([
      { $match: { company: new mongoose.Types.ObjectId(company) } },
      { $unwind: '$callHistory' },
      {
        $facet: {
          todaysCallsCount: [
            {
              $match: {
                'callHistory.date': { $gte: startOfToday, $lte: endOfToday }
              }
            },
            { $count: 'count' }
          ],
          trendCalls: [
            {
              $match: {
                'callHistory.date': { $gte: sevenDaysAgo, $lte: endOfToday }
              }
            },
            {
              $project: {
                date: '$callHistory.date',
                outcome: '$callHistory.outcome'
              }
            }
          ],
          outcomeCounts: [
            {
              $group: {
                _id: '$callHistory.outcome',
                count: { $sum: 1 }
              }
            }
          ],
          recentCalls: [
            { $sort: { 'callHistory.date': -1 } },
            { $limit: 10 },
            {
              $lookup: {
                from: 'leadsources',
                localField: 'leadSource',
                foreignField: '_id',
                as: 'sourceObj'
              }
            },
            {
              $lookup: {
                from: 'leadtypes',
                localField: 'leadType',
                foreignField: '_id',
                as: 'typeObj'
              }
            },
            {
              $project: {
                leadMongoId: '$_id',
                leadName: '$name',
                phone: '$phone',
                source: {
                  $ifNull: [{ $arrayElemAt: ['$sourceObj.name', 0] }, '$source']
                },
                leadType: {
                  $ifNull: [{ $arrayElemAt: ['$typeObj.name', 0] }, 'General']
                },
                callId: '$callHistory.id',
                callType: '$callHistory.callType',
                outcome: '$callHistory.outcome',
                remarks: '$callHistory.notes',
                callDate: '$callHistory.date'
              }
            }
          ]
        }
      }
    ]);

    const facet = callAggregations[0] || {};
    const todaysCalls = facet.todaysCallsCount?.[0]?.count || 0;

    // 2. Mini Tables
    const [todaysFollowUpsList, upcomingScheduledCallsList] = await Promise.all([
      Lead.find({
        company,
        nextFollowUp: { $gte: startOfToday, $lte: endOfToday },
        status: { $nin: ['converted', 'closed'] }
      })
        .select('name phone nextFollowUp status')
        .sort({ nextFollowUp: 1 })
        .limit(5)
        .lean(),
      Lead.find({
        company,
        nextFollowUp: { $gte: startOfToday },
        status: { $nin: ['converted', 'closed'] }
      })
        .select('name phone nextFollowUp remarks status')
        .sort({ nextFollowUp: 1 })
        .limit(5)
        .lean()
    ]);

    // 3. Trends (7 Days)
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const trendMap = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      trendMap[key] = { day: dayNames[d.getDay()], calls: 0, connected: 0 };
    }

    const connectedOutcomes = ['Connected', 'Interested', 'Converted'];
    (facet.trendCalls || []).forEach(item => {
      if (!item.date) return;
      const key = new Date(item.date).toISOString().slice(0, 10);
      if (trendMap[key]) {
        trendMap[key].calls++;
        if (connectedOutcomes.includes(item.outcome)) {
          trendMap[key].connected++;
        }
      }
    });
    const trends = Object.values(trendMap);

    // 4. Outcomes Donut Distribution
    const outcomeColors = {
      'Converted': '#10b981',
      'Connected': '#6366f1',
      'Interested': '#f59e0b',
      'Not Interested': '#94a3b8',
      'Need Callback': '#06b6d4',
      'Follow-up': '#8b5cf6',
      'No Answer': '#ef4444',
      'Busy': '#f97316'
    };

    const totalLoggedCalls = (facet.outcomeCounts || []).reduce((acc, cur) => acc + cur.count, 0);
    const outcomes = (facet.outcomeCounts || []).map(o => {
      const pct = totalLoggedCalls > 0 ? ((o.count / totalLoggedCalls) * 100).toFixed(1) : '0.0';
      return {
        name: o._id || 'Unknown',
        value: o.count,
        percent: `${pct}% of calls`,
        color: outcomeColors[o._id] || '#64748b'
      };
    });

    // 5. Recent Calls Formatted for UI
    const recentCalls = (facet.recentCalls || []).map((c, idx) => ({
      sl: idx + 1,
      lead: formatLeadId(c.leadMongoId),
      name: c.leadName || 'Unknown',
      phone: c.phone || '—',
      source: c.source || 'Direct',
      sourceType: String(c.source || 'direct').toLowerCase().replace(/\s+/g, '-'),
      leadType: c.leadType || 'General',
      leadTypeClass: String(c.leadType || 'general').toLowerCase().replace(/\s+/g, '-'),
      callType: c.callType || 'Outbound',
      outcome: c.outcome || 'Logged',
      outcomeClass: String(c.outcome || 'logged').toLowerCase().replace(/\s+/g, '-'),
      remarks: c.remarks || '—',
      callTime: c.callDate ? new Date(c.callDate).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '—',
      ago: timeAgo(c.callDate)
    }));

    res.json({
      stats: {
        assignedLeads,
        todaysCalls,
        pendingFollowUps,
        convertedCalls
      },
      todaysFollowUps: todaysFollowUpsList.map(item => ({
        id: item._id,
        name: item.name,
        phone: item.phone,
        time: item.nextFollowUp ? new Date(item.nextFollowUp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : '—',
        status: item.status
      })),
      upcomingScheduledCalls: upcomingScheduledCallsList.map(item => ({
        id: item._id,
        name: item.name,
        phone: item.phone,
        time: item.nextFollowUp ? new Date(item.nextFollowUp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : '—',
        purpose: item.remarks || 'Callback'
      })),
      trends,
      outcomes,
      recentCalls
    });
  } catch (error) {
    next(error);
  }
};

