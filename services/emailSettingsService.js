const crypto = require("crypto");
const nodemailer = require("nodemailer");
const EmailSettings = require("../models/EmailSettings");

const SETTINGS_KEY = "global";
let cachedSettings = null; 
let cachedAt = 0;
let cachedIncludesSecret = false;
const CACHE_TTL_MS = 5000;    
const DEFAULT_PROFILE_ID = "default";  

const EMAIL_MODULES = [
  { key: "company_login_otp", label: "Company Login OTP", area: "Authentication", description: "OTP email used when company users sign in." },
  { key: "superadmin_login_otp", label: "Super Admin Login OTP", area: "Authentication", description: "OTP email used when Super Admin signs in." },
  { key: "password_reset", label: "Password Reset OTP", area: "Authentication", description: "Forgot password OTP and reset confirmation emails." },
  { key: "company_registration", label: "Company Registration", area: "Companies", description: "Company registration and owner access emails." },
  { key: "user_welcome", label: "User Welcome", area: "Users", description: "New user welcome and account-created emails." },
  { key: "leave_notifications", label: "Leave Notifications", area: "HR", description: "Leave applied, updated, deleted, and status emails." },
  { key: "work_anniversary", label: "Work Anniversary", area: "HR", description: "Annual employee work anniversary celebration emails." },
  { key: "asset_requests", label: "Asset Requests", area: "HR", description: "Asset request submitted, assigned, and status emails." },
  { key: "meeting_notifications", label: "Meeting Notifications", area: "Meetings", description: "Employee and client meeting schedule, update, and reminder emails." },
  { key: "task_notifications", label: "Task Notifications", area: "Tasks", description: "Task assignment, update, overdue, and pending reminder emails." },
  { key: "client_tasks", label: "Client Task Updates", area: "Clients", description: "Client-facing task update and completion emails." },
  { key: "project_notifications", label: "Project Notifications", area: "Projects", description: "Project assignment and project update emails." },
  { key: "service_enquiries", label: "Service Enquiries", area: "Services", description: "Service enquiry and marketplace related emails." },
  { key: "subscription_reminders", label: "Subscription Reminders", area: "Billing", description: "Subscription expiry reminder emails." },
  { key: "support_notifications", label: "Support Notifications", area: "Support", description: "Support ticket and enquiry emails." },
  { key: "test_email", label: "Test Email", area: "System", description: "SMTP test email from this settings page." },
  { key: "general", label: "General / Unmapped Emails", area: "System", description: "Fallback for any email that does not match a known module." },
];

const DEFAULT_MODULE_SETTINGS = EMAIL_MODULES.reduce((acc, moduleItem) => {
  acc[moduleItem.key] = true;
  return acc;
}, {});

const DEFAULT_LOGIN_SETTINGS = {
  companyLoginOtpEnabled: true,
  superAdminLoginOtpEnabled: true,
};





const parseBoolean = (value) => (
  value === true ||
  value === "true" ||
  value === 1 ||
  value === "1" ||
  value === "on"
);

const getEncryptionKey = () => crypto
  .createHash("sha256")
  .update(process.env.EMAIL_SETTINGS_SECRET || process.env.JWT_SECRET || "ciis-email-settings")
  .digest();

const encryptSecret = (plainText) => {
  if (!plainText) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(".");
};

