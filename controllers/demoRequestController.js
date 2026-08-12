const DemoRequest = require('../models/DemoRequest');
const ServiceEnquiry = require('../HR-CDS/models/ServiceEnquiry');

const legacyDemoQuery = {
  $or: [
    { serviceName: /demo/i },
    { requirement: /Demo Request:/i }
  ]
};

const legacyStatusMap = {
  Pending: 'New',
  Approved: 'Completed',
  Contacted: 'Contacted',
  'Proposal Sent': 'Scheduled',
  Closed: 'Completed'
};

const normalizeLegacyDemo = (item) => {
  const requirement = String(item.requirement || '');
  const match = (pattern) => requirement.match(pattern)?.[1]?.trim() || '';
  return {
    _id: item._id,
    name: item.clientName || 'Demo Lead',
    email: match(/Email:\s*([^\s,]+)/i),
    phone: match(/Phone:\s*([^\s,]+)/i),
    companyName: item.companyName || '',
    employeeCount: match(/Demo Request:\s*([^.]+)/i).replace(/Employees/i, '').trim(),
    requirements: match(/Requirements:\s*(.*?)(?=\.\s*Message:|\.\s*Phone:|$)/i),
    message: match(/Message:\s*(.*?)(?=\.\s*Phone:|\.\s*Email:|$)/i),
    status: item.demoStatus || legacyStatusMap[item.status] || 'New',
    notes: item.notes || '',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    isLegacy: true
  };
};

// Create a new Demo Request (Public submission from landing page)
const createDemoRequest = async (req, res) => {
  try {
    const { name, email, phone, companyName, employeeCount, requirements, message } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Full name is required' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, message: 'Email address is required' });
    }
    if (!phone || !phone.trim()) {
      return res.status(400).json({ success: false, message: 'Phone number is required' });
    }
    if (!companyName || !companyName.trim()) {
      return res.status(400).json({ success: false, message: 'Company name is required' });
    }

    const demoRequest = await DemoRequest.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      companyName: companyName.trim(),
      employeeCount: employeeCount ? employeeCount.trim() : '11-50',
      requirements: requirements ? requirements.trim() : '',
      message: message ? message.trim() : '',
      status: 'New'
    });

    res.status(201).json({
      success: true,
      message: 'Demo request submitted successfully!',
      data: demoRequest
    });
  } catch (error) {
    console.error('Error creating demo request:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting demo request',
      error: error.message
    });
  }
};

// Get all Demo Requests (SuperAdmin dashboard)
const getDemoRequests = async (req, res) => {
  try {
    const { status, search } = req.query;
    const query = {};

    if (status && status !== 'All') {
      query.status = status;
    }

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [
        { name: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
        { companyName: searchRegex },
        { message: searchRegex }
      ];
    }

    const [demoRequests, legacyRequests] = await Promise.all([
      DemoRequest.find(query).sort({ createdAt: -1 }),
      ServiceEnquiry.find(legacyDemoQuery).sort({ createdAt: -1 }).lean()
    ]);
    const combinedRequests = [
      ...demoRequests.map(item => item.toObject()),
      ...legacyRequests.map(normalizeLegacyDemo)
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const stats = {
      total: await DemoRequest.countDocuments(),
      new: await DemoRequest.countDocuments({ status: 'New' }),
      pending: await DemoRequest.countDocuments({ status: 'Pending' }),
      contacted: await DemoRequest.countDocuments({ status: 'Contacted' }),
      scheduled: await DemoRequest.countDocuments({ status: 'Scheduled' }),
      completed: await DemoRequest.countDocuments({ status: 'Completed' }),
      rejected: await DemoRequest.countDocuments({ status: 'Rejected' })
    };

    res.json({
      success: true,
      data: combinedRequests,
      count: combinedRequests.length,
      stats
    });
  } catch (error) {
    console.error('Error fetching demo requests:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching demo requests',
      error: error.message
    });
  }
};

// Update Demo Request Status or Notes
const updateDemoRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const updateFields = {};
    if (status) {
      const allowedStatuses = ['New', 'Pending', 'Contacted', 'Scheduled', 'Completed', 'Rejected'];
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status value' });
      }
      updateFields.status = status;
    }

    if (notes !== undefined) {
      updateFields.notes = notes;
    }

    const demoRequest = await DemoRequest.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    if (!demoRequest) {
      const legacyRequest = await ServiceEnquiry.findOneAndUpdate(
        { _id: id, ...legacyDemoQuery },
        { $set: {
          ...(status ? { demoStatus: status } : {}),
          ...(notes !== undefined ? { notes } : {})
        } },
        { new: true, runValidators: true }
      );
      if (!legacyRequest) {
        return res.status(404).json({ success: false, message: 'Demo request not found' });
      }
      return res.json({
        success: true,
        message: 'Demo request updated successfully',
        data: normalizeLegacyDemo(legacyRequest.toObject())
      });
    }

    res.json({
      success: true,
      message: 'Demo request updated successfully',
      data: demoRequest
    });
  } catch (error) {
    console.error('Error updating demo request:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating demo request',
      error: error.message
    });
  }
};

// Delete Demo Request
const deleteDemoRequest = async (req, res) => {
  try {
    const { id } = req.params;

    const demoRequest = await DemoRequest.findByIdAndDelete(id);

    if (!demoRequest) {
      const legacyRequest = await ServiceEnquiry.findOneAndDelete({ _id: id, ...legacyDemoQuery });
      if (!legacyRequest) {
        return res.status(404).json({ success: false, message: 'Demo request not found' });
      }
    }

    res.json({
      success: true,
      message: 'Demo request deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting demo request:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting demo request',
      error: error.message
    });
  }
};

module.exports = {
  createDemoRequest,
  getDemoRequests,
  updateDemoRequest,
  deleteDemoRequest
};
