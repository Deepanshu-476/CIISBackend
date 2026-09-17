const mongoose = require('mongoose');
const Lead = require('../../models/Lead');

function formatLeadId(id) {
  return id ? `#LD-${String(id).slice(-6).toUpperCase()}` : '#LD-000';
}

function formatCurrency(amount) {
  if (!amount && amount !== 0) return '—';
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}

exports.getConvertedCalls = async (req, res, next) => {
  try {
    const company = req.crmCompany;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    // Calculate Top Stats
    const statsPipeline = [
      {
        $match: {
          company: new mongoose.Types.ObjectId(company),
          $or: [{ status: 'converted' }, { 'callHistory.outcome': 'Converted' }]
        }
      },
      {
        $project: {
          status: 1,
          convertedAt: { $ifNull: ['$convertedAt', '$updatedAt'] },
          convertedCall: {
            $filter: {
              input: '$callHistory',
              as: 'call',
              cond: { $eq: ['$$call.outcome', 'Converted'] }
            }
          }
        }
      },
      {
        $project: {
          convertedAt: 1,
          callType: {
            $ifNull: [{ $arrayElemAt: ['$convertedCall.callType', -1] }, 'Outbound']
          }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          inbound: {
            $sum: { $cond: [{ $regexMatch: { input: '$callType', regex: /^inbound$/i } }, 1, 0] }
          },
          outbound: {
            $sum: { $cond: [{ $regexMatch: { input: '$callType', regex: /^outbound$/i } }, 1, 0] }
          },
          today: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$convertedAt', startOfToday] },
                    { $lte: ['$convertedAt', endOfToday] }
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
    const statObj = statsResult[0] || { total: 0, inbound: 0, outbound: 0, today: 0 };

    // Query Leads
    const filter = {
      company,
      $or: [{ status: 'converted' }, { 'callHistory.outcome': 'Converted' }]
    };

    if (req.query.assignedTo && mongoose.isValidObjectId(req.query.assignedTo)) {
      filter.assignedTo = req.query.assignedTo;
    }

    if (req.query.source) {
      if (mongoose.isValidObjectId(req.query.source)) {
        filter.leadSource = req.query.source;
      } else {
        filter.source = new RegExp(`^${req.query.source}$`, 'i');
      }
    }

    if (req.query.leadType) {
      if (mongoose.isValidObjectId(req.query.leadType)) {
        filter.leadType = req.query.leadType;
      }
    }

    if (req.query.completedDate) {
      const cDate = new Date(req.query.completedDate);
      if (!isNaN(cDate.getTime())) {
        const s = new Date(cDate);
        s.setHours(0, 0, 0, 0);
        const e = new Date(cDate);
        e.setHours(23, 59, 59, 999);
        filter.convertedAt = { $gte: s, $lte: e };
      }
    }

    if (req.query.search) {
      const q = String(req.query.search).trim();
      const regex = new RegExp(q, 'i');
      filter.$or = [
        { name: regex },
        { phone: regex },
        { email: regex },
        { enrolledCourse: regex },
        { remarks: regex }
      ];
    }

    let query = Lead.find(filter)
      .populate('assignedTo', 'name email')
      .populate('leadSource', 'name')
      .populate('leadType', 'name')
      .sort({ convertedAt: -1, updatedAt: -1, _id: -1 });

    const [total, leads] = await Promise.all([
      Lead.countDocuments(filter),
      query.skip(skip).limit(limit).lean()
    ]);

    const items = leads.map((lead, idx) => {
      const convertedCall = [...(lead.callHistory || [])]
        .reverse()
        .find(c => c.outcome === 'Converted') || lead.callHistory?.[lead.callHistory.length - 1];

      const callType = convertedCall?.callType || 'Outbound';
      const completedAt = lead.convertedAt || convertedCall?.date || lead.updatedAt;

      return {
        id: skip + idx + 1,
        leadMongoId: lead._id,
        leadId: formatLeadId(lead._id),
        name: lead.name || 'Unnamed Lead',
        note: lead.remarks || (lead.enrolledCourse ? `Enrolled in ${lead.enrolledCourse}` : ''),
        phone: lead.phone || '—',
        source: lead.leadSource?.name || lead.source || 'Direct',
        leadType: lead.leadType?.name || 'General',
        leadStatus: 'Converted',
        outcome: 'Converted',
        callType,
        completedAt: completedAt ? new Date(completedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '—',
        attempts: lead.callHistory ? lead.callHistory.length : 1,
        assignedTo: lead.assignedTo?.name || 'Telecaller',
        conversionValue: formatCurrency(lead.conversionValue),
        rawConversionValue: lead.conversionValue || 0,
        enrolledCourse: lead.enrolledCourse || lead.leadType?.name || 'Academic Program',
        paymentStatus: lead.paymentStatus || 'Paid',
        remarks: convertedCall?.notes || lead.remarks || 'Customer converted via phone consultation.'
      };
    });

    res.json({
      stats: {
        totalConverted: statObj.total,
        inboundCount: statObj.inbound,
        convertedToday: statObj.today,
        outboundCount: statObj.outbound
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

