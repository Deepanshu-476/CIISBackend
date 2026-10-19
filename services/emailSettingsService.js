const crypto = require("crypto");
const nodemailer = require("nodemailer");
const EmailSettings = require("../models/EmailSettings");
const EmailSenderUsage = require("../models/EmailSenderUsage");

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
  { key: "client_welcome", label: "Client Welcome", area: "Clients", description: "Welcome email with login credentials sent when a new client is created in Client Management (/ciisUser/emp-client)." },
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
  dailyLimit: Math.max(0, Math.floor(Number(profile.dailyLimit) || 0)),
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
  closeCachedTransporters();
};

// One pooled SMTP transporter per sender account, reused for every email. Creating a pooled
// transporter per email (as before) left its connections open after each send.
const transporterCache = new Map();
const transporterKey = (config) => [
  config.emailUser,
  config.emailHost,
  config.emailPort,
  config.emailService,
  crypto.createHash("sha256").update(String(config.emailPass || "")).digest("hex"),
].join("|");
const getCachedTransporter = (config) => {
  const key = transporterKey(config);
  if (!transporterCache.has(key)) transporterCache.set(key, nodemailer.createTransport(buildTransportConfig(config)));
  return transporterCache.get(key);
};
const dropCachedTransporter = (config) => {
  const key = transporterKey(config);
  const transporter = transporterCache.get(key);
  if (transporter) {
    try { transporter.close(); } catch (_error) {}
    transporterCache.delete(key);
  }
};
function closeCachedTransporters() {
  for (const transporter of transporterCache.values()) {
    try { transporter.close(); } catch (_error) {}
  }
  transporterCache.clear();
}

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
        dailyLimit: profile.dailyLimit || 0,
        effectiveDailyLimit: getDailyLimit(profile),
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
  return attachSenderUsage(sanitizeSettings(settings));
};

// Adds today's sent count and any pause to each sender account for the settings screen.
const attachSenderUsage = async (publicSettings) => {
  const senders = [...new Set((publicSettings.senderProfiles || []).map(profile => profile.emailUser).filter(Boolean))];
  if (!senders.length) return publicSettings;
  const now = new Date();
  const [todayRows, blockedRows] = await Promise.all([
    EmailSenderUsage.find({ sender: { $in: senders }, day: usageDay() }).lean(),
    EmailSenderUsage.find({ sender: { $in: senders }, blockedUntil: { $gt: now } }).lean(),
  ]);
  const today = new Map(todayRows.map(row => [row.sender, row]));
  const blocked = new Map(blockedRows.map(row => [row.sender, row]));
  return {
    ...publicSettings,
    usageDay: usageDay(),
    senderProfiles: publicSettings.senderProfiles.map(profile => ({
      ...profile,
      sentToday: today.get(profile.emailUser)?.count || 0,
      pausedUntil: blocked.get(profile.emailUser)?.blockedUntil || null,
      pausedReason: blocked.get(profile.emailUser)?.blockedReason || "",
    })),
  };
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
      payload.replyTo !== undefined ||
      payload.dailyLimit !== undefined)
  );

  if (payload.createSenderProfile === true || !activeProfileId) {
    activeProfileId = createProfileId();
  }

  if (shouldSaveSenderProfile && existingProfile && payload.emailUser !== undefined &&
      String(payload.emailUser).trim().toLowerCase() !== existingProfile.emailUser && !payload.emailPass) {
    throw new Error("Enter the SMTP password for the new sender email address");
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
      dailyLimit: payload.dailyLimit !== undefined ? payload.dailyLimit : existingProfile?.dailyLimit,
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
  return attachSenderUsage(sanitizeSettings(settings));
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
  return attachSenderUsage(sanitizeSettings(settings));
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
  return attachSenderUsage(sanitizeSettings(settings));
};

const getEmailRuntimeConfig = async () => {
  const settings = await getSettingsDocument({ includeSecret: true });
  const activeProfile = getActiveSenderProfile(settings);
  const matchesLegacySender = activeProfile.emailUser === settings.emailUser;
  const matchesEnvSender = activeProfile.emailUser === String(process.env.EMAIL_USER || "").trim().toLowerCase();
  const emailPass = decryptSecret(activeProfile.encryptedEmailPass || (matchesLegacySender ? settings.encryptedEmailPass : "")) || (matchesEnvSender ? process.env.EMAIL_PASS : "") || "";
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
  if (headerType.includes("client-welcome") || text.includes("client-welcome") || text.includes("client welcome") || (text.includes("welcome") && text.includes("client"))) return "client_welcome";
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
    transporter: getCachedTransporter(config),
  };
};

// ---- Sending with several sender accounts ----
// Each account sends up to its daily limit (recipients per day); then sending moves to the next
// account in the list, and after the last one back to the first. If the provider refuses earlier
// (daily limit, wrong password, connection), that account is paused and the same email is retried
// with the next one.

