const nodemailer = require('nodemailer');
const {notifyEmailRecipients} = require('../HR-CDS/utils/systemNotificationService');

const notifyEmailSent = ({to, subject, options = {}}) => {
  if (options.skipNotification) return;

  notifyEmailRecipients({
    emails: to,
    title: options.notificationTitle || subject,
    message: options.notificationMessage || `You have a new email update: ${subject}`,
    targetPath: options.notificationTargetPath || options.targetPath || '/ciisUser/user-dashboard',
    type: options.notificationType || 'email_notification',
    company: options.company,
    data: options.notificationData || {},
    priority: options.notificationPriority || 'medium',
    push: options.notificationPush !== false,
  }).catch(error => {
    console.error('❌ Email notification failed:', error.message);
  });
};

const sendEmail = async (to, subject, html, options = {}) => {
  try {
    
    if (!to || !subject || !html) {
      throw new Error('Missing required email parameters');
    }

    
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.error('❌ Email credentials not configured in environment variables');
      throw new Error('Email service not configured');
    }

    
    const transporter = nodemailer.createTransport({
      service: 'Gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      tls: {
        rejectUnauthorized: false 
      },
      pool: true, 
      maxConnections: 5,
      maxMessages: 100
    });

    
    await transporter.verify();
    void 0;

    
    const info = await transporter.sendMail({
      from: `"CIIS NETWORK" <${process.env.EMAIL_USER}>`,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject: subject,
      html: html,
      text: options.text || undefined,
      replyTo: process.env.EMAIL_USER,
      priority: options.priority || 'normal'
    });

    void 0;
    notifyEmailSent({to, subject, options});
    return { success: true, messageId: info.messageId };

  } catch (error) {
    console.error('❌ Error sending email:', error.message);
    
    
    if (process.env.NODE_ENV === 'development') {
      console.error('Email error details:', error);
    }
    
    throw new Error(`Failed to send email: ${error.message}`);
  }
};


const emailTemplates = {
  leaveStatusUpdate: (userName, leaveId, status, remarks, updatedBy) => {
    const statusColor = status.toLowerCase() === 'approved' ? '#4CAF50' : 
                       status.toLowerCase() === 'rejected' ? '#F44336' : '#FF9800';
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                    color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
          .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
          .status-badge { display: inline-block; padding: 8px 16px; 
                         background: ${statusColor}; color: white; 
                         border-radius: 20px; font-weight: bold; }
          .details { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; 
                     border-left: 4px solid ${statusColor}; }
          .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; 
                   color: #666; font-size: 12px; }
          .button { display: inline-block; padding: 12px 24px; background: #1976d2; 
                   color: white; text-decoration: none; border-radius: 5px; 
                   margin-top: 20px; }
          .highlight { background: #e3f2fd; padding: 15px; border-radius: 5px; margin: 15px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Leave Status Update</h1>
            <p>CIIS Network - Leave Management System</p>
          </div>
          
          <div class="content">
            <h2>Dear ${userName},</h2>
            
            <p>Your leave request has been reviewed and the status has been updated:</p>
            
            <div class="details">
              <div style="margin-bottom: 15px;">
                <strong>Status:</strong> 
                <span class="status-badge">${status}</span>
              </div>
              
              <div style="margin-bottom: 10px;">
                <strong>Leave ID:</strong> ${leaveId}
              </div>
              
              ${remarks ? `
              <div class="highlight">
                <strong>Remarks from ${updatedBy}:</strong>
                <p>"${remarks}"</p>
              </div>
              ` : ''}
              
              <div style="margin-top: 15px;">
                <strong>Updated By:</strong> ${updatedBy}<br>
                <strong>Updated At:</strong> ${new Date().toLocaleString('en-US', { 
                  timeZone: 'Asia/Kolkata',
                  dateStyle: 'medium',
                  timeStyle: 'medium'
                })}
              </div>
            </div>
            
            <p>You can view the details of your leave request by logging into the system.</p>
            
            <a href="${process.env.FRONTEND_URL || '#'}" class="button">
              View Leave Details
            </a>
            
            <div class="footer">
              <p><strong>Note:</strong> This is an automated notification. Please do not reply to this email.</p>
              <p>If you have any questions, please contact your HR department.</p>
              <p>© ${new Date().getFullYear()} CIIS Network. All rights reserved.</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  },

  
  leaveApplied: (userName, leaveId, type, startDate, endDate) => {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #1976d2; color: white; padding: 20px; text-align: center; }
          .content { background: #f5f5f5; padding: 20px; }
          .footer { margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; 
                   color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>Leave Application Submitted</h2>
          </div>
          <div class="content">
            <p>Dear ${userName},</p>
            <p>Your leave application has been successfully submitted.</p>
            <p><strong>Details:</strong></p>
            <ul>
              <li><strong>Leave ID:</strong> ${leaveId}</li>
              <li><strong>Type:</strong> ${type}</li>
              <li><strong>From:</strong> ${new Date(startDate).toLocaleDateString()}</li>
              <li><strong>To:</strong> ${new Date(endDate).toLocaleDateString()}</li>
              <li><strong>Status:</strong> Pending Approval</li>
            </ul>
            <p>You will be notified once your leave is reviewed by the management.</p>
          </div>
          <div class="footer">
            <p>This is an automated email. Please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  },

  leaveDeleted: (userName, leaveId) => {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #f44336; color: white; padding: 20px; text-align: center; }
          .content { background: #ffebee; padding: 20px; }
          .footer { margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; 
                   color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>Leave Request Deleted</h2>
          </div>
          <div class="content">
            <p>Dear ${userName},</p>
            <p>Your leave request (ID: ${leaveId}) has been deleted.</p>
            <p>If you believe this was a mistake, please contact your HR department immediately.</p>
          </div>
          <div class="footer">
            <p>This is an automated email. Please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }
};


const sendLeaveStatusEmail = async (userEmail, userName, leaveId, status, remarks, updatedBy) => {
  const subject = `Leave Request ${status} - ID: ${leaveId}`;
  const html = emailTemplates.leaveStatusUpdate(userName, leaveId, status, remarks, updatedBy);
  
  return await sendEmail(userEmail, subject, html, {
    skipNotification: true,
  });
};


const sendLeaveAppliedEmail = async (userEmail, userName, leaveId, type, startDate, endDate) => {
  const subject = `Leave Application Submitted - ID: ${leaveId}`;
  const html = emailTemplates.leaveApplied(userName, leaveId, type, startDate, endDate);
  
  return await sendEmail(userEmail, subject, html, {
    notificationType: 'leave_applied',
    notificationTargetPath: '/ciisUser/my-leaves',
    notificationMessage: `Your ${type} leave application has been submitted`,
    notificationData: {leaveId, leaveType: type, startDate, endDate},
    notificationPriority: 'high',
  });
};


const sendLeaveDeletedEmail = async (userEmail, userName, leaveId) => {
  const subject = `Leave Request Deleted - ID: ${leaveId}`;
  const html = emailTemplates.leaveDeleted(userName, leaveId);
  
  return await sendEmail(userEmail, subject, html, {
    skipNotification: true,
  });
};

module.exports = {
  sendEmail,
  sendLeaveStatusEmail,
  sendLeaveAppliedEmail,
  sendLeaveDeletedEmail,
  emailTemplates
};
