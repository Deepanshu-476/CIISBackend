const mongoose = require('mongoose');
const Lead = require('../../models/Lead');

function formatLeadId(id) {
  return id ? `#LD-${String(id).slice(-6).toUpperCase()}` : '#LD-000';
}

exports.getCompletedCalls = async (req, res, next) => {
  try {
    const company = req.crmCompany;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    // Calculate Overall Stats across all completed calls in company
    const statsPipeline = [
      { $match: { company: new mongoose.Types.ObjectId(company) } },
      { $unwind: '$callHistory' },
      { $match: { 'callHistory.outcome': { $ne: 'Note Added' } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          interested: {
            $sum: { $cond: [{ $eq: ['$callHistory.outcome', 'Interested'] }, 1, 0] }
          },
          converted: {
            $sum: { $cond: [{ $eq: ['$callHistory.outcome', 'Converted'] }, 1, 0] }
          },
          today: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$callHistory.date', startOfToday] },
                    { $lte: ['$callHistory.date', endOfToday] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      }
    ];

    const statsResult = await Lead.aggregate(statsPipeline);
    const statObj = statsResult[0] || { total: 0, interested: 0, converted: 0, today: 0 };

    // Query Pipeline for Filtered List
    const matchFilter = {
      'callHistory.outcome': { $ne: 'Note Added' }
    };

    if (req.query.assignedTo && mongoose.isValidObjectId(req.query.assignedTo)) {
      matchFilter['callHistory.agent'] = new mongoose.Types.ObjectId(req.query.assignedTo);
    }

    if (req.query.outcome) {
      matchFilter['callHistory.outcome'] = new RegExp(`^${req.query.outcome}$`, 'i');
    }

    if (req.query.callType) {
      matchFilter['callHistory.callType'] = new RegExp(`^${req.query.callType}$`, 'i');
    }

    if (req.query.completedDate) {
      const cDate = new Date(req.query.completedDate);
      if (!isNaN(cDate.getTime())) {
        const s = new Date(cDate);
        s.setHours(0, 0, 0, 0);
        const e = new Date(cDate);
        e.setHours(23, 59, 59, 999);
        matchFilter['callHistory.date'] = { $gte: s, $lte: e };
      }
    }

    const listPipeline = [
      { $match: { company: new mongoose.Types.ObjectId(company) } },
      {
        $project: {
          name: 1,
          phone: 1,
          remarks: 1,
          source: 1,
          leadSource: 1,
          leadType: 1,
          status: 1,
          attemptsCount: { $size: { $ifNull: ['$callHistory', []] } },
          callHistory: 1
        }
      },
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
          note: { $ifNull: ['$callHistory.notes', '$remarks'] },
          source: { $ifNull: [{ $arrayElemAt: ['$sourceObj.name', 0] }, '$source'] },
          leadType: { $ifNull: [{ $arrayElemAt: ['$typeObj.name', 0] }, 'General'] },
          leadStatus: '$status',
          outcome: '$callHistory.outcome',
          callType: '$callHistory.callType',
          completedAt: '$callHistory.date',
          attempts: '$attemptsCount',
          assignedTo: {
            $ifNull: [{ $arrayElemAt: ['$agentObj.name', 0] }, '$callHistory.createdByName']
          },
          remarks: '$callHistory.notes'
        }
      }
    ];

    if (req.query.source) {
      listPipeline.push({ $match: { source: new RegExp(`^${req.query.source}$`, 'i') } });
    }
    if (req.query.leadType) {
      listPipeline.push({ $match: { leadType: new RegExp(`^${req.query.leadType}$`, 'i') } });
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
            { assignedTo: regex }
          ]
        }
      });
    }

    // Count & Paginate
    const countPipeline = [...listPipeline, { $count: 'total' }];
    const countResult = await Lead.aggregate(countPipeline);
    const total = countResult[0]?.total || 0;

    listPipeline.push({ $sort: { completedAt: -1 } });
    listPipeline.push({ $skip: skip });
    listPipeline.push({ $limit: limit });

    const results = await Lead.aggregate(listPipeline);

    const items = results.map((item, idx) => ({
      id: skip + idx + 1,
      leadMongoId: item.leadMongoId,
      leadId: formatLeadId(item.leadMongoId),
      name: item.name || 'Unnamed Lead',
      note: item.note || '',
      phone: item.phone || '—',
      source: item.source || 'Direct',
      leadType: item.leadType || 'General',
      leadStatus: item.leadStatus ? item.leadStatus.charAt(0).toUpperCase() + item.leadStatus.slice(1) : 'Active',
      outcome: item.outcome || 'Completed',
      callType: item.callType || 'Outbound',
      completedAt: item.completedAt ? new Date(item.completedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '—',
      attempts: item.attempts || 1,
      assignedTo: item.assignedTo || 'Telecaller',
      remarks: item.remarks || ''
    }));

    res.json({
      stats: {
        totalCompletedCount: statObj.total,
        interestedCount: statObj.interested,
        todayCompletedCount: statObj.today,
        convertedCount: statObj.converted
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

