const ServiceEnquiry = require('../models/ServiceEnquiry');

const normalizeCompanyCode = value => (value ? String(value).trim().toUpperCase() : '');

const createServiceEnquiry = async (req, res) => {
  try {
    const {
      serviceName,
      requirement,
      budget,
      contactMethod,
      clientId,
      clientName,
      companyName,
      companyCode,
      companyIdentifier,
      requestedBy
    } = req.body;

    if (!serviceName || !String(serviceName).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Service name is required'
      });
    }

    const enquiry = await ServiceEnquiry.create({
      serviceName: String(serviceName).trim(),
      requirement: requirement ? String(requirement).trim() : '',
      budget: budget ? String(budget).trim() : '',
      contactMethod: contactMethod || 'WhatsApp',
      clientId: clientId || null,
      clientName: clientName ? String(clientName).trim() : '',
      companyName: companyName ? String(companyName).trim() : '',
      companyCode: normalizeCompanyCode(companyCode),
      companyIdentifier: companyIdentifier ? String(companyIdentifier).trim() : '',
      requestedBy: requestedBy || req.user?._id || null
    });

    res.status(201).json({
      success: true,
      message: 'Service enquiry submitted successfully',
      data: enquiry
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error submitting service enquiry',
      error: error.message
    });
  }
};

const getServiceEnquiries = async (req, res) => {
  try {
    const { companyCode, companyIdentifier, status } = req.query;
    const query = {};

    if (companyCode) query.companyCode = normalizeCompanyCode(companyCode);
    if (!companyCode && companyIdentifier) query.companyIdentifier = String(companyIdentifier).trim();
    if (status) query.status = status;

    const enquiries = await ServiceEnquiry.find(query).sort({ createdAt: -1 });

    res.json({
      success: true,
      data: enquiries,
      count: enquiries.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching service enquiries',
      error: error.message
    });
  }
};

const updateServiceEnquiryStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const allowedStatuses = ['Pending', 'Approved', 'Contacted', 'Proposal Sent', 'Closed'];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid enquiry status'
      });
    }

    const enquiry = await ServiceEnquiry.findByIdAndUpdate(
      id,
      { status },
      { new: true, runValidators: true }
    );

    if (!enquiry) {
      return res.status(404).json({
        success: false,
        message: 'Service enquiry not found'
      });
    }

    res.json({
      success: true,
      message: 'Service enquiry status updated successfully',
      data: enquiry
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating service enquiry status',
      error: error.message
    });
  }
};

module.exports = {
  createServiceEnquiry,
  getServiceEnquiries,
  updateServiceEnquiryStatus
};
