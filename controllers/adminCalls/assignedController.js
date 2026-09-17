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

exports.getAssignedCalls = async (req, res, next) => {
  try {
    const company = req.crmCompany;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    const filter = {
      company,
      assignedTo: { $ne: null }
    };

    if (req.query.assignedTo) {
      if (mongoose.isValidObjectId(req.query.assignedTo)) {
        filter.assignedTo = req.query.assignedTo;
      }
    }

    if (req.query.source) {
      if (mongoose.isValidObjectId(req.query.source)) {
        filter.leadSource = req.query.source;
      } else {
        filter.source = new RegExp(`^${req.query.source}$`, 'i');
      }
    }

    if (req.query.type) {
      if (mongoose.isValidObjectId(req.query.type)) {
        filter.leadType = req.query.type;
      }
    }

    if (req.query.from || req.query.to) {
      filter.assignedAt = {};
      if (req.query.from) {
        const fromDate = new Date(req.query.from);
        fromDate.setHours(0, 0, 0, 0);
        filter.assignedAt.$gte = fromDate;
      }
      if (req.query.to) {
        const toDate = new Date(req.query.to);
        toDate.setHours(23, 59, 59, 999);
        filter.assignedAt.$lte = toDate;
      }
    }

    if (req.query.search) {
      const q = String(req.query.search).trim();
      const regex = new RegExp(q, 'i');
      filter.$or = [
        { name: regex },
        { phone: regex },
        { email: regex },
        { remarks: regex },
        { source: regex }
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

    const items = leads.map((lead, idx) => ({
      id: skip + idx + 1,
      leadMongoId: lead._id,
      leadId: formatLeadId(lead._id),
      lead: lead.name || 'Unnamed Lead',
      note: lead.remarks || (lead.callHistory?.length ? lead.callHistory[lead.callHistory.length - 1].notes : 'Assigned inquiry'),
      phone: lead.phone || '—',
      source: lead.leadSource?.name || lead.source || 'Direct',
      type: lead.leadType?.name || 'General',
      status: lead.status ? lead.status.charAt(0).toUpperCase() + lead.status.slice(1) : 'Assigned',
      assignedTo: lead.assignedTo?.name || 'Assigned User',
      assignedUserId: lead.assignedTo?._id || null,
      assignedDate: lead.assignedAt ? new Date(lead.assignedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
      age: timeAgo(lead.assignedAt || lead.createdAt)
    }));

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

