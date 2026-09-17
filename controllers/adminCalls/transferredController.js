const mongoose = require('mongoose');
const LeadTransfer = require('../../models/LeadTransfer');
const Lead = require('../../models/Lead');

function formatLeadId(id) {
  return id ? `#LD-${String(id).slice(-6).toUpperCase()}` : '#LD-000';
}

exports.getTransferredCalls = async (req, res, next) => {
  try {
    const company = req.crmCompany;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit) || 10));
    const skip = (page - 1) * limit;

    // Overall Stats
    const [totalTransferred, acceptedCount, pendingCount] = await Promise.all([
      LeadTransfer.countDocuments({ company }),
      LeadTransfer.countDocuments({ company, status: 'Accepted' }),
      LeadTransfer.countDocuments({ company, status: { $in: ['Transferred', 'Pending'] } })
    ]);

    const filter = { company };

    if (req.query.from && mongoose.isValidObjectId(req.query.from)) {
      filter.transferredFrom = req.query.from;
    }
    if (req.query.to && mongoose.isValidObjectId(req.query.to)) {
      filter.transferredTo = req.query.to;
    }

    if (req.query.dateFrom || req.query.dateTo) {
      filter.dateTime = {};
      if (req.query.dateFrom) {
        const s = new Date(req.query.dateFrom);
        s.setHours(0, 0, 0, 0);
        filter.dateTime.$gte = s;
      }
      if (req.query.dateTo) {
        const e = new Date(req.query.dateTo);
        e.setHours(23, 59, 59, 999);
        filter.dateTime.$lte = e;
      }
    }

    const [total, transfers] = await Promise.all([
      LeadTransfer.countDocuments(filter),
      LeadTransfer.find(filter)
        .populate('lead', 'name phone remarks leadSource leadType')
        .populate('transferredFrom', 'name email')
        .populate('transferredTo', 'name email')
        .populate('transferredBy', 'name email')
        .sort({ dateTime: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    let items = transfers.map((trf, idx) => ({
      id: skip + idx + 1,
      transferId: trf._id,
      leadMongoId: trf.lead?._id,
      leadId: formatLeadId(trf.lead?._id),
      name: trf.lead?.name || 'Unnamed Lead',
      phone: trf.lead?.phone || '—',
      transferredFrom: trf.transferredFrom?.name || 'Telecaller 1',
      transferredFromId: trf.transferredFrom?._id,
      transferredTo: trf.transferredTo?.name || 'Telecaller 2',
      transferredToId: trf.transferredTo?._id,
      reason: trf.reason || 'Lead reassignment',
      dateTime: trf.dateTime ? new Date(trf.dateTime).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '—',
      status: trf.status || 'Transferred',
      transferredBy: trf.transferredBy?.name || 'Manager',
      notes: trf.notes || ''
    }));

    if (req.query.search) {
      const q = String(req.query.search).toLowerCase().trim();
      items = items.filter(i =>
        i.leadId.toLowerCase().includes(q) ||
        i.name.toLowerCase().includes(q) ||
        i.phone.includes(q) ||
        i.transferredFrom.toLowerCase().includes(q) ||
        i.transferredTo.toLowerCase().includes(q) ||
        i.reason.toLowerCase().includes(q) ||
        i.transferredBy.toLowerCase().includes(q)
      );
    }

    res.json({
      stats: {
        totalTransferred,
        acceptedCount,
        pendingCount
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

exports.createTransfer = async (req, res, next) => {
  try {
    const company = req.crmCompany;
    const { leadId, transferredTo, reason = '', notes = '' } = req.body;

    if (!mongoose.isValidObjectId(leadId) || !mongoose.isValidObjectId(transferredTo)) {
      return res.status(400).json({ message: 'Valid Lead ID and destination User ID are required.' });
    }

    const lead = await Lead.findOne({ _id: leadId, company });
    if (!lead) return res.status(404).json({ message: 'Lead not found in this company.' });

    const transferredFrom = lead.assignedTo || req.user._id || req.user.id;

    const transfer = await LeadTransfer.create({
      lead: leadId,
      company,
      transferredFrom,
      transferredTo,
      transferredBy: req.user._id || req.user.id,
      reason: String(reason).trim(),
      notes: String(notes).trim(),
      status: 'Transferred',
      dateTime: new Date()
    });

    res.status(201).json({ transfer });
  } catch (error) {
    next(error);
  }
};

exports.acceptTransfer = async (req, res, next) => {
  try {
    const company = req.crmCompany;
    const { id } = req.params;

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid transfer ID.' });
    }

    const transfer = await LeadTransfer.findOne({ _id: id, company });
    if (!transfer) return res.status(404).json({ message: 'Transfer record not found.' });

    transfer.status = 'Accepted';
    await transfer.save();

    // Reassign lead to transferredTo user
    await Lead.updateOne(
      { _id: transfer.lead, company },
      { $set: { assignedTo: transfer.transferredTo, assignedAt: new Date() } }
    );

    res.json({ message: 'Transfer accepted successfully.', transfer });
  } catch (error) {
    next(error);
  }
};

