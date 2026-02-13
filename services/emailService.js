// services/emailService.js

const nodemailer = require('nodemailer');
const { getCompanyRegistrationEmailTemplate } = require('../utils/emailTemplates/companyRegistration');

class EmailService {
  constructor() {
    this.transporter = null;
    this.initializeTransporter();
  }

  initializeTransporter() {
    // Check if email credentials are configured
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
        rejectUnauthorized: process.env.NODE_ENV === 'production' // Only reject in production
      },
      pool: true,
      maxConnections: 5,
      maxMessages: 100
    });

    // Verify connection
    this.transporter.verify((error, success) => {
      if (error) {
        console.error('❌ Email transporter verification failed:', error);
      } else {
        console.log('✅ Email server is ready to send messages');
      }
    });
  }

  async sendEmail(to, subject, html, options = {}) {
    try {
      // Validate inputs
      if (!to || !subject || !html) {
        throw new Error('Missing required email parameters');
      }

      // Check if transporter is configured
      if (!this.transporter) {
        if (process.env.NODE_ENV === 'development') {
          console.log('📧 [DEV MODE] Email would be sent:', { to, subject });
          console.log('📧 [DEV MODE] Email HTML preview available at: /dev-email-preview');
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

      // Add attachments if provided
      if (options.attachments && options.attachments.length > 0) {
        mailOptions.attachments = options.attachments;
      }

      const info = await this.transporter.sendMail(mailOptions);
      
      console.log(`✅ Email sent successfully to ${to} | Message ID: ${info.messageId}`);
      
      return {
        success: true,
        messageId: info.messageId,
        response: info.response,
        accepted: info.accepted,
        rejected: info.rejected
      };

    } catch (error) {
      console.error('❌ Error sending email:', error.message);
      
      // Log more details in development
      if (process.env.NODE_ENV === 'development') {
        console.error('Email error details:', error);
      }

      // Don't throw in production to prevent transaction rollback
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

  async sendCompanyRegistrationEmails(companyData, ownerData) {
    const results = {
      companyEmail: null,
      ownerEmail: null,
      success: false,
      errors: []
    };

    try {
      // Send email to company
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
            headers: {
              'X-Company-Code': companyData.companyCode,
              'X-Email-Type': 'company-registration'
            }
          }
        );
      }

      // Send email to owner
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
            headers: {
              'X-Company-Code': companyData.companyCode,
              'X-User-Role': 'super_admin',
              'X-Email-Type': 'owner-registration'
            }
          }
        );
      }

      results.success = true;
      console.log(`✅ Registration emails sent successfully for company: ${companyData.companyName} (${companyData.companyCode})`);
      
      return results;

    } catch (error) {
      console.error('❌ Failed to send registration emails:', error);
      results.errors.push(error.message);
      results.success = false;
      
      // Don't throw - email failure shouldn't break company creation
      return results;
    }
  }

  // Test email configuration
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

// Create singleton instance
const emailService = new EmailService();

module.exports = emailService;