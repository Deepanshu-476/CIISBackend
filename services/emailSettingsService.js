const crypto = require("crypto");
const nodemailer = require("nodemailer");
const EmailSettings = require("../models/EmailSettings");

const SETTINGS_KEY = "global";
let cachedSettings = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5000;

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

const getSettingsDocument = async ({ includeSecret = false, fresh = false } = {}) => {
  const now = Date.now();
  if (
    !fresh &&
    cachedSettings &&
    now - cachedAt < CACHE_TTL_MS &&
    (!includeSecret || cachedSettings.encryptedEmailPass !== undefined)
  ) {
    return cachedSettings;
  }

  const query = EmailSettings.findOne({ key: SETTINGS_KEY });
  if (includeSecret) query.select("+encryptedEmailPass");
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
    });
    if (includeSecret) {
      settings = await EmailSettings.findOne({ key: SETTINGS_KEY }).select("+encryptedEmailPass");
    }
  }

  cachedSettings = settings;
  cachedAt = now;
  return settings;
};

const clearEmailSettingsCache = () => {
  cachedSettings = null;
  cachedAt = 0;
};

const sanitizeSettings = (settings) => {
  const decryptedPass = decryptSecret(settings.encryptedEmailPass);
  return {
    id: settings._id,
    enabled: settings.enabled,
    senderName: settings.senderName,
    emailUser: settings.emailUser,
    maskedEmailUser: maskEmail(settings.emailUser),
    hasPassword: Boolean(decryptedPass),
    maskedPassword: maskSecret(decryptedPass),
    emailService: settings.emailService,
    emailHost: settings.emailHost,
    emailPort: settings.emailPort,
    emailSecure: settings.emailSecure,
    replyTo: settings.replyTo,
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
  const updates = {
    enabled: payload.enabled !== undefined ? Boolean(payload.enabled) : current.enabled,
    senderName: String(payload.senderName || current.senderName || "CIIS NETWORK").trim(),
    emailUser: String(payload.emailUser || "").trim().toLowerCase(),
    emailService: String(payload.emailService || "Gmail").trim(),
    emailHost: String(payload.emailHost || "").trim(),
    emailPort: Number(payload.emailPort || 465),
    emailSecure: Boolean(payload.emailSecure),
    replyTo: String(payload.replyTo || payload.emailUser || "").trim().toLowerCase(),
    updatedBy: updatedBy || null,
  };

  if (updates.enabled && !updates.emailUser) {
    throw new Error("Sender email is required");
  }

  if (!Number.isFinite(updates.emailPort) || updates.emailPort < 1 || updates.emailPort > 65535) {
    throw new Error("SMTP port must be between 1 and 65535");
  }

  if (payload.emailPass) {
    updates.encryptedEmailPass = encryptSecret(payload.emailPass);
  }

  const settings = await EmailSettings.findOneAndUpdate(
    { key: SETTINGS_KEY },
    updates,
    { new: true, runValidators: true, upsert: true, setDefaultsOnInsert: true }
  ).select("+encryptedEmailPass");

  clearEmailSettingsCache();
  return sanitizeSettings(settings);
};

const getEmailRuntimeConfig = async () => {
  const settings = await getSettingsDocument({ includeSecret: true });
  const emailPass = decryptSecret(settings.encryptedEmailPass) || process.env.EMAIL_PASS || "";
  const emailUser = settings.emailUser || process.env.EMAIL_USER || "";

  return {
    enabled: settings.enabled !== false,
    senderName: settings.senderName || process.env.EMAIL_SENDER_NAME || "CIIS NETWORK",
    emailUser,
    emailPass,
    emailService: settings.emailService || process.env.EMAIL_SERVICE || "Gmail",
    emailHost: settings.emailHost || process.env.EMAIL_HOST || "",
    emailPort: Number(settings.emailPort || process.env.EMAIL_PORT || 465),
    emailSecure: settings.emailSecure !== undefined
      ? settings.emailSecure
      : process.env.EMAIL_SECURE === "true",
    replyTo: settings.replyTo || process.env.EMAIL_REPLY_TO || emailUser,
  };
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
  ).select("+encryptedEmailPass");
  clearEmailSettingsCache();
  return sanitizeSettings(settings);
};

module.exports = {
  createEmailTransporter,
  getEmailRuntimeConfig,
  getPublicEmailSettings,
  updateEmailSettings,
  markEmailTestResult,
  clearEmailSettingsCache,
};
