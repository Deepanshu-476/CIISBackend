const mongoose = require('mongoose');
const AssetRequest = require('../models/AssetRequest');
const CompanyAsset = require('../../models/CompanyAsset');
const User = require('../../models/User');

// ✅ USER: Get available company assets for dropdown
exports.getAvailableAssets = async (req, res) => {
  try {
    console.log('🔍 Fetching available assets for user:', req.user._id);
    
    const query = { 
      companyCode: req.user.companyCode,
      status: 'Available'  // Sirf available assets dikhao
    };
    
    const assets = await CompanyAsset.find(query)
      .select('name description status companyCode')
      .sort({ name: 1 });
    
    console.log(`✅ Found ${assets.length} available assets`);
    
    res.status(200).json({
      success: true,
      assets: assets
    });
    
  } catch (err) {
    console.error('❌ Error fetching available assets:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Server error while fetching assets' 
    });
  }
};

// ✅ USER: Request an asset from company assets
exports.requestAsset = async (req, res) => {
  try {
    const { assetId, reason, expectedReturnDate } = req.body;
    
    console.log('🔍 Asset request received:', {
      userId: req.user._id,
      assetId,
      reason,
      expectedReturnDate
    });

    // Validate asset ID
    if (!assetId || !mongoose.Types.ObjectId.isValid(assetId)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Valid asset ID is required' 
      });
    }

    // Check if asset exists and is available
    const asset = await CompanyAsset.findOne({
      _id: assetId,
      companyCode: req.user.companyCode
    });

    if (!asset) {
      return res.status(404).json({ 
        success: false, 
        error: 'Asset not found in your company' 
      });
    }

    if (asset.status !== 'Available') {
      return res.status(400).json({ 
        success: false, 
        error: `Asset is not available (Current status: ${asset.status})` 
      });
    }

    // Check for existing pending request for this asset
    const existingRequest = await AssetRequest.findOne({
      asset: assetId,
      user: req.user._id,
      status: { $in: ['pending', 'approved'] }
    });

    if (existingRequest) {
      return res.status(409).json({ 
        success: false, 
        error: 'You already have a pending or approved request for this asset' 
      });
    }

    // Create new request
    const newRequest = new AssetRequest({
      user: req.user._id,
      asset: assetId,
      assetName: asset.name,
      assetStatus: asset.status,
      companyCode: req.user.companyCode,
      department: req.user.department || 'General',
      reason: reason || 'No reason provided',
      expectedReturnDate: expectedReturnDate || null,
      requestDate: new Date()
    });

    await newRequest.save();
    
    // Populate user and asset details for response
    await newRequest.populate([
      { path: 'user', select: 'name email department' },
      { path: 'asset', select: 'name description status' }
    ]);

    console.log('✅ Asset request created successfully:', newRequest._id);

    return res.status(201).json({
      success: true,
      message: '✅ Asset request submitted successfully',
      request: newRequest
    });

  } catch (err) {
    console.error('❌ Asset request error:', err);
    return res.status(500).json({ 
      success: false, 
      error: 'Server error while submitting request' 
    });
  }
};

// ✅ USER: Get my asset requests
exports.getMyRequests = async (req, res) => {
  try {
    console.log('🔍 Fetching requests for user:', req.user._id);
    
    const requests = await AssetRequest.find({ 
      user: req.user._id,
      companyCode: req.user.companyCode 
    })
      .populate('asset', 'name description status')
      .populate('approvedBy', 'name email')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: requests.length,
      requests
    });

  } catch (err) {
    console.error('❌ Fetch my requests error:', err);
    return res.status(500).json({ 
      success: false, 
      error: 'Server error while fetching requests' 
    });
  }
};

// ✅ USER: Cancel my pending request
exports.cancelRequest = async (req, res) => {
  try {
    const { id } = req.params;
    
    const request = await AssetRequest.findOne({
      _id: id,
      user: req.user._id,
      status: 'pending'
    });

    if (!request) {
      return res.status(404).json({ 
        success: false, 
        error: 'Pending request not found' 
      });
    }

    request.status = 'cancelled';
    await request.save();

    res.status(200).json({
      success: true,
      message: '✅ Request cancelled successfully'
    });

  } catch (err) {
    console.error('❌ Cancel request error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Server error while cancelling request' 
    });
  }
};

// ✅ ADMIN: Get all requests with filters
exports.getAllRequests = async (req, res) => {
  try {
    const { status, department, assetId } = req.query;
    const filter = { companyCode: req.user.companyCode };

    if (status) filter.status = status;
    if (department) filter.department = department;
    if (assetId && mongoose.Types.ObjectId.isValid(assetId)) {
      filter.asset = assetId;
    }

    const requests = await AssetRequest.find(filter)
      .populate('user', 'name email department')
      .populate('asset', 'name description status')
      .populate('approvedBy', 'name email')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: requests.length,
      requests
    });

  } catch (err) {
    console.error('❌ Admin fetch error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Server error while fetching requests' 
    });
  }
};

// ✅ ADMIN: Update request status (approve/reject)
exports.updateRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminComment } = req.body;
    
    const validStatuses = ['approved', 'rejected', 'completed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid status' 
      });
    }

    const request = await AssetRequest.findOne({
      _id: id,
      companyCode: req.user.companyCode
    }).populate('asset');

    if (!request) {
      return res.status(404).json({ 
        success: false, 
        error: 'Request not found' 
      });
    }

    // If approving, check if asset is still available
    if (status === 'approved' && request.asset.status !== 'Available') {
      return res.status(400).json({ 
        success: false, 
        error: `Asset is no longer available (Current: ${request.asset.status})` 
      });
    }

    // Update request
    request.status = status;
    request.adminComment = adminComment || '';
    request.decisionDate = new Date();
    request.approvedBy = req.user._id;

    // If approved, update asset status to 'Assigned'
    if (status === 'approved') {
      await CompanyAsset.findByIdAndUpdate(request.asset._id, {
        status: 'Assigned',
        assignedTo: request.user,
        assignedDate: new Date()
      });
    }

    // If completed, update asset status back to 'Available'
    if (status === 'completed') {
      await CompanyAsset.findByIdAndUpdate(request.asset._id, {
        status: 'Available',
        assignedTo: null,
        assignedDate: null
      });
      request.actualReturnDate = new Date();
    }

    await request.save();

    res.status(200).json({
      success: true,
      message: `✅ Request ${status} successfully`,
      request
    });

  } catch (err) {
    console.error('❌ Status update error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Server error while updating status' 
    });
  }
};

// ✅ ADMIN: Delete request
exports.deleteRequest = async (req, res) => {
  try {
    const { id } = req.params;

    const request = await AssetRequest.findOne({
      _id: id,
      companyCode: req.user.companyCode
    });

    if (!request) {
      return res.status(404).json({ 
        success: false, 
        error: 'Request not found' 
      });
    }

    await request.deleteOne();

    res.status(200).json({
      success: true,
      message: '🗑️ Request deleted successfully'
    });

  } catch (err) {
    console.error('❌ Delete error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Server error while deleting request' 
    });
  }
};

// ✅ Get asset request statistics
exports.getRequestStats = async (req, res) => {
  try {
    const stats = await AssetRequest.aggregate([
      { $match: { companyCode: req.user.companyCode } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const total = await AssetRequest.countDocuments({ 
      companyCode: req.user.companyCode 
    });

    res.status(200).json({
      success: true,
      total,
      stats
    });

  } catch (err) {
    console.error('❌ Stats error:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Server error while fetching stats' 
    });
  }
};

console.log("✅ assetRequestController.js loaded");