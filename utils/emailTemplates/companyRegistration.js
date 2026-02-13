// utils/emailTemplates/companyRegistration.js

const getCompanyRegistrationEmailTemplate = (companyData, ownerData, isOwnerEmail = false) => {
  const recipientType = isOwnerEmail ? 'Owner' : 'Company';
  const primaryColor = '#2563eb';
  const secondaryColor = '#1e40af';
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          line-height: 1.6;
          color: #1f2937;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          padding: 20px;
        }
        .container {
          max-width: 650px;
          margin: 0 auto;
          background: white;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
          animation: slideIn 0.5s ease-out;
        }
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .header {
          background: linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%);
          color: white;
          padding: 40px 30px;
          text-align: center;
          position: relative;
          overflow: hidden;
        }
        .header::after {
          content: '';
          position: absolute;
          top: -50%;
          right: -50%;
          width: 200%;
          height: 200%;
          background: radial-gradient(circle, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 70%);
          animation: spin 20s linear infinite;
        }
        @keyframes spin {
          100% { transform: rotate(360deg); }
        }
        .logo {
          width: 80px;
          height: 80px;
          background: white;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 20px;
          border: 3px solid rgba(255, 255, 255, 0.3);
          box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);
        }
        .logo img {
          width: 60px;
          height: 60px;
          object-fit: contain;
        }
        .badge {
          display: inline-block;
          padding: 8px 20px;
          background: rgba(255, 255, 255, 0.2);
          border-radius: 50px;
          color: white;
          font-size: 14px;
          font-weight: 600;
          margin-top: 15px;
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.3);
        }
        .content {
          padding: 40px 30px;
          background: white;
        }
        .greeting {
          font-size: 24px;
          color: ${primaryColor};
          margin-bottom: 20px;
          font-weight: 700;
        }
        .subtitle {
          color: #6b7280;
          margin-bottom: 30px;
          font-size: 16px;
          border-bottom: 2px solid #e5e7eb;
          padding-bottom: 20px;
        }
        .section {
          background: #f8fafc;
          border-radius: 12px;
          padding: 25px;
          margin-bottom: 25px;
          border: 1px solid #e5e7eb;
          position: relative;
        }
        .section-title {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 20px;
          color: ${primaryColor};
          font-size: 18px;
          font-weight: 700;
        }
        .section-icon {
          width: 32px;
          height: 32px;
          background: ${primaryColor};
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }
        .details-grid {
          display: grid;
          grid-template-columns: 1fr 2fr;
          gap: 12px;
          margin-bottom: 10px;
        }
        .detail-label {
          font-weight: 600;
          color: #4b5563;
          font-size: 14px;
        }
        .detail-value {
          color: #1f2937;
          font-size: 14px;
          font-weight: 500;
        }
        .company-code {
          background: linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%);
          border: 2px solid ${primaryColor};
          border-radius: 12px;
          padding: 20px;
          text-align: center;
          margin: 20px 0;
        }
        .company-code-label {
          color: ${primaryColor};
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 10px;
        }
        .company-code-value {
          font-size: 32px;
          font-weight: 800;
          color: ${secondaryColor};
          letter-spacing: 4px;
          font-family: 'Courier New', monospace;
          background: white;
          padding: 10px 20px;
          border-radius: 8px;
          display: inline-block;
          border: 1px dashed ${primaryColor};
        }
        .login-details {
          background: #fef3c7;
          border-left: 4px solid #f59e0b;
          padding: 20px;
          border-radius: 8px;
          margin: 20px 0;
        }
        .button {
          display: inline-block;
          padding: 14px 32px;
          background: linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%);
          color: white;
          text-decoration: none;
          border-radius: 8px;
          font-weight: 600;
          margin-top: 20px;
          transition: all 0.3s ease;
          box-shadow: 0 4px 12px rgba(37, 99, 235, 0.2);
        }
        .button:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 16px rgba(37, 99, 235, 0.3);
        }
        .qr-section {
          text-align: center;
          margin: 30px 0;
          padding: 20px;
          background: white;
          border-radius: 12px;
          border: 1px solid #e5e7eb;
        }
        .qr-placeholder {
          width: 120px;
          height: 120px;
          background: #f3f4f6;
          border-radius: 12px;
          margin: 10px auto;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid #d1d5db;
        }
        .warning {
          background: #fffbeb;
          border: 1px solid #fcd34d;
          border-radius: 8px;
          padding: 15px;
          margin-top: 20px;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .footer {
          background: #1f2937;
          color: white;
          padding: 30px;
          text-align: center;
        }
        .footer a {
          color: #93c5fd;
          text-decoration: none;
        }
        .credentials-highlight {
          background: ${isOwnerEmail ? '#e0f2fe' : '#f0fdf4'};
          border-radius: 8px;
          padding: 20px;
          margin: 15px 0;
          border: 1px solid ${isOwnerEmail ? '#38bdf8' : '#4ade80'};
        }
        @media (max-width: 600px) {
          .container { margin: 10px; }
          .content { padding: 20px; }
          .details-grid { grid-template-columns: 1fr; gap: 5px; }
          .company-code-value { font-size: 24px; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo">
            <img src="https://cds.ciisnetwork.in/logoo.png" alt="CIIS NETWORK Logo">
          </div>
          <h1 style="font-size: 28px; margin-bottom: 10px; position: relative; z-index: 1;">
            🎉 Welcome to CIIS NETWORK!
          </h1>
          <p style="font-size: 16px; opacity: 0.95; position: relative; z-index: 1;">
            ${recipientType} Registration Successful
          </p>
          <span class="badge">
            ${isOwnerEmail ? '👑 Owner Account' : '🏢 Company Account'}
          </span>
        </div>
        
        <div class="content">
          <div class="greeting">
            Dear ${isOwnerEmail ? ownerData?.name || 'Owner' : companyData?.companyName || 'Company'},
          </div>
          
          <div class="subtitle">
            Thank you for registering with CIIS NETWORK. Your account has been created successfully!
          </div>

          ${!isOwnerEmail ? `
            <!-- Company Details Section - Only for Company Email -->
            <div class="section">
              <div class="section-title">
                <div class="section-icon">🏢</div>
                <span>Company Information</span>
              </div>
              
              <div class="company-code">
                <div class="company-code-label">🔑 Your Unique Company Code</div>
                <div class="company-code-value">${companyData.companyCode}</div>
                <p style="color: #4b5563; margin-top: 15px; font-size: 14px;">
                  Use this code for employee registrations and company identification
                </p>
              </div>
              
              <div class="details-grid">
                <div class="detail-label">Company Name:</div>
                <div class="detail-value">${companyData.companyName}</div>
                
                <div class="detail-label">Company Email:</div>
                <div class="detail-value">${companyData.companyEmail}</div>
                
                <div class="detail-label">Company Phone:</div>
                <div class="detail-value">${companyData.companyPhone}</div>
                
                <div class="detail-label">Company Address:</div>
                <div class="detail-value">${companyData.companyAddress}</div>
                
                <div class="detail-label">Owner Name:</div>
                <div class="detail-value">${companyData.ownerName}</div>
                
                <div class="detail-label">Registration Date:</div>
                <div class="detail-value">${new Date(companyData.createdAt).toLocaleDateString('en-IN', { 
                  day: 'numeric', 
                  month: 'long', 
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}</div>
              </div>
            </div>
          ` : `
            <!-- Owner Details Section - Only for Owner Email -->
            <div class="section">
              <div class="section-title">
                <div class="section-icon">👑</div>
                <span>Owner Account Details</span>
              </div>
              
              <div class="credentials-highlight">
                <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
                  <div style="width: 40px; height: 40px; background: #2563eb; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;">
                    👤
                  </div>
                  <div>
                    <h3 style="color: #1f2937; margin: 0;">Super Admin Credentials</h3>
                    <p style="color: #6b7280; margin: 0; font-size: 13px;">Keep these credentials secure</p>
                  </div>
                </div>
                
                <div style="background: white; padding: 15px; border-radius: 8px;">
                  <div style="margin-bottom: 12px;">
                    <span style="font-weight: 600; color: #4b5563;">Email:</span>
                    <span style="font-weight: 700; color: #2563eb; margin-left: 10px;">${ownerData.email}</span>
                  </div>
                  <div style="margin-bottom: 12px;">
                    <span style="font-weight: 600; color: #4b5563;">Password:</span>
                    <span style="font-weight: 700; color: #059669; margin-left: 10px;">•••••••• (as set during registration)</span>
                  </div>
                  <div style="margin-bottom: 12px;">
                    <span style="font-weight: 600; color: #4b5563;">Role:</span>
                    <span style="font-weight: 700; color: #7c3aed; margin-left: 10px;">Super Admin / Owner</span>
                  </div>
                  <div>
                    <span style="font-weight: 600; color: #4b5563;">Department:</span>
                    <span style="margin-left: 10px;">Management</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Company Code for Owner -->
            <div class="company-code" style="margin-bottom: 25px;">
              <div class="company-code-label">🏢 Your Company Code</div>
              <div class="company-code-value">${companyData.companyCode}</div>
              <p style="color: #4b5563; margin-top: 15px; font-size: 14px;">
                Use this code when adding employees to your company
              </p>
            </div>
          `}

          <!-- Login Details - Common for Both -->
          <div class="login-details">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 15px;">
              <span style="font-size: 24px;">🔐</span>
              <h3 style="color: #92400e; margin: 0;">Login Information</h3>
            </div>
            
            <div style="margin-bottom: 10px;">
              <strong style="color: #4b5563;">Login URL:</strong>
              <a href="${companyData.loginUrl}" style="color: #2563eb; word-break: break-all; display: block; margin-top: 5px;">
                ${companyData.loginUrl}
              </a>
            </div>
            
            <div style="margin-top: 15px; padding: 12px; background: white; border-radius: 6px;">
              <strong style="color: #4b5563;">📱 How to Login:</strong>
              <ol style="margin: 10px 0 0 20px; color: #4b5563;">
                <li>Click the login URL above or visit our portal</li>
                <li>Enter your ${isOwnerEmail ? 'email and password' : 'company credentials'}</li>
                <li>Access your ${isOwnerEmail ? 'admin dashboard' : 'company dashboard'}</li>
              </ol>
            </div>
          </div>

          <!-- QR Code Placeholder -->
  

          <!-- Next Steps -->
          <div style="margin-top: 30px;">
            <h3 style="color: #1f2937; margin-bottom: 15px;">🚀 Next Steps:</h3>
            <ul style="list-style: none; padding: 0;">
              <li style="margin-bottom: 12px; display: flex; align-items: center; gap: 10px;">
                <span style="color: ${primaryColor};">✓</span>
                <strong>Login</strong> to your ${isOwnerEmail ? 'admin' : 'company'} dashboard
              </li>
              <li style="margin-bottom: 12px; display: flex; align-items: center; gap: 10px;">
                <span style="color: ${primaryColor};">✓</span>
                <strong>Complete</strong> your company profile and settings
              </li>
              <li style="margin-bottom: 12px; display: flex; align-items: center; gap: 10px;">
                <span style="color: ${primaryColor};">✓</span>
                <strong>Add employees</strong> using the company code: <span style="background: #dbeafe; padding: 4px 8px; border-radius: 4px; font-family: monospace; font-weight: bold;">${companyData.companyCode}</span>
              </li>
              <li style="margin-bottom: 12px; display: flex; align-items: center; gap: 10px;">
                <span style="color: ${primaryColor};">✓</span>
                <strong>Configure</strong> leave policies and departments
              </li>
              <li style="margin-bottom: 12px; display: flex; align-items: center; gap: 10px;">
                <span style="color: ${primaryColor};">✓</span>
                <strong>Set up</strong> notification preferences
              </li>
            </ul>
          </div>

          <div style="text-align: center;">
            <a href="${companyData.loginUrl}" class="button">
              🚀 Access Your Dashboard
            </a>
          </div>

          <div class="warning">
            <span style="font-size: 20px;">⚠️</span>
            <div style="font-size: 13px;">
              <strong style="display: block; margin-bottom: 5px;">Important Security Information:</strong>
              This email contains confidential information. If you didn't create this account, 
              please contact our support team immediately at <a href="mailto:support@ciisnetwork.com">support@ciisnetwork.com</a>
            </div>
          </div>
        </div>

        <div class="footer">
          <div style="margin-bottom: 20px;">
            <img src="https://via.placeholder.com/40x40/ffffff/2563eb?text=CIIS" alt="CIIS" style="border-radius: 8px;">
          </div>
          <h3 style="color: white; margin-bottom: 10px;">CIIS NETWORK</h3>
          <p style="color: #9ca3af; margin-bottom: 20px; font-size: 14px;">
            Enterprise Leave Management Solution
          </p>
          <div style="display: flex; justify-content: center; gap: 20px; margin-bottom: 20px; flex-wrap: wrap;">
            <a href="#" style="color: #93c5fd; font-size: 12px;">Help Center</a>
            <a href="#" style="color: #93c5fd; font-size: 12px;">Privacy Policy</a>
            <a href="#" style="color: #93c5fd; font-size: 12px;">Terms of Service</a>
            <a href="#" style="color: #93c5fd; font-size: 12px;">Contact Support</a>
          </div>
          <p style="color: #6b7280; font-size: 12px; border-top: 1px solid #374151; padding-top: 20px;">
            © ${new Date().getFullYear()} CIIS NETWORK. All rights reserved.<br>
            This is a system-generated email. Please do not reply to this message.
          </p>
        </div>
      </div>
    </body>
    </html>
  `;
};

module.exports = {
  getCompanyRegistrationEmailTemplate
};