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

exports.getScheduledCalls = async (req, res, next) => {
  try {
    const company = req.crmCompany;

    const filter = {
      company,
      nextFollowUp: { $exists: true, $ne: null }
    };

    // Date filter (defaults to given date or matches full day)
    if (req.query.date) {
      const targetDate = new Date(req.query.date);
      if (!isNaN(targetDate.getTime())) {
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);
        filter.nextFollowUp = { $gte: startOfDay, $lte: endOfDay };
      }
    }

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
      if (req.query.status.toLowerCase() === 'completed') {
        filter.status = { $in: ['converted', 'closed'] };
      } else if (req.query.status.toLowerCase() === 'scheduled') {
        filter.status = 'follow-up';
      } else {
        filter.status = new RegExp(`^${req.query.status}$`, 'i');
      }
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const [total, leads] = await Promise.all([
      Lead.countDocuments(filter),
      Lead.find(filter)
        .populate('assignedTo', 'name email')
        .populate('leadSource', 'name')
        .populate('leadType', 'name')
        .sort({ nextFollowUp: 1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    const calls = leads.map((lead, index) => {
      const attempts = lead.callHistory ? lead.callHistory.length : 0;
      let lastCall = 'Never Called';
      if (attempts > 0) {
        const sorted = [...lead.callHistory].sort((a, b) => new Date(b.date) - new Date(a.date));
        lastCall = sorted[0]?.date
          ? new Date(sorted[0].date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
          : 'Called';
      }

      return {
        id: skip + index + 1,
        leadMongoId: lead._id,
        lead: formatLeadId(lead._id),
        name: lead.name || 'Unnamed Lead',
        phone: lead.phone || '—',
        source: lead.leadSource?.name || lead.source || 'Direct',
        leadType: lead.leadType?.name || 'General',
        status: lead.status === 'follow-up' ? 'Scheduled' : (lead.status ? lead.status.charAt(0).toUpperCase() + lead.status.slice(1) : 'Scheduled'),
        lastCall,
        scheduledDate: lead.nextFollowUp
          ? new Date(lead.nextFollowUp).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
          : '—',
        assignedAge: timeAgo(lead.assignedAt || lead.createdAt),
        attempts,
        assignedTo: lead.assignedTo?.name || 'Telecaller'
      };
    });

    res.json({
      calls,
      total,
      page,
      pageSize: limit,
      totalPages
    });
  } catch (error) {
    next(error);
  }
};

