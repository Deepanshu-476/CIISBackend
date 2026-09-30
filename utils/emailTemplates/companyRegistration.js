const getCompanyRegistrationEmailTemplate = (companyData, ownerData, isOwnerEmail = false) => {
  const recipientType = isOwnerEmail ? 'Owner' : 'Company';
  const escapeHtml = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  
  const ownerPassword = ownerData?.password ? escapeHtml(ownerData.password) : 'As set during registration';
  const logoUrl = 'https://ciisnetwork.com/logoo.png';
  const loginUrl = companyData.loginUrl || 'https://ciisnetwork.com/login';
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to CIIS NETWORK</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f1f5f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; -webkit-font-smoothing: antialiased; }
    table { border-spacing: 0; }
    td { padding: 0; }
    .wrapper { width: 100%; background-color: #f1f5f9; padding: 30px 0; }
    .main-container { max-width: 700px; margin: 0 auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.05); }
    
    /* Header */
    .header-bg { background: linear-gradient(135deg, #021a4f 0%, #03459c 100%); padding: 40px; color: #ffffff; position: relative; }
    .header-logo { width: 180px; margin-bottom: 25px; }
    .header-subtitle { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #93c5fd; margin-bottom: 10px; display: block; }
    .header-title { font-size: 36px; margin: 0 0 15px 0; line-height: 1.2; letter-spacing: -0.5px; }
    .header-text { font-size: 15px; color: #e2e8f0; margin: 0 0 25px 0; max-width: 65%; line-height: 1.5; }
    .header-badge { display: inline-block; background-color: #22c55e; color: #ffffff; padding: 8px 16px; border-radius: 20px; font-size: 13px; box-shadow: 0 4px 6px rgba(34,197,94,0.3); }
    
    /* Content */
    .content { padding: 40px; }
    .greeting-title { color: #0f172a; font-size: 20px; margin: 0 0 10px 0; }
    .greeting-text { color: #475569; font-size: 15px; line-height: 1.6; margin: 0 0 30px 0; }
    
    /* Owner Details Card */
    .card-owner { border: 1px solid #e2e8f0; border-radius: 12px; padding: 25px; margin-bottom: 25px; background: #ffffff; }
    .card-header-icon { width: 44px; height: 44px; background: #3b82f6; border-radius: 10px; display: inline-block; vertical-align: middle; text-align: center; line-height: 44px; color: white; font-size: 22px; margin-right: 15px; }
    .card-header-title { display: inline-block; vertical-align: middle; }
    .card-title { margin: 0; color: #0f172a; font-size: 18px; }
    .card-subtitle { margin: 2px 0 0 0; color: #64748b; font-size: 13px; }
    
    .detail-icon { display: inline-block; background: #eff6ff; color: #3b82f6; width: 28px; height: 28px; text-align: center; line-height: 28px; border-radius: 6px; font-size: 14px; }
    .detail-label { color: #475569; font-size: 14px; }
    .detail-val { color: #0f172a; font-size: 14px; }
    
    .shield-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 25px 20px; text-align: center; height: 100%; box-sizing: border-box; }
    
    /* Company Code Card */
    .card-code { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 12px; padding: 25px; margin-bottom: 25px; }
    .code-display { background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px 25px; font-family: 'Courier New', Courier, monospace; font-size: 26px; letter-spacing: 6px; color: #0f172a; display: inline-block; vertical-align: middle; }
    .copy-btn { display: inline-block; padding: 14px 20px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; color: #0f172a; font-size: 14px; vertical-align: middle; margin-left: 15px; cursor: pointer; }
    
    /* Login Info Card */
    .card-login { background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; padding: 25px; margin-bottom: 25px; }
    .url-box { background: #ffffff; border: 1px solid #fcd34d; border-radius: 8px; padding: 14px 20px; margin: 20px 0; }
    .url-link { color: #2563eb; font-size: 14px; text-decoration: underline; word-break: break-all; }
    .login-btn { display: inline-block; background: #2563eb; color: #ffffff !important; padding: 14px 24px; border-radius: 8px; text-decoration: none; font-size: 14px; }
    
    /* How to Login */
    .card-steps { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 25px; margin-bottom: 25px; }
    .step-num { display: inline-block; background: #2563eb; color: #ffffff; width: 32px; height: 32px; border-radius: 50%; text-align: center; line-height: 32px; font-size: 15px; margin-right: 12px; vertical-align: top; }
    .step-text { display: inline-block; width: 140px; vertical-align: top; }
    .step-title { color: #0f172a; font-size: 14px; margin-bottom: 4px; }
    .step-desc { color: #64748b; font-size: 12px; line-height: 1.4; }
    
    /* Next Steps */
    .card-next { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 25px; margin-bottom: 25px; }
    .check-item { display: inline-block; width: 22%; font-size: 12px; color: #15803d; vertical-align: top; padding-right: 10px; line-height: 1.4; }
    .check-icon { display: inline-block; background: #22c55e; color: white; width: 18px; height: 18px; border-radius: 50%; text-align: center; line-height: 18px; font-size: 10px; margin-right: 6px; }
    
    .dashboard-btn { display: block; width: fit-content; margin: 25px auto 0; background: #2563eb; color: #ffffff !important; padding: 16px 40px; border-radius: 30px; text-decoration: none; font-size: 16px; box-shadow: 0 4px 12px rgba(37,99,235,0.3); }
    
    /* Security */
    .card-security { background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 20px 25px; }
    
    /* Footer */
    .footer { background: #0f172a; padding: 30px 40px; border-bottom-left-radius: 16px; border-bottom-right-radius: 16px; }
    
    @media only screen and (max-width: 600px) {
      .header-text { max-width: 100%; }
      .code-display { font-size: 20px; letter-spacing: 3px; display: block; margin-bottom: 10px; }
      .copy-btn { margin-left: 0; display: block; width: 100%; text-align: center; box-sizing: border-box; }
      .step-text { width: 100%; margin-bottom: 15px; }
      .check-item { width: 100%; display: block; margin-bottom: 10px; }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="main-container">
      
      <!-- Header -->
      <div class="header-bg">
        <img src="${logoUrl}" alt="CIIS NETWORK" class="header-logo">
        <span class="header-subtitle">All-In-One Business Management Platform</span>
        <h1 class="header-title">Welcome to<br>CIIS NETWORK!</h1>
        <p class="header-text">Your company has been registered successfully.<br>We're excited to have you on board!</p>
        <div class="header-badge">✓ Company Registration Successful</div>
      </div>
      
      <div class="content">
        <h2 class="greeting-title">Dear ${escapeHtml(isOwnerEmail ? ownerData?.name || 'Owner' : companyData?.companyName || 'Company')},</h2>
        <p class="greeting-text">Thank you for registering with CIIS NETWORK. Your company account has been created successfully.<br>Below you will find your account details and important information to get started.</p>
        
        ${isOwnerEmail ? `
        <!-- Owner Details -->
        <div class="card-owner">
          <div style="margin-bottom: 25px;">
            <div class="card-header-icon">👑</div>
            <div class="card-header-title">
              <h3 class="card-title">Owner Account Details</h3>
              <p class="card-subtitle">These are your Super Admin credentials. Keep them secure.</p>
            </div>
          </div>
          
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="60%" valign="top">
                <table width="100%" cellpadding="10" cellspacing="0" border="0">
                  <tr>
                    <td width="40"><span class="detail-icon">📧</span></td>
                    <td width="120" class="detail-label">Email Address</td>
                    <td class="detail-val" style="color: #2563eb;">${escapeHtml(ownerData.email)}</td>
                  </tr>
                  <tr>
                    <td><span class="detail-icon">🔒</span></td>
                    <td class="detail-label">Password</td>
                    <td class="detail-val" style="color: #16a34a;">${ownerPassword}</td>
                  </tr>
                  <tr>
                    <td><span class="detail-icon">👥</span></td>
                    <td class="detail-label">Role</td>
                    <td class="detail-val" style="color: #9333ea;">Super Admin / Owner</td>
                  </tr>
                  <tr>
                    <td><span class="detail-icon">🏢</span></td>
                    <td class="detail-label">Department</td>
                    <td class="detail-val">Management</td>
                  </tr>
                </table>
              </td>
              <td width="40%" valign="top" style="padding-left: 20px;">
                <div class="shield-box">
                  <div style="font-size: 36px; margin-bottom: 12px; color: #2563eb;">🛡️</div>
                  <div style="color: #0f172a; font-size: 15px; margin-bottom: 8px;">Keep Your Credentials<br>Secure</div>
                  <div style="color: #64748b; font-size: 12px; line-height: 1.5;">Do not share your login details<br>with anyone.</div>
                </div>
              </td>
            </tr>
          </table>
        </div>
        ` : `
        <!-- Company Details for non-owner -->
        <div class="card-owner">
          <div style="margin-bottom: 25px;">
            <div class="card-header-icon">🏢</div>
            <div class="card-header-title">
              <h3 class="card-title">Company Details</h3>
              <p class="card-subtitle">These are your registered company details.</p>
            </div>
          </div>
          <table width="100%" cellpadding="10" cellspacing="0" border="0">
            <tr>
              <td width="40"><span class="detail-icon">🏢</span></td>
              <td width="120" class="detail-label">Company Name</td>
              <td class="detail-val">${escapeHtml(companyData.companyName)}</td>
            </tr>
            <tr>
              <td><span class="detail-icon">📧</span></td>
              <td class="detail-label">Email</td>
              <td class="detail-val">${escapeHtml(companyData.companyEmail)}</td>
            </tr>
            <tr>
              <td><span class="detail-icon">📞</span></td>
              <td class="detail-label">Phone</td>
              <td class="detail-val">${escapeHtml(companyData.companyPhone)}</td>
            </tr>
          </table>
        </div>
        `}

        <!-- Company Code -->
        <div class="card-code">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="55" valign="top">
                <div style="width: 40px; height: 40px; background: #38bdf8; border-radius: 10px; display: inline-block; text-align: center; line-height: 40px; color: white; font-size: 20px;">🏢</div>
              </td>
              <td valign="top">
                <h3 class="card-title">Your Company Code</h3>
                <p class="card-subtitle" style="margin-bottom: 20px;">Use this code when adding employees to your company.</p>
                <div>
                  <span class="code-display">${escapeHtml(companyData.companyCode)}</span>
                  <span class="copy-btn">📑 Copy Code</span>
                </div>
              </td>
            </tr>
          </table>
        </div>
        
        <!-- Login Info -->
        <div class="card-login">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="55" valign="top">
                <div style="width: 40px; height: 40px; background: #d97706; border-radius: 50%; display: inline-block; text-align: center; line-height: 40px; color: white; font-size: 20px;">🔑</div>
              </td>
              <td valign="top">
                <h3 class="card-title" style="color: #92400e;">Login Information</h3>
                <p class="card-subtitle" style="color: #b45309;">You can access your account using the following login URL.</p>
                <div class="url-box">
                  <span style="font-size: 16px; margin-right: 8px;">🔗</span>
                  <a href="${loginUrl}" class="url-link">${loginUrl}</a>
                </div>
                <a href="${loginUrl}" class="login-btn">Open Login Page ↗</a>
              </td>
            </tr>
          </table>
        </div>
        
        <!-- How to Login -->
        <div class="card-steps">
          <div style="margin-bottom: 20px;">
            <span style="font-size: 18px; margin-right: 8px; vertical-align: middle;">📄</span>
            <span style="color: #0f172a; font-size: 16px; vertical-align: middle;">How to Login</span>
          </div>
          
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="33%" valign="top">
                <div class="step-num">1</div>
                <div class="step-text">
                  <div class="step-title">Visit the login URL</div>
                  <div class="step-desc">Click the login link above or visit our portal.</div>
                </div>
              </td>
              <td width="33%" valign="top">
                <div class="step-num">2</div>
                <div class="step-text">
                  <div class="step-title">Enter your credentials</div>
                  <div class="step-desc">Use your email and password to login.</div>
                </div>
              </td>
              <td width="33%" valign="top">
                <div class="step-num">3</div>
                <div class="step-text">
                  <div class="step-title">Access your dashboard</div>
                  <div class="step-desc">Start managing your company and team.</div>
                </div>
              </td>
            </tr>
          </table>
        </div>
        
        <!-- Next Steps -->
        <div class="card-next">
          <div style="margin-bottom: 20px;">
            <span style="font-size: 18px; margin-right: 8px; vertical-align: middle;">🚀</span>
            <span style="color: #166534; font-size: 16px; vertical-align: middle;">Next Steps</span>
          </div>
          
          <div>
            <div class="check-item"><span class="check-icon">✓</span>Login to your admin dashboard</div>
            <div class="check-item"><span class="check-icon">✓</span>Complete your company profile</div>
            <div class="check-item"><span class="check-icon">✓</span>Add employees using the company code</div>
            <div class="check-item"><span class="check-icon">✓</span>Configure leave policies and departments</div>
          </div>
          
          <a href="${loginUrl}" class="dashboard-btn">🚀 Access Your Dashboard →</a>
        </div>
        
        <!-- Security -->
        <div class="card-security">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="40" valign="top">
                <div style="font-size: 24px;">🛡️</div>
              </td>
              <td valign="top">
                <div style="color: #991b1b; font-size: 14px; margin-bottom: 4px;">Important Security Information</div>
                <div style="color: #b91c1c; font-size: 12px; line-height: 1.5;">This email contains confidential information. If you didn't create this account, please contact our support team immediately at <a href="mailto:info@ciisnetwork.com" style="color: #1d4ed8;">info@ciisnetwork.com</a>.</div>
              </td>
            </tr>
          </table>
        </div>
        
      </div>
      
      <!-- Footer -->
      <div class="footer">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="30%" valign="middle">
              <img src="${logoUrl}" alt="CIIS NETWORK" style="width: 140px;">
            </td>
            <td width="40%" align="center" valign="middle" style="color: #64748b; font-size: 12px; line-height: 1.6;">
              © ${new Date().getFullYear()} CIIS NETWORK. All rights reserved.<br>
              This is a system-generated email. Please do not reply to this message.
            </td>
            <td width="30%" align="right" valign="middle" style="font-size: 14px;">
              <a href="#" style="display: inline-block; width: 28px; height: 28px; background: #1e293b; color: #38bdf8; text-align: center; line-height: 28px; border-radius: 50%; text-decoration: none; margin-left: 8px;">in</a>
              <a href="#" style="display: inline-block; width: 28px; height: 28px; background: #1e293b; color: #94a3b8; text-align: center; line-height: 28px; border-radius: 50%; text-decoration: none; margin-left: 8px;">🌐</a>
              <a href="#" style="display: inline-block; width: 28px; height: 28px; background: #1e293b; color: #ef4444; text-align: center; line-height: 28px; border-radius: 50%; text-decoration: none; margin-left: 8px;">▶</a>
            </td>
          </tr>
        </table>
      </div>
      
    </div>
  </div>
</body>
</html>`;
};

module.exports = {
  getCompanyRegistrationEmailTemplate
};
