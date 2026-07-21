const express = require("express");
const router = express.Router();
const {
  getPublicEmailSettings,
  updateEmailSettings,
  createEmailTransporter,
  markEmailTestResult,
} = require("../services/emailSettingsService");
const { protect } = require("../middleware/authMiddleware");

const OWNER_SUPERADMIN_EMAIL = "ashutoshrai130@gmail.com";

const requireOwnerSuperAdmin = (req, res, next) => {
  const email = String(req.user?.email || "").trim().toLowerCase();
  const jobRole = String(req.user?.jobRole || "").trim().toLowerCase();
  const companyRole = String(req.user?.companyRole || "").trim().toLowerCase();

  if (
    email === OWNER_SUPERADMIN_EMAIL ||
    jobRole === "super_admin" ||
    jobRole === "superadmin" ||
    companyRole === "superadmin"
  ) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: "Only SuperAdmin can manage email settings",
  });
};

router.use(protect, requireOwnerSuperAdmin);

router.get("/", async (req, res) => {
  try {
    const settings = await getPublicEmailSettings();
    res.json({ success: true, settings });
  } catch (error) {
    console.error("Get email settings error:", error);
    res.status(500).json({ success: false, message: "Failed to load email settings" });
  }
});

router.put("/", async (req, res) => {
  try {
    const settings = await updateEmailSettings(req.body, req.user?._id);
    res.json({ success: true, message: "Email settings saved successfully", settings });
  } catch (error) {
    console.error("Update email settings error:", error);
    res.status(400).json({ success: false, message: error.message || "Failed to save email settings" });
  }
});

router.post("/test", async (req, res) => {
  const testEmail = String(req.body?.testEmail || "").trim().toLowerCase();

  try {
    const { config, transporter } = await createEmailTransporter();
    await transporter.verify();
    const info = await transporter.sendMail({
      from: `"${config.senderName}" <${config.emailUser}>`,
      to: testEmail || config.emailUser,
      subject: "CIIS NETWORK - Email Settings Test",
      html: `
        <div style="font-family: Arial, sans-serif; color: #1f2937; padding: 20px;">
          <h2>Email Settings Test Successful</h2>
          <p>Your CIIS NETWORK email configuration is working correctly.</p>
          <p>Timestamp: ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</p>
        </div>
      `,
      replyTo: config.replyTo || config.emailUser,
    });

    const settings = await markEmailTestResult({
      success: true,
      message: `Test email sent to ${testEmail || config.emailUser}`,
    });

    res.json({
      success: true,
      message: "Test email sent successfully",
      messageId: info.messageId,
      settings,
    });
  } catch (error) {
    const settings = await markEmailTestResult({
      success: false,
      message: error.message,
    });
    res.status(400).json({
      success: false,
      message: error.message || "Test email failed",
      settings,
    });
  }
});

module.exports = router;
