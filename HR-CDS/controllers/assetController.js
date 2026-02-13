const mongoose = require('mongoose');
const AssetRequest = require('../models/AssetRequest');
const User = require('../../models/User');

// 🔘 USER: Request an Asset (updated with company)
exports.requestAsset = async (req, res) => {
  try {
    const { assetName } = req.body;
    const allowedAssets = ['phone', 'sim', 'laptop', 'desktop', 'headphone'];

    if (!assetName || !allowedAssets.includes(assetName.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid or missing asset name' });
    }

    // Get company code from user (from localStorage - coming from frontend)
    const companyCode = req.user.companyCode || req.body.companyCode;
    
    if (!companyCode) {
      return res.status(400).json({ error: 'Company code is required' });
    }

    // Check for duplicate pending request
    const duplicate = await AssetRequest.findOne({
      user: req.user._id,
      assetName: assetName.toLowerCase(),
      status: 'pending',
      companyCode: companyCode
    });

    if (duplicate) {
      return res.status(409).json({ error: 'You already have a pending request for this asset' });
    }

    const newRequest = new AssetRequest({
      user: req.user._id,
      assetName: assetName.toLowerCase(),
      companyCode: companyCode,
      department: req.user.department || 'General'
    });

    await newRequest.save();

    return res.status(201).json({
      message: '✅ Asset request submitted successfully',
      request: newRequest,
    });

  } catch (err) {
    console.error('❌ [Asset Request Error]', err);
    return res.status(500).json({ error: 'Server error while submitting request' });
  }
};

// 🔘 USER: Get All My Asset Requests
exports.getMyRequests = async (req, res) => {
  try {
    const requests = await AssetRequest.find({ 
      user: req.user._id,
      companyCode: req.user.companyCode 
    })
      .sort({ createdAt: -1 })
      .populate('approvedBy', 'name role -_id');

    return res.status(200).json({
      message: '✅ Requests fetched successfully',
      count: requests.length,
      requests,
    });

  } catch (err) {
    console.error('❌ [Fetch Requests Error]', err);
    return res.status(500).json({ error: 'Server error while fetching requests' });
  }
};

// 🔘 ADMIN: Get All Requests with Filters (updated with companyCode)
exports.getAllRequests = async (req, res) => {
  try {
    const { status, user, companyCode, department } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (user && mongoose.Types.ObjectId.isValid(user)) {
      filter.user = user;
    }
    
    // Add company code filter (from admin's localStorage)
    if (req.user.companyCode) {
      filter.companyCode = req.user.companyCode;
    } else if (companyCode) {
      // Optional: if admin wants to filter by specific company
      filter.companyCode = companyCode;
    }
    
    // Add department filter
    if (department) {
      filter.department = { $regex: new RegExp(department, 'i') };
    }

    const requests = await AssetRequest.find(filter)
      .sort({ createdAt: -1 })
      .populate('user', 'name email role department')
      .populate('approvedBy', 'name role');

    return res.status(200).json({
      message: '✅ All asset requests fetched successfully',
      count: requests.length,
      requests,
    });

  } catch (err) {
    console.error('❌ [Admin Fetch Error]', err);
    return res.status(500).json({ error: 'Server error while fetching all requests' });
  }
};

// 🔘 ADMIN: Get Requests by Company
exports.getRequestsByCompany = async (req, res) => {
  try {
    const { companyCode } = req.params;
    const { status, department } = req.query;

    if (!companyCode) {
      return res.status(400).json({ error: 'Company code is required' });
    }

    const filter = { companyCode };
    
    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      filter.status = status;
    }
    
    if (department) {
      filter.department = { $regex: new RegExp(department, 'i') };
    }

    const requests = await AssetRequest.find(filter)
      .sort({ createdAt: -1 })
      .populate('user', 'name email department role')
      .populate('approvedBy', 'name role');

    return res.status(200).json({
      message: '✅ Company-wise asset requests fetched successfully',
      count: requests.length,
      companyCode,
      requests,
    });

  } catch (err) {
    console.error('❌ [Company-wise Fetch Error]', err);
    return res.status(500).json({ error: 'Server error while fetching company-wise requests' });
  }
};

// 🔘 ADMIN: Get Requests by Department
exports.getRequestsByDepartment = async (req, res) => {
  try {
    const { department } = req.params;
    const { status } = req.query;
    
    if (!department) {
      return res.status(400).json({ error: 'Department parameter is required' });
    }

    const filter = { 
      department: { $regex: new RegExp(department, 'i') }
    };
    
    // Add company code filter from admin's localStorage
    if (req.user.companyCode) {
      filter.companyCode = req.user.companyCode;
    }
    
    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      filter.status = status;
    }

    const requests = await AssetRequest.find(filter)
      .sort({ createdAt: -1 })
      .populate('user', 'name email department role')
      .populate('approvedBy', 'name role');

    return res.status(200).json({
      message: '✅ Department-wise asset requests fetched successfully',
      count: requests.length,
      department,
      companyCode: req.user.companyCode || 'All',
      requests,
    });

  } catch (err) {
    console.error('❌ [Department-wise Fetch Error]', err);
    return res.status(500).json({ error: 'Server error while fetching department-wise requests' });
  }
};

// 🔘 ADMIN: Update Request Status
exports.updateRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, comment } = req.body;
    const allowedStatuses = ['pending', 'approved', 'rejected'];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status value' });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid request ID' });
    }

    const request = await AssetRequest.findById(id);
    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    // Check if admin belongs to same company
    if (req.user.companyCode && request.companyCode !== req.user.companyCode) {
      return res.status(403).json({ error: 'You can only update requests from your company' });
    }

    request.status = status;
    request.adminComment = comment || '';
    request.decisionDate = new Date();
    request.approvedBy = status === 'approved' ? req.user._id : null;

    await request.save();

    return res.status(200).json({
      message: `✅ Request ${status} successfully`,
      request,
    });

  } catch (err) {
    console.error('❌ [Status Update Error]', err);
    return res.status(500).json({ error: 'Server error while updating request status' });
  }
};

// 🔘 ADMIN: Delete Asset Request
exports.deleteRequest = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Invalid request ID' });
    }

    const request = await AssetRequest.findById(id);
    
    if (!request) {
      return res.status(404).json({ error: 'Request not found or already deleted' });
    }
    
    // Check if admin belongs to same company
    if (req.user.companyCode && request.companyCode !== req.user.companyCode) {
      return res.status(403).json({ error: 'You can only delete requests from your company' });
    }

    await AssetRequest.findByIdAndDelete(id);

    return res.status(200).json({ message: '🗑️ Request deleted successfully' });

  } catch (err) {
    console.error('❌ [Delete Error]', err);
    return res.status(500).json({ error: 'Server error while deleting request' });
  }
};
console.log("✅ assetController.js loaded successfully");