const User = require("../models/User");
const { invalidateAuthUser } = require("../middleware/authMiddleware");
const { notifyDirectUsers } = require("../HR-CDS/utils/systemNotificationService");

const PRIVILEGED_ROLES = new Set(["owner", "company-owner", "companyowner", "admin", "hr", "super-admin", "superadmin"]);
const normalizeRole = value => String(value?.name || value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");

// In-app account deletion requested by the signed-in user (App Store guideline 5.1.1(v)).
// The account is deactivated immediately, so login and every protected API stop working, and the
// company's owners/admins/HR are notified to finish removal. Company records (attendance,
// payroll, tasks) are kept because they belong to the employer.
exports.requestAccountDeletion = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const password = String(req.body?.password || "");
    if (!password) {
      return res.status(400).json({ success: false, message: "Please enter your password to confirm account deletion" });
    }

    const user = await User.findById(userId).select("+password +isActive name email company companyCode companyRole jobRole");
    if (!user || user.isActive === false) {
      return res.status(404).json({ success: false, message: "Account not found or already deleted" });
    }
    if (!(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: "Incorrect password" });
    }

    user.isActive = false;
    user.accountDeletionRequestedAt = new Date();
    user.accountDeletionReason = String(req.body?.reason || "").trim().slice(0, 500);
    await user.save({ validateBeforeSave: false });
    invalidateAuthUser(user._id);

    try {
      const admins = (await User.find({ company: user.company, isActive: true, _id: { $ne: user._id } })
        .select("_id companyRole jobRole")
        .lean())
        .filter(admin => PRIVILEGED_ROLES.has(normalizeRole(admin.companyRole)) || PRIVILEGED_ROLES.has(normalizeRole(admin.jobRole)));
      if (admins.length) {
        await notifyDirectUsers({
          userIds: admins.map(admin => admin._id),
          company: user.company,
          type: "account_deletion_request",
          title: "Account deletion requested",
          message: `${user.name || user.email} deleted their account from the app. Their login is disabled; please remove their personal data.`,
          targetPath: "/ciisUser/emp-details",
          data: { userId: String(user._id), email: user.email },
          priority: "high",
        });
      }
    } catch (notifyError) {
      console.error("[account-deletion] admin notification failed", notifyError.message);
    }

    return res.status(200).json({ success: true, message: "Your account has been deleted. You have been signed out." });
  } catch (error) {
    console.error("[account-deletion] failed", error);
    return res.status(500).json({ success: false, message: "Could not delete account. Please try again." });
  }
};
