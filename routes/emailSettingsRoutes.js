const express = require("express");
const router = express.Router();
const {
  getPublicEmailSettings,
  updateEmailSettings,
  updateGlobalEmailEnabled,
  createEmailTransporter,
  isEmailModuleEnabled,
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
    if (req.body?.globalOnly === true) {
      const settings = await updateGlobalEmailEnabled(req.body?.enabled, req.user?._id);
      return res.json({
        success: true,
        message: settings.enabled ? "Global email switch enabled" : "Global email switch disabled",
        settings,
      });
    }

    const settings = await updateEmailSettings(req.body, req.user?._id);
    res.json({ success: true, message: "Email settings saved successfully", settings });
  } catch (error) {
    console.error("Update email settings error:", error);
    res.status(400).json({ success: false, message: error.message || "Failed to save email settings" });
  }
});

router.patch("/global-switch", async (req, res) => {
  try {
    const settings = await updateGlobalEmailEnabled(req.body?.enabled, req.user?._id);
    res.json({
      success: true,
      message: settings.enabled ? "Global email switch enabled" : "Global email switch disabled",
      settings,
    });
  } catch (error) {
    console.error("Update global email switch error:", error);
    res.status(400).json({ success: false, message: error.message || "Failed to update global email switch" });
  }
});

router.post("/global-switch", async (req, res) => {
  try {
    const settings = await updateGlobalEmailEnabled(req.body?.enabled, req.user?._id);
    res.json({
      success: true,
      message: settings.enabled ? "Global email switch enabled" : "Global email switch disabled",
      settings,
    });
  } catch (error) {
    console.error("Update global email switch error:", error);
    res.status(400).json({ success: false, message: error.message || "Failed to update global email switch" });
  }
});

router.post("/test", async (req, res) => {
  const testEmail = String(req.body?.testEmail || "").trim().toLowerCase();

  try {
    const testEmailEnabled = await isEmailModuleEnabled("test_email");
    if (!testEmailEnabled) {
      return res.status(400).json({
        success: false,
        message: "Test Email module is disabled",
      });
    }

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
      headers: {
        "X-Email-Type": "test-email",
      },
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
    const rawMessage = error.message || "";
    const friendlyMessage = rawMessage.includes("535") || rawMessage.includes("BadCredentials")
      ? "Gmail ne SMTP login reject kiya. Sender Email aur 16-character Gmail App Password check karein. Normal Gmail password use nahi hoga."
      : rawMessage;
    const settings = await markEmailTestResult({
      success: false,
      message: friendlyMessage,
    });
    res.status(400).json({
      success: false,
      message: friendlyMessage || "Test email failed",
      settings,
    });
  }
});

module.exports = router;
