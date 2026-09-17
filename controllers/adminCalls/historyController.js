const mongoose = require('mongoose');
const Lead = require('../../models/Lead');

function formatLeadId(id) {
  return id ? `#LD-${String(id).slice(-6).toUpperCase()}` : '#LD-000';
}

function formatDuration(seconds = 0) {
  const s = Math.max(0, parseInt(seconds) || 0);
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
}

exports.getCallHistory = async (req, res, next) => {
  try {
    const company = req.crmCompany;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    // 1. Overall Stats across all calls
    const statsPipeline = [
      { $match: { company: new mongoose.Types.ObjectId(company) } },
      { $unwind: '$callHistory' },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: 1 },
          outboundCalls: {
            $sum: { $cond: [{ $regexMatch: { input: '$callHistory.callType', regex: /^outbound$/i } }, 1, 0] }
          },
          inboundCalls: {
            $sum: { $cond: [{ $regexMatch: { input: '$callHistory.callType', regex: /^inbound$/i } }, 1, 0] }
          },
          totalDuration: {
            $sum: { $ifNull: ['$callHistory.duration', 180] } // fallback average 3m if unset
          }
        }
      }
    ];

    const statsResult = await Lead.aggregate(statsPipeline);
    const statData = statsResult[0] || { totalCalls: 0, outboundCalls: 0, inboundCalls: 0, totalDuration: 0 };
    const avgSecs = statData.totalCalls > 0 ? Math.round(statData.totalDuration / statData.totalCalls) : 0;
    const avgDuration = formatDuration(avgSecs);

    // 2. Filtered Calls List Pipeline
    const matchFilter = {};

    if (req.query.outcome) {
      matchFilter['callHistory.outcome'] = new RegExp(`^${req.query.outcome}$`, 'i');
    }

    if (req.query.callType) {
      matchFilter['callHistory.callType'] = new RegExp(`^${req.query.callType}$`, 'i');
    }

    if (req.query.from || req.query.to) {
      matchFilter['callHistory.date'] = {};
      if (req.query.from) {
        const s = new Date(req.query.from);
        s.setHours(0, 0, 0, 0);
        matchFilter['callHistory.date'].$gte = s;
      }
      if (req.query.to) {
        const e = new Date(req.query.to);
        e.setHours(23, 59, 59, 999);
        matchFilter['callHistory.date'].$lte = e;
      }
    }

    const listPipeline = [
      { $match: { company: new mongoose.Types.ObjectId(company) } },
      { $unwind: '$callHistory' },
      { $match: matchFilter },
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
        $lookup: {
          from: 'users',
          localField: 'callHistory.agent',
          foreignField: '_id',
          as: 'agentObj'
        }
      },
      {
        $project: {
          leadMongoId: '$_id',
          name: 1,
          phone: 1,
          source: { $ifNull: [{ $arrayElemAt: ['$sourceObj.name', 0] }, '$source'] },
          leadType: { $ifNull: [{ $arrayElemAt: ['$typeObj.name', 0] }, 'General'] },
          callType: '$callHistory.callType',
          outcome: '$callHistory.outcome',
          remarks: '$callHistory.notes',
          durationSecs: { $ifNull: ['$callHistory.duration', 180] },
          callTime: '$callHistory.date',
          assignedTo: {
            $ifNull: [{ $arrayElemAt: ['$agentObj.name', 0] }, '$callHistory.createdByName']
          }
        }
      }
    ];

    if (req.query.source) {
      listPipeline.push({ $match: { source: new RegExp(`^${req.query.source}$`, 'i') } });
    }
    if (req.query.leadType) {
      listPipeline.push({ $match: { leadType: new RegExp(`^${req.query.leadType}$`, 'i') } });
    }

    if (req.query.searchLead) {
      const q = String(req.query.searchLead).trim();
      const regex = new RegExp(q, 'i');
      listPipeline.push({
        $match: {
          $or: [{ name: regex }, { phone: regex }]
        }
      });
    }

    if (req.query.search) {
      const q = String(req.query.search).trim();
      const regex = new RegExp(q, 'i');
      listPipeline.push({
        $match: {
          $or: [
            { name: regex },
            { phone: regex },
            { source: regex },
            { leadType: regex },
            { outcome: regex },
            { assignedTo: regex },
            { remarks: regex }
          ]
        }
      });
    }

    // Count
    const countPipeline = [...listPipeline, { $count: 'total' }];
    const countResult = await Lead.aggregate(countPipeline);
    const total = countResult[0]?.total || 0;

    // Pagination
    listPipeline.push({ $sort: { callTime: -1 } });
    listPipeline.push({ $skip: skip });
    listPipeline.push({ $limit: limit });

    const results = await Lead.aggregate(listPipeline);

    const items = results.map((c, idx) => ({
      id: skip + idx + 1,
      leadMongoId: c.leadMongoId,
      leadId: formatLeadId(c.leadMongoId),
      name: c.name || 'Unnamed Lead',
      phone: c.phone || '—',
      source: c.source || 'Direct',
      leadType: c.leadType || 'General',
      callType: c.callType || 'Outbound',
      outcome: c.outcome || 'Logged',
      remarks: c.remarks || '—',
      duration: formatDuration(c.durationSecs),
      callTime: c.callTime ? new Date(c.callTime).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '—',
      assignedTo: c.assignedTo || 'Telecaller'
    }));

    res.json({
      stats: {
        totalCalls: statData.totalCalls,
        outboundCalls: statData.outboundCalls,
        inboundCalls: statData.inboundCalls,
        avgDuration
      },
      items,
      total,
      page,
      pageSize: limit,
      totalPages: Math.max(1, Math.ceil(total / limit))
    });
  } catch (error) {
    next(error);
  }
};

