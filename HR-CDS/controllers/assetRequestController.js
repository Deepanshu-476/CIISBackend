const mongoose = require('mongoose');
const AssetRequest = require('../models/AssetRequest');
const CompanyAsset = require('../../models/CompanyAsset');
const User = require('../../models/User');
const { sendNotification, notifyCompanyOwners } = require('../../HR-CDS/utils/notificationHelper');
const { sendEmail } = require('../../utils/sendEmail');

const formatDate = (date) => {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
};

const titleCase = (value) => {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
};

const getAssetEmailTemplate = ({
  title,
  greeting,
  intro,
  rows,
  status,
  actionUrl,
  actionText
}) => {
  const statusColors = {
    pending: '#f59e0b',
    approved: '#16a34a',
    rejected: '#dc2626',
    completed: '#2563eb'
  };
  const accentColor = statusColors[status] || '#2563eb';

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <style>
          body { font-family: Arial, sans-serif; color: #1f2937; background: #f3f4f6; margin: 0; padding: 0; }
          .container { max-width: 620px; margin: 0 auto; padding: 24px; }
          .header { background: ${accentColor}; color: #fff; padding: 24px; border-radius: 10px 10px 0 0; }
          .content { background: #fff; padding: 24px; border-radius: 0 0 10px 10px; }
          .details { border: 1px solid #e5e7eb; border-radius: 8px; margin: 20px 0; overflow: hidden; }
          .row { display: flex; border-bottom: 1px solid #e5e7eb; }
          .row:last-child { border-bottom: 0; }
          .label { width: 40%; background: #f9fafb; padding: 12px; font-weight: 600; }
          .value { width: 60%; padding: 12px; }
          .badge { display: inline-block; padding: 6px 12px; border-radius: 999px; color: #fff; background: ${accentColor}; font-weight: 700; }
          .button { display: inline-block; padding: 12px 18px; background: ${accentColor}; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 700; }
          .footer { color: #6b7280; font-size: 12px; margin-top: 20px; line-height: 1.5; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2 style="margin: 0;">${title}</h2>
            <p style="margin: 8px 0 0;">CIIS Network Asset Management</p>
          </div>
          <div class="content">
            <p>${greeting}</p>
            <p>${intro}</p>
            <div class="details">
              ${rows.map(({ label, value, isStatus }) => `
                <div class="row">
                  <div class="label">${label}</div>
                  <div class="value">${isStatus ? `<span class="badge">${value}</span>` : value}</div>
                </div>
              `).join('')}
            </div>
            ${actionUrl ? `<p><a class="button" href="${actionUrl}">${actionText}</a></p>` : ''}
            <div class="footer">
              <p>This is an automated email. Please do not reply.</p>
              <p>© ${new Date().getFullYear()} CIIS Network. All rights reserved.</p>
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
};

const sendAssetRequestSubmittedEmail = async ({ to, userName, assetName, reason, expectedReturnDate, requestId }) => {
  if (!to) return null;

  const html = getAssetEmailTemplate({
    title: 'Asset Request Submitted',
    greeting: `Dear ${userName || 'Employee'},`,
    intro: 'Your asset request has been submitted successfully and is pending review.',
    status: 'pending',
    actionUrl: `${process.env.FRONTEND_URL || ''}/ciisUser/my-assets`,
    actionText: 'View My Assets',
    rows: [
      { label: 'Request ID', value: requestId },
      { label: 'Asset', value: assetName },
      { label: 'Reason', value: reason || 'No reason provided' },
      { label: 'Expected Return Date', value: formatDate(expectedReturnDate) },
      { label: 'Status', value: 'Pending', isStatus: true }
    ]
  });

  return sendEmail(to, `Asset Request Submitted - ${assetName}`, html);
};

const sendAssetRequestAdminEmail = async ({ recipients, requesterName, assetName, reason, expectedReturnDate, requestId }) => {
  if (!recipients?.length) return null;

  const html = getAssetEmailTemplate({
    title: 'New Asset Request',
    greeting: 'Hello,',
    intro: `${requesterName || 'An employee'} has requested an asset and is waiting for review.`,
    status: 'pending',
    actionUrl: `${process.env.FRONTEND_URL || ''}/ciisUser/emp-assets`,
    actionText: 'Review Asset Requests',
    rows: [
      { label: 'Request ID', value: requestId },
      { label: 'Requested By', value: requesterName || 'N/A' },
      { label: 'Asset', value: assetName },
      { label: 'Reason', value: reason || 'No reason provided' },
      { label: 'Expected Return Date', value: formatDate(expectedReturnDate) },
      { label: 'Status', value: 'Pending', isStatus: true }
    ]
  });

  return sendEmail(recipients, `New Asset Request - ${assetName}`, html);
};

const sendAssetRequestStatusEmail = async ({ to, userName, assetName, status, adminComment, requestId, approverName }) => {
  if (!to) return null;

  const statusLabel = titleCase(status);
  const html = getAssetEmailTemplate({
    title: `Asset Request ${statusLabel}`,
    greeting: `Dear ${userName || 'Employee'},`,
    intro: `Your asset request has been ${status}.`,
    status,
    actionUrl: `${process.env.FRONTEND_URL || ''}/ciisUser/my-assets`,
    actionText: 'View My Assets',
    rows: [
      { label: 'Request ID', value: requestId },
      { label: 'Asset', value: assetName },
      { label: 'Status', value: statusLabel, isStatus: true },
      { label: 'Reviewed By', value: approverName || 'Admin' },
      { label: 'Admin Comment', value: adminComment || 'N/A' }
    ]
  });

  return sendEmail(to, `Asset Request ${statusLabel} - ${assetName}`, html);
};

// ✅ USER: Get available company assets for dropdown
exports.getAvailableAssets = async (req, res) => {
  try {
    console.log('🔍 Fetching available assets for user:', req.user._id);
    
    const query = { 
      companyCode: req.user.companyCode,
      status: 'Available'  
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

    if (asset.quantity <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: `Asset is out of stock` 
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

    try {
      await sendAssetRequestSubmittedEmail({
        to: req.user.email,
        userName: req.user.name,
        assetName: asset.name,
        reason,
        expectedReturnDate,
        requestId: newRequest._id.toString()
      });
      console.log(`✅ Asset request confirmation email sent to ${req.user.email}`);
    } catch (emailError) {
      console.error('❌ Failed to send asset request confirmation email:', emailError.message);
    }

    try {
      const ownerEmails = await User.find({
        company: req.user.company || req.user.companyId,
        companyRole: { $in: ['Owner', 'Admin', 'owner', 'admin'] },
        _id: { $ne: req.user._id },
        isActive: true,
        email: { $exists: true, $ne: '' }
      }).distinct('email');

      await sendAssetRequestAdminEmail({
        recipients: ownerEmails,
        requesterName: req.user.name,
        assetName: asset.name,
        reason,
        expectedReturnDate,
        requestId: newRequest._id.toString()
      });

      if (ownerEmails.length > 0) {
        console.log(`✅ Asset request admin email sent to ${ownerEmails.length} recipient(s)`);
      }
    } catch (emailError) {
      console.error('❌ Failed to send asset request admin email:', emailError.message);
    }

    // 🔔 NOTIFY ADMINS / OWNERS
try {
  await notifyCompanyOwners({
    companyId: req.user.company || req.user.companyId,
    type: 'asset_requested',
    title: 'New Asset Request',
    message: `${req.user.name} requested asset: ${asset.name}`,
    data: {
      requestId: newRequest._id,
      assetId: asset._id,
      assetName: asset.name,
      userId: req.user._id,
      userName: req.user.name,
      reason,
      expectedReturnDate
    },
    excludeUser: req.user._id
  });

  console.log('✅ Asset request notification sent to admins');
} catch (err) {
  console.error('❌ Notification error:', err.message);
}
    
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
          // ✅ allow comment-only update
      if (!status && !adminComment) {
        return res.status(400).json({
          success: false,
          error: 'Status or comment required'
        });
      }

      // ✅ validate only if status comes
      if (status) {
        const validStatuses = ['approved', 'rejected', 'completed'];
        if (!validStatuses.includes(status)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid status'
          });
        }
      } 

    const request = await AssetRequest.findOne({
      _id: id,
      companyCode: req.user.companyCode
    })
      .populate('asset')
      .populate('user', 'name email');

    if (!request) {
      return res.status(404).json({ 
        success: false, 
        error: 'Request not found' 
      });
    }

    // If approving, check if asset is still available
    if (status === 'approved' && request.asset.quantity <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: `Asset is no longer available (Current: ${request.asset.status})` 
      });
    }

    // Update request
   // ✅ only update status if provided
      if (status) {
        request.status = status;
      }

      // ✅ main fix (IMPORTANT)
      // ✅ ensure array exists
        if (!request.adminComments) {
          request.adminComments = [];
        }

        if (adminComment) {
          request.adminComments.push({
            text: adminComment,
            addedBy: req.user._id,
            addedAt: new Date()
          });
        }
    request.decisionDate = new Date();
    request.approvedBy = req.user._id;

    // If approved, update asset status to 'Assigned'
    if (status === 'approved') {
      await CompanyAsset.findByIdAndUpdate(request.asset._id, {
        status: 'Assigned',
        assignedTo: request.user?._id || request.user,
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

    if (['approved', 'rejected'].includes(status)) {
      try {
        await sendAssetRequestStatusEmail({
          to: request.user?.email,
          userName: request.user?.name,
          assetName: request.asset?.name || request.assetName,
          status,
          adminComment,
          requestId: request._id.toString(),
          approverName: req.user.name || req.user.email || 'Admin'
        });
        console.log(`✅ Asset request status email sent to ${request.user?.email}`);
      } catch (emailError) {
        console.error('❌ Failed to send asset request status email:', emailError.message);
      }
    }

    // 🔔 NOTIFY USER ABOUT STATUS CHANGE
try {
  await sendNotification({
    recipient: request.user?._id || request.user,
    type: 'asset_request_status',
    title: `Asset Request ${status}`,
    message: `Your request for "${request.asset.name}" has been ${status}${adminComment ? ': ' + adminComment : ''}`,
    data: {
      requestId: request._id,
      assetId: request.asset._id,
      assetName: request.asset.name,
      status,
      adminComment,
      approvedBy: req.user._id
    },
    priority: 'high'
  });

  console.log('✅ Notification sent to user');
} catch (err) {
  console.error('❌ Notification error:', err.message);
}

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