const decryptSecret = (encryptedValue) => {
  if (!encryptedValue) return "";
  try {
    const [ivValue, tagValue, encryptedText] = String(encryptedValue).split(".");
    if (!ivValue || !tagValue || !encryptedText) return "";
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(),
      Buffer.from(ivValue, "base64")
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch (error) {
    console.error("Failed to decrypt email password:", error.message);
    return "";
  }
};

const maskEmail = (email) => {
  if (!email) return "";
  const [name, domain] = String(email).split("@");
  if (!domain) return email;
  const visibleName = name.length <= 2 ? `${name[0] || ""}*` : `${name.slice(0, 2)}***${name.slice(-1)}`;
  return `${visibleName}@${domain}`;
};

const maskSecret = (value) => {
  if (!value) return "";
  return value.length <= 4 ? "****" : `${"*".repeat(Math.min(value.length - 4, 12))}${value.slice(-4)}`;
};

const createProfileId = () => `sender_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

const normalizeSenderProfile = (profile = {}) => ({
  profileId: String(profile.profileId || createProfileId()).trim(),
  label: String(profile.label || profile.emailUser || "Sender Account").trim(),
  senderName: String(profile.senderName || "CIIS NETWORK").trim(),
  emailUser: String(profile.emailUser || "").trim().toLowerCase(),
  encryptedEmailPass: profile.encryptedEmailPass || "",
  emailService: String(profile.emailService || "Gmail").trim(),
  emailHost: String(profile.emailHost || "").trim(),
  emailPort: Number(profile.emailPort || 465),
  emailSecure: profile.emailSecure !== false,
  replyTo: String(profile.replyTo || profile.emailUser || "").trim().toLowerCase(),
});

const normalizeEmailPassword = (password, profile = {}) => {
  const value = String(password || "");
  const host = String(profile.emailHost || "").trim().toLowerCase();
  const service = String(profile.emailService || "").trim().toLowerCase();
  return host === "smtp.gmail.com" || service === "gmail"
    ? value.replace(/\s+/g, "")
    : value;
};

const buildLegacyProfile = (settings) => normalizeSenderProfile({
  profileId: DEFAULT_PROFILE_ID,
  label: settings.emailUser ? `Default - ${settings.emailUser}` : "Default Sender",
  senderName: settings.senderName,
  emailUser: settings.emailUser,
  encryptedEmailPass: settings.encryptedEmailPass,
  emailService: settings.emailService,
  emailHost: settings.emailHost,
  emailPort: settings.emailPort,
  emailSecure: settings.emailSecure,
  replyTo: settings.replyTo,
});

const getProfilesFromSettings = (settings) => {
  const profiles = Array.isArray(settings.senderProfiles)
    ? settings.senderProfiles.map(profile => normalizeSenderProfile(profile))
    : [];

  if (!profiles.length && (settings.emailUser || settings.encryptedEmailPass)) {
    profiles.push(buildLegacyProfile(settings));
  }

  return profiles;
};

const getActiveSenderProfile = (settings) => {
  const profiles = getProfilesFromSettings(settings);
  const activeProfileId = settings.activeSenderProfileId || profiles[0]?.profileId || DEFAULT_PROFILE_ID;
  return profiles.find(profile => profile.profileId === activeProfileId) || profiles[0] || buildLegacyProfile(settings);
};

const getSettingsDocument = async ({ includeSecret = false, fresh = false } = {}) => {
  const now = Date.now();
  if (
    !fresh &&
    cachedSettings &&
    now - cachedAt < CACHE_TTL_MS &&
    (!includeSecret || cachedIncludesSecret)
  ) {
    return cachedSettings;
  }

  const query = EmailSettings.findOne({ key: SETTINGS_KEY });
  if (includeSecret) query.select("+encryptedEmailPass +senderProfiles.encryptedEmailPass");
  let settings = await query;

  if (!settings) {
    settings = await EmailSettings.create({
      key: SETTINGS_KEY,
      enabled: process.env.EMAIL_ENABLED !== "false",
      senderName: process.env.EMAIL_SENDER_NAME || "CIIS NETWORK",
      emailUser: process.env.EMAIL_USER || "",
      encryptedEmailPass: encryptSecret(process.env.EMAIL_PASS || ""),
      emailService: process.env.EMAIL_SERVICE || "Gmail",
      emailHost: process.env.EMAIL_HOST || "",
      emailPort: Number(process.env.EMAIL_PORT || 465),
      emailSecure: process.env.EMAIL_SECURE ? process.env.EMAIL_SECURE === "true" : true,
      replyTo: process.env.EMAIL_REPLY_TO || process.env.EMAIL_USER || "",
      activeSenderProfileId: DEFAULT_PROFILE_ID,
      senderProfiles: [{
        profileId: DEFAULT_PROFILE_ID,
        label: process.env.EMAIL_USER ? `Default - ${process.env.EMAIL_USER}` : "Default Sender",
        senderName: process.env.EMAIL_SENDER_NAME || "CIIS NETWORK",
        emailUser: process.env.EMAIL_USER || "",
        encryptedEmailPass: encryptSecret(process.env.EMAIL_PASS || ""),
        emailService: process.env.EMAIL_SERVICE || "Gmail",
        emailHost: process.env.EMAIL_HOST || "",
        emailPort: Number(process.env.EMAIL_PORT || 465),
        emailSecure: process.env.EMAIL_SECURE ? process.env.EMAIL_SECURE === "true" : true,
        replyTo: process.env.EMAIL_REPLY_TO || process.env.EMAIL_USER || "",
      }],
      moduleSettings: DEFAULT_MODULE_SETTINGS,
      loginSettings: DEFAULT_LOGIN_SETTINGS,
    });
    if (includeSecret) {
      settings = await EmailSettings.findOne({ key: SETTINGS_KEY }).select("+encryptedEmailPass +senderProfiles.encryptedEmailPass");
    }
  }

  cachedSettings = settings;
  cachedAt = now;
  cachedIncludesSecret = includeSecret;
  return settings;
};

const clearEmailSettingsCache = () => {
  cachedSettings = null;
  cachedAt = 0;
  cachedIncludesSecret = false;
};

const normalizeModuleSettings = (value = {}) => {
  const source = value instanceof Map ? Object.fromEntries(value.entries()) : value || {};
  return EMAIL_MODULES.reduce((acc, moduleItem) => {
    acc[moduleItem.key] = source[moduleItem.key] !== false;
    return acc;
  }, {});
};

const normalizeLoginSettings = (value = {}) => ({
  companyLoginOtpEnabled: value.companyLoginOtpEnabled !== false,
  superAdminLoginOtpEnabled: value.superAdminLoginOtpEnabled !== false,
});

const sanitizeSettings = (settings) => {
  const activeProfile = getActiveSenderProfile(settings);
  const decryptedPass = decryptSecret(activeProfile.encryptedEmailPass || settings.encryptedEmailPass);
  const moduleSettings = normalizeModuleSettings(settings.moduleSettings);
  const loginSettings = normalizeLoginSettings(settings.loginSettings);
  const senderProfiles = getProfilesFromSettings(settings);

  return {
    id: settings._id,
    enabled: settings.enabled,
    activeSenderProfileId: activeProfile.profileId,
    senderProfileLabel: activeProfile.label,
    senderProfiles: senderProfiles.map(profile => {
      const profilePass = decryptSecret(profile.encryptedEmailPass);
      return {
        profileId: profile.profileId,
        label: profile.label,
        senderName: profile.senderName,
        emailUser: profile.emailUser,
        maskedEmailUser: maskEmail(profile.emailUser),
        hasPassword: Boolean(profilePass),
        maskedPassword: maskSecret(profilePass),
        emailService: profile.emailService,
        emailHost: profile.emailHost,
        emailPort: profile.emailPort,
        emailSecure: profile.emailSecure,
        replyTo: profile.replyTo,
        active: profile.profileId === activeProfile.profileId,
      };
    }),
    senderName: activeProfile.senderName,
    emailUser: activeProfile.emailUser,
    maskedEmailUser: maskEmail(activeProfile.emailUser),
    hasPassword: Boolean(decryptedPass),
    maskedPassword: maskSecret(decryptedPass),
    emailService: activeProfile.emailService,
    emailHost: activeProfile.emailHost,
    emailPort: activeProfile.emailPort,
    emailSecure: activeProfile.emailSecure,
    replyTo: activeProfile.replyTo,
    moduleSettings,
    loginSettings,
    emailModules: EMAIL_MODULES.map(moduleItem => ({
      ...moduleItem,
      enabled: moduleSettings[moduleItem.key] !== false,
    })),
    lastTestedAt: settings.lastTestedAt,
    lastTestStatus: settings.lastTestStatus,
    lastTestMessage: settings.lastTestMessage,
    updatedAt: settings.updatedAt,
  };
};

const getPublicEmailSettings = async () => {
  const settings = await getSettingsDocument({ includeSecret: true, fresh: true });
  return sanitizeSettings(settings);
};

const updateEmailSettings = async (payload, updatedBy) => {
  const current = await getSettingsDocument({ includeSecret: true, fresh: true });
  const currentProfiles = getProfilesFromSettings(current);
  const selectedProfileId = String(payload.activeSenderProfileId || payload.senderProfileId || current.activeSenderProfileId || currentProfiles[0]?.profileId || DEFAULT_PROFILE_ID).trim();
  let activeProfileId = selectedProfileId || DEFAULT_PROFILE_ID;
  let senderProfiles = [...currentProfiles];
  const existingIndex = senderProfiles.findIndex(profile => profile.profileId === activeProfileId);
  const existingProfile = existingIndex >= 0 ? senderProfiles[existingIndex] : null;
  const shouldSaveSenderProfile = Boolean(
    payload.saveSenderProfile !== false &&
    (payload.emailUser !== undefined ||
      payload.emailPass ||
      payload.senderName !== undefined ||
      payload.senderProfileLabel !== undefined ||
      payload.emailService !== undefined ||
      payload.emailHost !== undefined ||
      payload.emailPort !== undefined ||
      payload.emailSecure !== undefined ||
      payload.replyTo !== undefined)
  );

  if (payload.createSenderProfile === true || !activeProfileId) {
    activeProfileId = createProfileId();
  }

  if (shouldSaveSenderProfile) {
    const nextProfile = normalizeSenderProfile({
      ...(existingProfile || {}),
      profileId: activeProfileId,
      label: payload.senderProfileLabel || existingProfile?.label || payload.emailUser || "Sender Account",
      senderName: payload.senderName !== undefined ? payload.senderName : existingProfile?.senderName,
      emailUser: payload.emailUser !== undefined ? payload.emailUser : existingProfile?.emailUser,
      encryptedEmailPass: payload.emailPass
        ? encryptSecret(normalizeEmailPassword(payload.emailPass, {
            emailHost: payload.emailHost !== undefined ? payload.emailHost : existingProfile?.emailHost,
            emailService: payload.emailService !== undefined ? payload.emailService : existingProfile?.emailService,
          }))
        : existingProfile?.encryptedEmailPass || "",
      emailService: payload.emailService !== undefined ? payload.emailService : existingProfile?.emailService,
      emailHost: payload.emailHost !== undefined ? payload.emailHost : existingProfile?.emailHost,
      emailPort: payload.emailPort !== undefined ? payload.emailPort : existingProfile?.emailPort,
      emailSecure: payload.emailSecure !== undefined ? payload.emailSecure : existingProfile?.emailSecure,
      replyTo: payload.replyTo !== undefined ? payload.replyTo : existingProfile?.replyTo,
    });

    if (existingIndex >= 0) {
      senderProfiles[existingIndex] = nextProfile;
    } else {
      senderProfiles.push(nextProfile);
    }
  }

  if (!senderProfiles.length) {
    senderProfiles = [buildLegacyProfile(current)];
    activeProfileId = senderProfiles[0].profileId;
  }

  const activeProfile = senderProfiles.find(profile => profile.profileId === activeProfileId) || senderProfiles[0];
  activeProfileId = activeProfile.profileId;
  const currentModuleSettings = normalizeModuleSettings(current.moduleSettings);
  const incomingModuleSettings = payload.moduleSettings && typeof payload.moduleSettings === "object"
    ? payload.moduleSettings
    : {};
  const moduleSettings = EMAIL_MODULES.reduce((acc, moduleItem) => {
    acc[moduleItem.key] = incomingModuleSettings[moduleItem.key] !== undefined
      ? Boolean(incomingModuleSettings[moduleItem.key])
      : currentModuleSettings[moduleItem.key] !== false;
    return acc;
  }, {});

  const currentLoginSettings = normalizeLoginSettings(current.loginSettings);
  const incomingLoginSettings = payload.loginSettings && typeof payload.loginSettings === "object"
    ? payload.loginSettings
    : {};
  const loginSettings = {
    companyLoginOtpEnabled: incomingLoginSettings.companyLoginOtpEnabled !== undefined
      ? Boolean(incomingLoginSettings.companyLoginOtpEnabled)
      : currentLoginSettings.companyLoginOtpEnabled,
    superAdminLoginOtpEnabled: incomingLoginSettings.superAdminLoginOtpEnabled !== undefined
      ? Boolean(incomingLoginSettings.superAdminLoginOtpEnabled)
      : currentLoginSettings.superAdminLoginOtpEnabled,
  };

  const updates = {
    enabled: payload.enabled !== undefined ? Boolean(payload.enabled) : current.enabled,
    activeSenderProfileId: activeProfileId,
    senderProfiles,
    senderName: activeProfile.senderName,
    emailUser: activeProfile.emailUser,
    encryptedEmailPass: activeProfile.encryptedEmailPass,
    emailService: activeProfile.emailService,
    emailHost: activeProfile.emailHost,
    emailPort: Number(activeProfile.emailPort || 465),
    emailSecure: activeProfile.emailSecure !== false,
    replyTo: activeProfile.replyTo || activeProfile.emailUser,
    moduleSettings,
    loginSettings,
    updatedBy: updatedBy || null,
  };

  if (updates.enabled && !updates.emailUser) {
    throw new Error("Sender email is required");
  }

  if (!Number.isFinite(updates.emailPort) || updates.emailPort < 1 || updates.emailPort > 65535) {
    throw new Error("SMTP port must be between 1 and 65535");
  }

  const settings = await EmailSettings.findOneAndUpdate(
    { key: SETTINGS_KEY },
    updates,
    { new: true, runValidators: true, upsert: true, setDefaultsOnInsert: true }
  ).select("+encryptedEmailPass +senderProfiles.encryptedEmailPass");

  clearEmailSettingsCache();
  return sanitizeSettings(settings);
};

const updateGlobalEmailEnabled = async (enabled, updatedBy) => {
  const current = await getSettingsDocument({ includeSecret: true, fresh: true });
  const settings = await EmailSettings.findOneAndUpdate(
    { key: SETTINGS_KEY },
    {
      enabled: parseBoolean(enabled),
      updatedBy: updatedBy || current.updatedBy || null,
    },
    { new: true, runValidators: true, upsert: true, setDefaultsOnInsert: true }
  ).select("+encryptedEmailPass +senderProfiles.encryptedEmailPass");

  clearEmailSettingsCache();
  return sanitizeSettings(settings);
};

const updateEmailModuleEnabled = async (moduleKey, enabled, updatedBy) => {
  const normalizedModuleKey = String(moduleKey || "").trim();
  const moduleExists = EMAIL_MODULES.some(moduleItem => moduleItem.key === normalizedModuleKey);

  if (!moduleExists) {
    throw new Error("Invalid email module");
  }

  const settings = await EmailSettings.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $set: {
      [`moduleSettings.${normalizedModuleKey}`]: parseBoolean(enabled),
      ...(updatedBy ? { updatedBy } : {}),
    } },
    { new: true, runValidators: true, upsert: true, setDefaultsOnInsert: true }
  ).select("+encryptedEmailPass +senderProfiles.encryptedEmailPass");

  clearEmailSettingsCache();
  return sanitizeSettings(settings);
};

const getEmailRuntimeConfig = async () => {
  const settings = await getSettingsDocument({ includeSecret: true });
  const activeProfile = getActiveSenderProfile(settings);
  const emailPass = decryptSecret(activeProfile.encryptedEmailPass || settings.encryptedEmailPass) || process.env.EMAIL_PASS || "";
  const emailUser = activeProfile.emailUser || settings.emailUser || process.env.EMAIL_USER || "";
  const moduleSettings = normalizeModuleSettings(settings.moduleSettings);
  const loginSettings = normalizeLoginSettings(settings.loginSettings);

  return {
    enabled: settings.enabled !== false,
    senderName: activeProfile.senderName || settings.senderName || process.env.EMAIL_SENDER_NAME || "CIIS NETWORK",
    emailUser,
    emailPass,
    emailService: activeProfile.emailService || settings.emailService || process.env.EMAIL_SERVICE || "Gmail",
    emailHost: activeProfile.emailHost || settings.emailHost || process.env.EMAIL_HOST || "",
    emailPort: Number(activeProfile.emailPort || settings.emailPort || process.env.EMAIL_PORT || 465),
    emailSecure: activeProfile.emailSecure !== undefined
      ? activeProfile.emailSecure
      : process.env.EMAIL_SECURE === "true",
    replyTo: activeProfile.replyTo || settings.replyTo || process.env.EMAIL_REPLY_TO || emailUser,
    activeSenderProfileId: activeProfile.profileId,
    moduleSettings,
    loginSettings,
  };
};

const getLoginSettings = async () => {
  const settings = await getSettingsDocument();
  return normalizeLoginSettings(settings.loginSettings);
};

const getModuleSettings = async () => {
  const settings = await getSettingsDocument();
  return normalizeModuleSettings(settings.moduleSettings);
};

const isEmailModuleEnabled = async (moduleKey = "general") => {
  const settings = await getSettingsDocument();
  if (settings.enabled === false) return false;
  const moduleSettings = normalizeModuleSettings(settings.moduleSettings);
  return moduleSettings[moduleKey] !== false;
};

const resolveEmailModuleKey = (subject = "", options = {}) => {
  if (options.emailModuleKey) return options.emailModuleKey;

  const headerType = String(options.headers?.["X-Email-Type"] || "").toLowerCase();
  const text = `${subject} ${headerType} ${options.notificationType || ""}`.toLowerCase();

  if (text.includes("super admin login") || text.includes("superadmin")) return "superadmin_login_otp";
  if (text.includes("login verification") || text.includes("login otp") || text.includes("company login")) return "company_login_otp";
  if (text.includes("password reset") || text.includes("forgot password")) return "password_reset";
  if (text.includes("company registration") || text.includes("company-reg") || headerType.includes("company-registration")) return "company_registration";
  if (text.includes("welcome") || headerType.includes("user-welcome") || headerType.includes("owner-registration")) return "user_welcome";
  if (text.includes("leave")) return "leave_notifications";
  if (text.includes("work anniversary") || headerType.includes("work-anniversary")) return "work_anniversary";
  if (text.includes("asset request")) return "asset_requests";
  if (text.includes("meeting")) return "meeting_notifications";
  if (text.includes("client task")) return "client_tasks";
  if (text.includes("task")) return "task_notifications";
  if (text.includes("project")) return "project_notifications";
  if (text.includes("service enquiry") || text.includes("service")) return "service_enquiries";
  if (text.includes("subscription")) return "subscription_reminders";
  if (text.includes("support")) return "support_notifications";
  if (text.includes("test")) return "test_email";

  return "general";
};

const buildTransportConfig = (config) => {
  const transportConfig = {
    auth: {
      user: config.emailUser,
      pass: config.emailPass,
    },
    tls: {
      rejectUnauthorized: process.env.NODE_ENV === "production",
    },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  };

  if (config.emailHost) {
    transportConfig.host = config.emailHost;
    transportConfig.port = config.emailPort;
    transportConfig.secure = config.emailSecure || config.emailPort === 465;
  } else {
    transportConfig.service = config.emailService || "Gmail";
  }

  return transportConfig;
};

const createEmailTransporter = async () => {
  const config = await getEmailRuntimeConfig();

  if (!config.enabled) {
    const error = new Error("Email service is disabled from Email Settings");
    error.code = "EMAIL_DISABLED";
    throw error;
  }

  if (!config.emailUser || !config.emailPass) {
    const error = new Error("Email service not configured");
    error.code = "EMAIL_NOT_CONFIGURED";
    throw error;
  }

  return {
    config,
    transporter: nodemailer.createTransport(buildTransportConfig(config)),
  };
};

const markEmailTestResult = async ({ success, message }) => {
  const settings = await EmailSettings.findOneAndUpdate(
    { key: SETTINGS_KEY },
    {
      lastTestedAt: new Date(),
      lastTestStatus: success ? "success" : "failed",
      lastTestMessage: message || "",
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).select("+encryptedEmailPass +senderProfiles.encryptedEmailPass");
  clearEmailSettingsCache();
  return sanitizeSettings(settings);
};

module.exports = {
  EMAIL_MODULES,
  createEmailTransporter,
  getEmailRuntimeConfig,
  getLoginSettings,
  getModuleSettings,
  getPublicEmailSettings,
  updateEmailModuleEnabled,
  isEmailModuleEnabled,
  resolveEmailModuleKey,
  updateEmailSettings,
  updateGlobalEmailEnabled,
  markEmailTestResult,
  clearEmailSettingsCache,
};
