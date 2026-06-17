const ServiceEnquiry = require('../models/ServiceEnquiry');
const Client = require('../models/Client');
const User = require('../../models/User');
const {sendEmail} = require('../../utils/sendEmail');

const normalizeCompanyCode = value => (value ? String(value).trim().toUpperCase() : '');

const escapeHtml = value => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const formatDate = value => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
};

const buildServiceApprovalEmail = ({enquiry, client}) => {
  const clientName = escapeHtml(client?.client || client?.name || enquiry.clientName || 'Valued Client');
  const serviceName = escapeHtml(enquiry.serviceName);
  const companyName = escapeHtml(enquiry.companyName || client?.company || 'your company');
  const enquiryNumber = escapeHtml(enquiry.enquiryNumber || enquiry._id);
  const approvedDate = formatDate(new Date());

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <title>Service Request Update</title>
      </head>
      <body style="margin:0; padding:0; background:#ffffff; font-family:Arial, Helvetica, sans-serif; color:#222222;">
        <div style="max-width:620px; margin:0 auto; padding:24px;">
          <h2 style="margin:0 0 18px; color:#174ea6; font-size:22px;">Service request update</h2>
          <p style="font-size:15px; line-height:1.6;">Dear ${clientName},</p>
          <p style="font-size:15px; line-height:1.6;">
            Your request for <strong>${serviceName}</strong> has been reviewed and added to your active services.
            Our team will contact you with the next steps.
          </p>
          <table cellspacing="0" cellpadding="0" style="width:100%; border-collapse:collapse; margin:20px 0; font-size:14px;">
            <tr>
              <td style="padding:8px 0; color:#666666; width:140px;">Service</td>
              <td style="padding:8px 0;">${serviceName}</td>
            </tr>
            <tr>
              <td style="padding:8px 0; color:#666666;">Company</td>
              <td style="padding:8px 0;">${companyName}</td>
            </tr>
            <tr>
              <td style="padding:8px 0; color:#666666;">Reference</td>
              <td style="padding:8px 0;">${enquiryNumber}</td>
            </tr>
            <tr>
              <td style="padding:8px 0; color:#666666;">Date</td>
              <td style="padding:8px 0;">${approvedDate}</td>
            </tr>
          </table>
          <p style="font-size:15px; line-height:1.6;">Regards,<br />CIIS Network Team</p>
          <p style="font-size:12px; color:#777777; margin-top:24px;">
            This email was sent regarding your CIIS Network service request.
          </p>
        </div>
      </body>
    </html>
  `;
};

const buildServiceApprovalText = ({enquiry, client}) => {
  const clientName = client?.client || client?.name || enquiry.clientName || 'Valued Client';
  const serviceName = enquiry.serviceName || 'your requested service';
  const companyName = enquiry.companyName || client?.company || 'your company';
  const enquiryNumber = enquiry.enquiryNumber || enquiry._id;

  return [
    `Dear ${clientName},`,
    '',
    `Your request for ${serviceName} has been reviewed and added to your active services.`,
    'Our team will contact you with the next steps.',
    '',
    `Service: ${serviceName}`,
    `Company: ${companyName}`,
    `Reference: ${enquiryNumber}`,
    '',
    'Regards,',
    'CIIS Network Team',
  ].join('\n');
};

const resolveApprovalEmailRecipient = async enquiry => {
  let client = null;

  if (enquiry.clientId) {
    client = await Client.findById(enquiry.clientId).select('client name email company companyCode services');
  }

  if (!client && enquiry.clientName) {
    const clientName = String(enquiry.clientName).trim();
    const companyCode = normalizeCompanyCode(enquiry.companyCode);
    const query = {
      ...(companyCode ? {companyCode} : {}),
      $or: [
        {client: new RegExp(`^${clientName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')},
        {name: new RegExp(`^${clientName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')},
      ],
    };
    client = await Client.findOne(query).select('client name email company companyCode services');
  }

  let user = null;
  if (!client?.email && enquiry.requestedBy) {
    user = await User.findById(enquiry.requestedBy).select('name email companyCode');
  }

  const to = client?.email || user?.email || '';
  return {
    client,
    to: to ? String(to).trim().toLowerCase() : '',
  };
};

const sendServiceApprovalEmail = async enquiry => {
  try {
    const {client, to} = await resolveApprovalEmailRecipient(enquiry);
    if (!to) {
      console.warn('[SERVICE ENQUIRY] approval email skipped - client email missing', {
        enquiryId: enquiry._id,
        clientId: enquiry.clientId,
        clientName: enquiry.clientName,
        requestedBy: enquiry.requestedBy,
      });
      return {sent: false, reason: 'client_email_missing'};
    }

    await sendEmail(
      to,
      `Service request update - ${enquiry.serviceName}`,
      buildServiceApprovalEmail({enquiry, client}),
      {
        skipNotification: true,
        priority: 'normal',
        text: buildServiceApprovalText({enquiry, client}),
      }
    );
    return {sent: true, to};
  } catch (error) {
    console.error('[SERVICE ENQUIRY] approval email failed', {
      enquiryId: enquiry?._id,
      message: error.message,
    });
    return {sent: false, reason: error.message};
  }
};

const addApprovedServiceToClient = async enquiry => {
  try {
    const {client} = await resolveApprovalEmailRecipient(enquiry);
    if (!client?._id) {
      return {added: false, reason: 'client_not_found'};
    }

    const serviceName = String(enquiry.serviceName || '').trim();
    if (!serviceName) {
      return {added: false, reason: 'service_name_missing'};
    }

    const currentServices = Array.isArray(client.services) ? client.services : [];
    const alreadyExists = currentServices.some(service => (
      String(service || '').trim().toLowerCase() === serviceName.toLowerCase()
    ));

    if (alreadyExists) {
      return {added: false, reason: 'already_active', clientId: client._id};
    }

    const updatedClient = await Client.findByIdAndUpdate(
      client._id,
      {$addToSet: {services: serviceName}},
      {new: true, runValidators: true}
    ).select('_id services');

    return {
      added: true,
      clientId: client._id,
      services: updatedClient?.services || [],
    };
  } catch (error) {
    console.error('[SERVICE ENQUIRY] add approved service failed', {
      enquiryId: enquiry?._id,
      serviceName: enquiry?.serviceName,
      message: error.message,
    });
    return {added: false, reason: error.message};
  }
};

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

    let approvalEmail = {sent: false, reason: 'not_approved_status'};
    let clientService = {added: false, reason: 'not_approved_status'};
    if (status === 'Approved') {
      clientService = await addApprovedServiceToClient(enquiry);
      approvalEmail = await sendServiceApprovalEmail(enquiry);
    }

    res.json({
      success: true,
      message: 'Service enquiry status updated successfully',
      approvalEmail,
      clientService,
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
