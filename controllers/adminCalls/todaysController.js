const mongoose = require('mongoose');
const Lead = require('../../models/Lead');

exports.getTodaysCalls = async (req, res, next) => {
  try {
    const company = req.crmCompany;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    // Match pipeline
    const matchStage = {
      company: new mongoose.Types.ObjectId(company),
      'callHistory.date': { $gte: startOfToday, $lte: endOfToday }
    };

    if (req.query.assignedTo && mongoose.isValidObjectId(req.query.assignedTo)) {
      matchStage['callHistory.agent'] = new mongoose.Types.ObjectId(req.query.assignedTo);
    }

    if (req.query.callType) {
      matchStage['callHistory.callType'] = new RegExp(`^${req.query.callType}$`, 'i');
    }

    const pipeline = [
      { $match: { company: new mongoose.Types.ObjectId(company) } },
      { $unwind: '$callHistory' },
      { $match: matchStage },
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
          lead: '$name',
          phone: '$phone',
          source: { $ifNull: [{ $arrayElemAt: ['$sourceObj.name', 0] }, '$source'] },
          sourceId: '$leadSource',
          leadType: { $ifNull: [{ $arrayElemAt: ['$typeObj.name', 0] }, 'General'] },
          typeId: '$leadType',
          callId: '$callHistory.id',
          callType: '$callHistory.callType',
          outcome: '$callHistory.outcome',
          notes: '$callHistory.notes',
          callDate: '$callHistory.date',
          assignedTo: {
            $ifNull: [{ $arrayElemAt: ['$agentObj.name', 0] }, '$callHistory.createdByName']
          },
          assignedToId: '$callHistory.agent'
        }
      },
      { $sort: { callDate: -1 } }
    ];

    let calls = await Lead.aggregate(pipeline);

    // In-memory filter for leadType/source string values if passed as text
    if (req.query.source && !mongoose.isValidObjectId(req.query.source)) {
      const src = req.query.source.toLowerCase();
      calls = calls.filter(c => String(c.source || '').toLowerCase() === src);
    }
    if (req.query.leadType && !mongoose.isValidObjectId(req.query.leadType)) {
      const lt = req.query.leadType.toLowerCase();
      calls = calls.filter(c => String(c.leadType || '').toLowerCase() === lt);
    }

    // Time filter (HH:mm)
    if (req.query.timeFrom || req.query.timeTo) {
      calls = calls.filter(c => {
        if (!c.callDate) return false;
        const callTime = new Date(c.callDate);
        const hours = String(callTime.getHours()).padStart(2, '0');
        const minutes = String(callTime.getMinutes()).padStart(2, '0');
        const timeStr = `${hours}:${minutes}`;

        if (req.query.timeFrom && timeStr < req.query.timeFrom) return false;
        if (req.query.timeTo && timeStr > req.query.timeTo) return false;
        return true;
      });
    }

    // Compute Stats
    const totalToday = calls.length;
    const connectedToday = calls.filter(c => ['Connected', 'Interested', 'Converted'].includes(c.outcome)).length;
    const interestedToday = calls.filter(c => c.outcome === 'Interested').length;
    const followupsToday = calls.filter(c => ['Follow-up', 'Need Callback', 'Call Later'].includes(c.outcome)).length;

    // Pagination
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;
    const total = totalToday;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const paginatedCalls = calls.slice(skip, skip + limit);

    const formattedCalls = paginatedCalls.map((c, index) => ({
      id: skip + index + 1,
      callId: c.callId,
      leadMongoId: c.leadMongoId,
      lead: c.lead || 'Unnamed Lead',
      time: c.callDate ? new Date(c.callDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : '—',
      rawTime: c.callDate,
      phone: c.phone || '—',
      source: c.source || 'Direct',
      leadType: c.leadType || 'General',
      callType: c.callType || 'Outbound',
      outcome: c.outcome || 'Logged',
      notes: c.notes || '',
      assignedTo: c.assignedTo || 'Telecaller'
    }));

    res.json({
      stats: {
        totalToday,
        connectedToday,
        interestedToday,
        followupsToday
      },
      calls: formattedCalls,
      total,
      page,
      pageSize: limit,
      totalPages
    });
  } catch (error) {
    next(error);
  }
};

