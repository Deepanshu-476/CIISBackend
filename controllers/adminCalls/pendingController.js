const mongoose = require('mongoose');
const Lead = require('../../models/Lead');

function formatLeadId(id) {
  return id ? `#LD-${String(id).slice(-6).toUpperCase()}` : '#LD-000';
}

function timeAgo(date) {
  if (!date) return '—';
  const seconds = Math.floor((new Date() - new Date(date)) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
}

exports.getPendingCalls = async (req, res, next) => {
  try {
    const company = req.crmCompany;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const filter = {
      company,
      assignedTo: { $ne: null },
      status: { $nin: ['converted', 'closed'] }
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

    if (req.query.status) {
      filter.status = new RegExp(`^${req.query.status}$`, 'i');
    }

    if (req.query.attempts !== undefined && req.query.attempts !== '') {
      const att = parseInt(req.query.attempts);
      if (att === 0) {
        filter.$or = [{ callHistory: { $exists: false } }, { callHistory: { $size: 0 } }];
      } else if (att >= 3) {
        filter['callHistory.2'] = { $exists: true }; // At least 3 elements
      } else if (!isNaN(att)) {
        filter.callHistory = { $size: att };
      }
    }

    if (req.query.search) {
      const q = String(req.query.search).trim();
      const regex = new RegExp(q, 'i');
      filter.$or = [
        { name: regex },
        { phone: regex },
        { email: regex },
        { source: regex },
        { remarks: regex }
      ];
    }

    const [total, leads] = await Promise.all([
      Lead.countDocuments(filter),
      Lead.find(filter)
        .populate('assignedTo', 'name email')
        .populate('leadSource', 'name')
        .populate('leadType', 'name')
        .sort({ assignedAt: -1, createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    const items = leads.map((lead, idx) => {
      const attempts = lead.callHistory ? lead.callHistory.length : 0;
      let lastCall = 'Never Called';
      if (attempts > 0) {
        const sortedCalls = [...lead.callHistory].sort((a, b) => new Date(b.date) - new Date(a.date));
        lastCall = sortedCalls[0]?.date
          ? new Date(sortedCalls[0].date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
          : 'Called';
      }

      const nextFollowup = lead.nextFollowUp
        ? new Date(lead.nextFollowUp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : 'Not Scheduled';

      const priority = attempts === 0 ? 'High' : attempts <= 2 ? 'Medium' : 'Low';

      return {
        id: skip + idx + 1,
        leadMongoId: lead._id,
        leadId: formatLeadId(lead._id),
        name: lead.name || 'Unnamed Lead',
        phone: lead.phone || '—',
        source: lead.leadSource?.name || lead.source || 'Direct',
        leadType: lead.leadType?.name || 'General',
        status: lead.status ? lead.status.charAt(0).toUpperCase() + lead.status.slice(1) : 'Assigned',
        lastCall,
        nextFollowup,
        assignedDate: lead.assignedAt ? new Date(lead.assignedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
        assignedAgo: timeAgo(lead.assignedAt || lead.createdAt),
        priority,
        assignedTo: lead.assignedTo?.name || 'Telecaller',
        attempts
      };
    });

    res.json({
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

