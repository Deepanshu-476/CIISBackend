const DemoRequest = require('../models/DemoRequest');

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

    const demoRequests = await DemoRequest.find(query).sort({ createdAt: -1 });

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
      data: demoRequests,
      count: demoRequests.length,
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
      return res.status(404).json({ success: false, message: 'Demo request not found' });
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
      return res.status(404).json({ success: false, message: 'Demo request not found' });
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