// Gmail allows 500 recipients a day for a normal account; the default leaves a margin.
const DEFAULT_DAILY_LIMITS = { gmail: 450, other: 300 };
const QUOTA_PAUSE_MS = 24 * 60 * 60 * 1000;
const AUTH_PAUSE_MS = 30 * 60 * 1000;
const CONNECTION_PAUSE_MS = 5 * 60 * 1000;

function getDailyLimit(profile = {}) {
  const configured = Math.floor(Number(profile.dailyLimit) || 0);
  if (configured > 0) return configured;
  const isGmail = /gmail/i.test(profile.emailService || "")
    || /smtp\.gmail\.com/i.test(profile.emailHost || "")
    || /@gmail\.com$/i.test(profile.emailUser || "");
  return isGmail ? DEFAULT_DAILY_LIMITS.gmail : DEFAULT_DAILY_LIMITS.other;
}

// Calendar day in India, so counts reset at local midnight.
function usageDay(now = Date.now()) {
  return new Date(now + 330 * 60 * 1000).toISOString().slice(0, 10);
}

const countRecipients = (mailOptions = {}) => ["to", "cc", "bcc"]
  .flatMap(field => {
    const value = mailOptions[field];
    if (!value) return [];
    return Array.isArray(value) ? value : String(value).split(",");
  })
  .map(item => String(item).trim())
  .filter(Boolean).length || 1;

const classifySendError = (error = {}) => {
  const text = `${error.message || ""} ${error.response || ""}`;
  const code = Number(error.responseCode) || 0;
  if (/5\.4\.5|sending limit|limit exceeded|quota|too many (messages|recipients|emails)|rate limit|daily limit/i.test(text)
    || ((code === 421 || code === 450 || code === 451 || code === 454) && /4\.7\.\d|limit|too many/i.test(text))) {
    return "quota";
  }
  if (error.code === "EAUTH" || code === 534 || code === 535 || /authentication|invalid login|username and password/i.test(text)) {
    return "auth";
  }
  if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "ECONNREFUSED", "ECONNRESET"].includes(error.code)
    || code === 421) {
    return "connection";
  }
  return "other";
};

// Atomically takes `count` from today's allowance; fails when the limit would be passed or the
// account is paused. Shared by all server instances through the database.
const reserveSenderQuota = async (sender, limit, count) => {
  const now = new Date();
  const paused = await EmailSenderUsage.findOne({ sender, blockedUntil: { $gt: now } })
    .select("blockedUntil blockedReason")
    .lean();
  if (paused) return { ok: false, reason: `paused until ${paused.blockedUntil.toISOString()} (${paused.blockedReason})` };
  try {
    const usage = await EmailSenderUsage.findOneAndUpdate(
      { sender, day: usageDay(), count: { $lte: Math.max(0, limit - count) } },
      { $inc: { count } },
      { upsert: true, new: true }
    ).lean();
    return { ok: true, count: usage.count };
  } catch (error) {
    if (error.code === 11000) return { ok: false, reason: `daily limit ${limit} reached` };
    throw error;
  }
};

const releaseSenderQuota = (sender, count) => EmailSenderUsage.updateOne(
  { sender, day: usageDay(), count: { $gte: count } },
  { $inc: { count: -count } }
).catch(() => {});

const pauseSender = (sender, kind, error, limit) => EmailSenderUsage.updateOne(
  { sender, day: usageDay() },
  {
    $set: {
      blockedUntil: new Date(Date.now() + (kind === "quota" ? QUOTA_PAUSE_MS : kind === "auth" ? AUTH_PAUSE_MS : CONNECTION_PAUSE_MS)),
      blockedReason: `${kind}: ${String(error?.message || "").slice(0, 200)}`,
    },
    ...(kind === "quota" ? { $max: { count: limit } } : {}),
  },
  { upsert: true }
).catch(() => {});

const runtimeConfigForProfile = (settings, profile, emailPass) => ({
  enabled: settings.enabled !== false,
  senderName: profile.senderName || settings.senderName || process.env.EMAIL_SENDER_NAME || "CIIS NETWORK",
  emailUser: profile.emailUser,
  emailPass,
  emailService: profile.emailService || "Gmail",
  emailHost: profile.emailHost || "",
  emailPort: Number(profile.emailPort || 465),
  emailSecure: profile.emailSecure !== false,
  replyTo: profile.replyTo || profile.emailUser,
  activeSenderProfileId: profile.profileId,
});

