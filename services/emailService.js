

const nodemailer = require('nodemailer');
const { getCompanyRegistrationEmailTemplate } = require('../utils/emailTemplates/companyRegistration');
const {notifyEmailRecipients} = require('../HR-CDS/utils/systemNotificationService');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initializeTransporter();
  }

  initializeTransporter() {
    
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn('⚠️ Email credentials not configured. Emails will not be sent.');
      return;
    }

    this.transporter = nodemailer.createTransport({
      service: process.env.EMAIL_SERVICE || 'Gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === 'production' 
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 100
    });

    
    this.transporter.verify((error, success) => {
      if (error) {
        console.error('❌ Email transporter verification failed:', error);
      } else {
        void 0;
      }
    });
  }

  async sendEmail(to, subject, html, options = {}) {
    try {
      
      if (!to || !subject || !html) {
        throw new Error('Missing required email parameters');
      }

      
      if (!this.transporter) {
        if (process.env.NODE_ENV === 'development') {
          void 0;
          void 0;
          this.notifyEmailSent(to, subject, options);
          return { 
            success: true, 
            messageId: `dev-${Date.now()}`,
            preview: html.substring(0, 200) + '...'
          };
        }
        throw new Error('Email service not configured');
      }

      const mailOptions = {
        from: `"CIIS NETWORK" <${process.env.EMAIL_USER}>`,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject: subject,
        html: html,
        replyTo: process.env.EMAIL_REPLY_TO || process.env.EMAIL_USER,
        priority: options.priority || 'high',
        headers: {
          'X-Entity-Ref-ID': options.referenceId || `email-${Date.now()}`,
          'X-Mailer': 'CIIS-NETWORK-Email-Service',
          ...options.headers
        }
      };

      
      if (options.attachments && options.attachments.length > 0) {
        mailOptions.attachments = options.attachments;
      }

      const info = await this.transporter.sendMail(mailOptions);
      
      void 0;
      this.notifyEmailSent(to, subject, options);
      
      return {
        success: true,
        messageId: info.messageId,
        response: info.response,
        accepted: info.accepted,
        rejected: info.rejected
      };

    } catch (error) {
      console.error('❌ Error sending email:', error.message);
      
      
      if (process.env.NODE_ENV === 'development') {
        console.error('Email error details:', error);
      }

      
      if (process.env.NODE_ENV === 'production') {
        console.error('Email sending failed but continuing with response');
        return {
          success: false,
          error: error.message,
          fallback: true
        };
      }

      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  notifyEmailSent(to, subject, options = {}) {
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
  }

  async sendCompanyRegistrationEmails(companyData, ownerData) {
    const results = {
      companyEmail: null,
      ownerEmail: null,
      success: false,
      errors: []
    };

    try {
      
      if (companyData.companyEmail) {
        const companySubject = `🎉 Welcome to CIIS NETWORK - Company Registration Successful (Code: ${companyData.companyCode})`;
        const companyHtml = getCompanyRegistrationEmailTemplate(companyData, ownerData, false);
        
        results.companyEmail = await this.sendEmail(
          companyData.companyEmail,
          companySubject,
          companyHtml,
          {
            priority: 'high',
            referenceId: `company-reg-${companyData.companyCode}-${Date.now()}`,
            notificationType: 'email_notification',
            notificationTargetPath: '/ciisUser/user-dashboard',
            notificationMessage: `Company registration for ${companyData.companyName} is complete. Please check your email for details.`,
            notificationPriority: 'high',
            headers: {
              'X-Company-Code': companyData.companyCode,
              'X-Email-Type': 'company-registration'
            }
          }
        );
      }

      
      if (ownerData.email) {
        const ownerSubject = `👑 Welcome to CIIS NETWORK - Super Admin Access Created (Company: ${companyData.companyName})`;
        const ownerHtml = getCompanyRegistrationEmailTemplate(companyData, ownerData, true);
        
        results.ownerEmail = await this.sendEmail(
          ownerData.email,
          ownerSubject,
          ownerHtml,
          {
            priority: 'high',
            referenceId: `owner-reg-${companyData.companyCode}-${Date.now()}`,
            notificationType: 'email_notification',
            notificationTargetPath: '/ciisUser/user-dashboard',
            notificationMessage: `Your Super Admin account for ${companyData.companyName} has been created. Please check your email for login details.`,
            notificationPriority: 'high',
            headers: {
              'X-Company-Code': companyData.companyCode,
              'X-User-Role': 'super_admin',
              'X-Email-Type': 'owner-registration'
            }
          }
        );
      }

      results.success = true;
      void 0;
      
      return results;

    } catch (error) {
      console.error('❌ Failed to send registration emails:', error);
      results.errors.push(error.message);
      results.success = false;
      
      
      return results;
    }
  }

  
  async testEmailConfig(testEmail) {
    try {
      const testResult = await this.sendEmail(
        testEmail || process.env.EMAIL_USER,
        'CIIS NETWORK - Email Configuration Test',
        `
          <!DOCTYPE html>
          <html>
          <body style="font-family: Arial, sans-serif; padding: 20px;">
            <h2 style="color: #2563eb;">✅ Email Service Test Successful</h2>
            <p>Your CIIS NETWORK email configuration is working correctly!</p>
            <p>Test timestamp: ${new Date().toLocaleString()}</p>
            <hr>
            <p style="color: #6b7280; font-size: 12px;">This is a test email from your leave management system.</p>
          </body>
          </html>
        `,
        { priority: 'low' }
      );
      
      return {
        success: true,
        message: 'Email configuration test successful',
        details: testResult
      };
    } catch (error) {
      return {
        success: false,
        message: 'Email configuration test failed',
        error: error.message
      };
    }
  }
}


const emailService = new EmailService();

module.exports = emailService;
