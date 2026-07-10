const mongoose = require('mongoose');
const AssetRequest = require('../models/AssetRequest');
const { getPaginationOptions, buildPaginationMeta } = require('../../utils/pagination');
const CompanyAsset = require('../../models/CompanyAsset');
const Department = require('../../models/Department');
const User = require('../../models/User');
const { sendNotification, notifyCompanyOwners } = require('../../HR-CDS/utils/notificationHelper');
const {notifyPageUsers, notifyDirectUsers} = require('../utils/systemNotificationService');
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

const getDepartmentName = async (department, companyCode) => {
  if (!department) return '';

  if (typeof department === 'object') {
    return department.name || department.departmentName || department.title || '';
  }

  const departmentValue = String(department);
  if (!mongoose.Types.ObjectId.isValid(departmentValue)) return departmentValue;

  const departmentRecord = await Department.findOne({
    _id: departmentValue,
    ...(companyCode ? { companyCode } : {})
  }).select('name').lean();

  return departmentRecord?.name || '';
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

  return sendEmail(to, `Asset Request Submitted - ${assetName}`, html, {
    notificationType: 'asset_requested',
    notificationTargetPath: '/ciisUser/my-assets',
    notificationMessage: `Your asset request for ${assetName} has been submitted`,
    notificationData: {requestId, assetName},
    notificationPriority: 'medium',
  });
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

  return sendEmail(recipients, `New Asset Request - ${assetName}`, html, {
    skipNotification: true,
  });
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

  return sendEmail(to, `Asset Request ${statusLabel} - ${assetName}`, html, {
    skipNotification: true,
  });
};