// buildMailOptions(config) returns nodemailer options for the chosen account (its from/replyTo).
// Resolves {info, config, mailOptions, profileId}; throws EMAIL_DISABLED, EMAIL_NOT_CONFIGURED,
// EMAIL_SENDERS_EXHAUSTED, or the provider error when the problem is not the sender account
// (for example a rejected recipient).
const sendMailWithRotation = async (buildMailOptions) => {
  const settings = await getSettingsDocument({ includeSecret: true });
  if (settings.enabled === false) {
    const error = new Error("Email service is disabled from Email Settings");
    error.code = "EMAIL_DISABLED";
    throw error;
  }

  let profiles = getProfilesFromSettings(settings)
    .map(profile => ({ ...profile, emailPass: decryptSecret(profile.encryptedEmailPass) }))
    .filter(profile => profile.emailUser && profile.emailPass);
  if (!profiles.length && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    profiles = [{
      ...normalizeSenderProfile({
        profileId: DEFAULT_PROFILE_ID,
        emailUser: process.env.EMAIL_USER,
        emailService: process.env.EMAIL_SERVICE || "Gmail",
        emailHost: process.env.EMAIL_HOST || "",
        emailPort: process.env.EMAIL_PORT || 465,
        emailSecure: process.env.EMAIL_SECURE ? process.env.EMAIL_SECURE === "true" : true,
        senderName: process.env.EMAIL_SENDER_NAME,
        replyTo: process.env.EMAIL_REPLY_TO,
      }),
      emailPass: process.env.EMAIL_PASS,
    }];
  }
  if (!profiles.length) {
    const error = new Error("Email service not configured");
    error.code = "EMAIL_NOT_CONFIGURED";
    throw error;
  }

  const activeId = settings.activeSenderProfileId;
  const start = Math.max(0, profiles.findIndex(profile => profile.profileId === activeId));
  const ordered = [...profiles.slice(start), ...profiles.slice(0, start)];
  const triedSenders = new Set();
  const skipped = [];
  let lastError = null;

  for (const profile of ordered) {
    // The same address listed twice shares one provider allowance.
    if (triedSenders.has(profile.emailUser)) continue;
    triedSenders.add(profile.emailUser);

    const config = runtimeConfigForProfile(settings, profile, profile.emailPass);
    const mailOptions = buildMailOptions(config);
    const recipients = countRecipients(mailOptions);
    const limit = getDailyLimit(profile);
    const reserved = await reserveSenderQuota(profile.emailUser, limit, recipients);
    if (!reserved.ok) {
      skipped.push(`${maskEmail(profile.emailUser)}: ${reserved.reason}`);
      continue;
    }

    try {
      const info = await getCachedTransporter(config).sendMail(mailOptions);
      if (profile.profileId !== activeId) {
        console.warn(`Email sending moved to ${maskEmail(profile.emailUser)} (${skipped.join("; ") || "previous account unavailable"})`);
        await EmailSettings.updateOne({ key: SETTINGS_KEY }, { $set: { activeSenderProfileId: profile.profileId } }).catch(() => {});
        cachedSettings = null;
      }
      return { info, config, mailOptions, profileId: profile.profileId };
    } catch (error) {
      lastError = error;
      const kind = classifySendError(error);
      if (kind === "other") {
        await releaseSenderQuota(profile.emailUser, recipients);
        throw error;
      }
      if (kind !== "quota") await releaseSenderQuota(profile.emailUser, recipients);
      await pauseSender(profile.emailUser, kind, error, limit);
      dropCachedTransporter(config);
      skipped.push(`${maskEmail(profile.emailUser)}: ${kind}`);
      console.warn(`Email sender ${maskEmail(profile.emailUser)} paused (${kind}): ${error.message}`);
    }
  }

  const error = new Error(`No email sender account is available (${skipped.join("; ")})${lastError ? `; last error: ${lastError.message}` : ""}`);
  error.code = "EMAIL_SENDERS_EXHAUSTED";
  throw error;
};

const assertEmailAccepted = (info, recipients, context = "Email") => {
  const accepted = Array.isArray(info?.accepted) ? info.accepted : [];
  const rejected = Array.isArray(info?.rejected) ? info.rejected : [];
  const pending = Array.isArray(info?.pending) ? info.pending : [];
  const recipientList = Array.isArray(recipients)
    ? recipients
    : String(recipients || "")
      .split(",")
      .map(item => item.trim())
      .filter(Boolean);

  if (rejected.length) {
    const error = new Error(`${context} rejected for: ${rejected.join(", ")}`);
    error.code = "EMAIL_REJECTED";
    error.emailInfo = { accepted, rejected, pending, response: info?.response, messageId: info?.messageId };
    throw error;
  }

  if (Array.isArray(info?.accepted) && recipientList.length && accepted.length === 0) {
    const error = new Error(`${context} was not accepted by SMTP server`);
    error.code = "EMAIL_NOT_ACCEPTED";
    error.emailInfo = { accepted, rejected, pending, response: info?.response, messageId: info?.messageId };
    throw error;
  }

  return { accepted, rejected, pending };
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
  return attachSenderUsage(sanitizeSettings(settings));
};

module.exports = {
  EMAIL_MODULES,
  classifySendError,
  getDailyLimit,
  sendMailWithRotation,
  usageDay,
  assertEmailAccepted,
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
