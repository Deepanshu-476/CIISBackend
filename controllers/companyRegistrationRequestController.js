const CompanyRegistrationRequest = require('../models/CompanyRegistrationRequest');

const clean = (value) => String(value || '').trim();

const createOrUpdateRegistrationRequest = async (req, res) => {
  try {
    const companyName = clean(req.body.companyName);
    const companyEmail = clean(req.body.companyEmail).toLowerCase();
    const companyPhone = clean(req.body.companyPhone).replace(/\D/g, '');
    const companyAddress = clean(req.body.companyAddress);
    const department = clean(req.body.department) || 'Management';
    const source = clean(req.body.source) || '/RegisterCompany';

    if (!companyName) {
      return res.status(400).json({ success: false, message: 'Company name is required' });
    }
    if (!companyEmail) {
      return res.status(400).json({ success: false, message: 'Company email is required' });
    }
    if (!companyPhone) {
      return res.status(400).json({ success: false, message: 'Company phone is required' });
    }
    if (!companyAddress) {
      return res.status(400).json({ success: false, message: 'Company address is required' });
    }

    const request = await CompanyRegistrationRequest.findOneAndUpdate(
      { companyEmail, status: { $ne: 'Converted' } },
      {
        $set: {
          companyName,
          companyEmail,
          companyPhone,
          companyAddress,
          department,
          source,
          status: 'Profile Completed'
        }
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    res.status(201).json({
      success: true,
      message: 'Company profile request saved',
      data: request
    });
  } catch (error) {
    console.error('Error saving company registration request:', error);
    res.status(500).json({
      success: false,
      message: 'Error saving company profile request',
      error: error.message
    });
  }
};

const getRegistrationRequests = async (req, res) => {
  try {
    const { status } = req.query;
    const query = {};
    if (status && status !== 'All') query.status = status;

    const requests = await CompanyRegistrationRequest.find(query)
      .populate('convertedCompany', 'companyName companyCode')
      .sort({ createdAt: -1 })
      .lean();

    res.json({
      success: true,
      data: requests,
      count: requests.length
    });
  } catch (error) {
    console.error('Error fetching company registration requests:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching company registration requests',
      error: error.message
    });
  }
};

const updateRegistrationRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const updateFields = {};
    if (req.body.status !== undefined) {
      const allowedStatuses = ['Profile Completed', 'Converted', 'Archived'];
      if (!allowedStatuses.includes(req.body.status)) {
        return res.status(400).json({ success: false, message: 'Invalid status value' });
      }
      updateFields.status = req.body.status;
    }
    if (req.body.convertedCompany !== undefined) {
      updateFields.convertedCompany = req.body.convertedCompany || null;
    }

    const request = await CompanyRegistrationRequest.findByIdAndUpdate(
      id,
      { $set: updateFields },
      { new: true, runValidators: true }
    );

    if (!request) {
      return res.status(404).json({ success: false, message: 'Company registration request not found' });
    }

    res.json({
      success: true,
      message: 'Company registration request updated',
      data: request
    });
  } catch (error) {
    console.error('Error updating company registration request:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating company registration request',
      error: error.message
    });
  }
};

module.exports = {
  createOrUpdateRegistrationRequest,
  getRegistrationRequests,
  updateRegistrationRequest
};