exports.getAvailableAssets = async (req, res) => {
  try {
    void 0;
    
    const query = { 
      companyCode: req.user.companyCode,
      $or: [
        { status: 'Available' },
        { status: { $exists: false } },
        { status: null },
        { status: '' }
      ]
    };
    
    const assets = await CompanyAsset.find(query)
      .select('name description status companyCode branch quantity')
      .sort({ name: 1 });
    
    void 0;
    
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


exports.requestAsset = async (req, res) => {
  try {
    const { assetId, reason, expectedReturnDate } = req.body;
    
    void 0;

    
    if (!assetId || !mongoose.Types.ObjectId.isValid(assetId)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Valid asset ID is required' 
      });
    }

    
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

    
    const departmentName = await getDepartmentName(req.user.department, req.user.companyCode);

    const newRequest = new AssetRequest({
      user: req.user._id,
      asset: assetId,
      assetName: asset.name,
      assetStatus: asset.status,
      companyCode: req.user.companyCode,
      department: departmentName || 'General',
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
      void 0;
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
        void 0;
      }
    } catch (emailError) {
      console.error('❌ Failed to send asset request admin email:', emailError.message);
    }

    
try {
  await notifyPageUsers({
    companyId: req.user.company || req.user.companyId,
    targetPath: '/ciisUser/emp-assets',
    excludeUserIds: [req.user._id],
    type: 'asset_requested',
    title: 'New Asset Request',
    message: `${req.user.name} requested asset: ${asset.name}`,
    actor: req.user._id,
    data: {
      requestId: newRequest._id,
      assetId: asset._id,
      assetName: asset.name,
      userId: req.user._id,
      userName: req.user.name,
      reason,
      expectedReturnDate
    },
    priority: 'high'
  });

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

  void 0;
} catch (err) {
  console.error('❌ Notification error:', err.message);
}
    
    
    await newRequest.populate([
      { path: 'user', select: 'name email department' },
      { path: 'asset', select: 'name description status' }
    ]);

    void 0;

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


exports.getMyRequests = async (req, res) => {
  try {
    void 0;
    
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


exports.getAllRequests = async (req, res) => {
  try {
    const { status, department, assetId, branch } = req.query;
    const { page, limit, skip } = getPaginationOptions(req.query, { limit: 25, maxLimit: 100 });
    const filter = { companyCode: req.user.companyCode };

    if (status) filter.status = status;
    if (department) filter.department = department;
    if (assetId && mongoose.Types.ObjectId.isValid(assetId)) {
      filter.asset = assetId;
    }
    if (branch && mongoose.Types.ObjectId.isValid(branch)) {
      const branchAssetIds = await CompanyAsset.find({
        companyCode: req.user.companyCode,
        branch
      }).distinct('_id');
      filter.asset = { $in: branchAssetIds };
    }

    const [rawRequests, total] = await Promise.all([
      AssetRequest.find(filter)
        .populate('user', 'name email department')
        .populate({
          path: 'asset',
          select: 'name description status branch',
          populate: { path: 'branch', select: 'name branchCode' }
        })
        .populate('approvedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AssetRequest.countDocuments(filter)
    ]);

    const departmentIds = [
      ...new Set(
        rawRequests
          .flatMap(request => [request.department, request.user?.department])
          .map(value => (value ? String(value) : ''))
          .filter(value => mongoose.Types.ObjectId.isValid(value))
      )
    ];

    const departments = departmentIds.length
      ? await Department.find({
          _id: { $in: departmentIds },
          companyCode: req.user.companyCode
        }).select('name').lean()
      : [];

    const departmentNamesById = new Map(
      departments.map(department => [String(department._id), department.name])
    );

    const requests = rawRequests.map(request => {
      const requestDepartment = request.department ? String(request.department) : '';
      const userDepartment = request.user?.department ? String(request.user.department) : '';
      const departmentName =
        departmentNamesById.get(requestDepartment) ||
        departmentNamesById.get(userDepartment) ||
        (requestDepartment && !mongoose.Types.ObjectId.isValid(requestDepartment) ? requestDepartment : '') ||
        (userDepartment && !mongoose.Types.ObjectId.isValid(userDepartment) ? userDepartment : '');

      return {
        ...request,
        departmentName: departmentName || 'N/A'
      };
    });

    res.status(200).json({
      success: true,
      count: requests.length,
      total,
      pagination: buildPaginationMeta({ page, limit, total }),
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


exports.updateRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminComment } = req.body;
    const commentImage = req.file ? `/uploads/asset-comments/${req.file.filename}` : '';
    
    const validStatuses = ['approved', 'rejected', 'completed'];
          
      if (!status && !adminComment && !commentImage) {
        return res.status(400).json({
          success: false,
          error: 'Status, comment, or image required'
        });
      }

      
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

    
    if (status === 'approved' && request.asset.quantity <= 0) {
      return res.status(400).json({ 
        success: false, 
        error: `Asset is no longer available (Current: ${request.asset.status})` 
      });
    }

    
   
      if (status) {
        request.status = status;
      }

      
      
        if (!request.adminComments) {
          request.adminComments = [];
        }

        if (adminComment || commentImage) {
          request.adminComments.push({
            text: adminComment || '',
            image: commentImage,
            addedBy: req.user._id,
            addedAt: new Date()
          });
        }
    request.decisionDate = new Date();
    request.approvedBy = req.user._id;

    
    if (status === 'approved') {
      await CompanyAsset.findByIdAndUpdate(request.asset._id, {
        status: 'Assigned',
        assignedTo: request.user?._id || request.user,
        assignedDate: new Date()
      });
    }

    
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
        void 0;
      } catch (emailError) {
        console.error('❌ Failed to send asset request status email:', emailError.message);
      }
    }

    
try {
  await notifyDirectUsers({
    userIds: [request.user?._id || request.user],
    targetPath: '/ciisUser/my-assets',
    type: 'asset_request_status',
    title: `Asset Request ${titleCase(status || 'Updated')}`,
    message: `${req.user.name || 'Admin'} ${status ? `marked your request for "${request.asset.name}" as ${status}` : `commented on your request for "${request.asset.name}"`}${adminComment ? ': ' + adminComment : ''}`,
    actor: req.user._id,
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

  void 0;
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

void 0;
