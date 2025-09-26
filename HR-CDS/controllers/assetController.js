const mongoose = require('mongoose');
const AssetRequest = require('../models/AssetRequest');
const User = require('../../models/User');

// 🔘 USER: Request an Asset
exports.requestAsset = async (req, res) => {
  try {
    const { assetName } = req.body;
    const allowedAssets = ['phone', 'sim', 'laptop', 'desktop', 'headphone'];

    if (!assetName || !allowedAssets.includes(assetName.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid or missing asset name' });
    }

    const duplicate = await AssetRequest.findOne({
      user: req.user._id,
      assetName: assetName.toLowerCase(),
      status: 'pending',
    });

    if (duplicate) {
      return res.status(409).json({ error: 'You already have a pending request for this asset' });
    }

    const newRequest = new AssetRequest({
      user: req.user._id,
      assetName: assetName.toLowerCase(),
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
    const requests = await AssetRequest.find({ user: req.user._id })
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

// 🔘 ADMIN: Get All Requests with Filters
exports.getAllRequests = async (req, res) => {
  try {
    const { status, user } = req.query;
    const filter = {};

    if (status) filter.status = status;
    if (user && mongoose.Types.ObjectId.isValid(user)) {
      filter.user = user;
    }

    const requests = await AssetRequest.find(filter)
      .sort({ createdAt: -1 })
      .populate('user', 'name email role')
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

    const request = await AssetRequest.findByIdAndDelete(id);

    if (!request) {
      return res.status(404).json({ error: 'Request not found or already deleted' });
    }

    return res.status(200).json({ message: '🗑️ Request deleted successfully' });

  } catch (err) {
    console.error('❌ [Delete Error]', err);
    return res.status(500).json({ error: 'Server error while deleting request' });
  }
};
