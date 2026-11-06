const express = require("express");
const mongoose = require("mongoose");
const Promo = require("../../models/Promo");
const Company = require("../../models/Company");
const User = require("../../models/User");
const SidebarConfig = require("../../models/SidebarConfig");
const { protect, isPlatformOwner, isSuperAdminUser } = require("../../middleware/authMiddleware");
const { promoUpload, promoFileUrl, removePromoFile } = require("../middlewares/promoUpload");
const { sendPushToUsers } = require("../utils/firebasePushService");

// Promotions: image/video carousels.
//   Super Admin page  (scope "platform", platform owner only): before login for everyone,
//                     or after login for all / chosen companies.
//   Company page      (scope "company", owner or anyone given /ciisUser/promotions in
//                     Sidebar Management): after login, own company only.
// Push notifications can go out with a promotion or on their own, to the same audience.
const router = express.Router();
const PAGE_PATH = "/ciisUser/promotions";
const OWNER_COMPANY_ROLES = new Set(["owner", "company_owner", "companyowner"]);

const normalize = (value) => String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "_");
const idOf = (value) => String(value?._id || value || "");
const isObjectId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseBool = (value) => value === true || value === "true" || value === "1";
const parseIdList = (value) => {
  if (Array.isArray(value)) return value.map(String).filter(isObjectId);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(isObjectId) : [];
  } catch {
    return String(value).split(",").map((item) => item.trim()).filter(isObjectId);
  }
};
const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const liveFilter = (now = new Date()) => ({
  isActive: true,
  endAt: { $gte: now },
  $or: [{ startAt: null }, { startAt: { $lte: now } }],
});

const mediaFromFiles = (files = []) => files.map((file) => ({
  url: promoFileUrl(file.filename),
  type: String(file.mimetype || "").startsWith("video/") ? "video" : "image",
  name: String(file.originalname || "").slice(0, 200),
  size: file.size || 0,
}));
const dropUploaded = (files = []) => files.forEach((file) => removePromoFile(promoFileUrl(file.filename)));

const statusOf = (promo, now = new Date()) => {
  if (!promo.isActive) return "paused";
  if (promo.endAt && new Date(promo.endAt) < now) return "expired";
  if (promo.startAt && new Date(promo.startAt) > now) return "scheduled";
  return "live";
};

// What viewers need (no creator details, no notify history).
const viewerShape = (promo) => ({
  _id: promo._id,
  title: promo.title,
  message: promo.message,
  media: (promo.media || []).map(({ _id, url, type, name }) => ({ _id, url, type, name })),
  endAt: promo.endAt,
  updatedAt: promo.updatedAt,
});

// ---------- who may manage ----------
const canManageCompanyPromos = async (user) => {
  if (!user?.company) return false;
  if (isSuperAdminUser(user) || OWNER_COMPANY_ROLES.has(normalize(user.companyRole))) return true;
  const departmentId = idOf(user.department);
  if (!isObjectId(departmentId)) return false;
  const roles = [...new Set([user.jobRole, user.jobRoleName, user.companyRole, user.role, idOf(user.jobRoleId)]
    .filter(Boolean).map(String))];
  const config = await SidebarConfig.findOne({
    companyId: idOf(user.company),
    departmentId,
    isActive: { $ne: false },
    role: { $in: roles.map((role) => new RegExp(`^${escapeRegex(role)}$`, "i")) },
    menuItems: { $elemMatch: { $or: [{ path: PAGE_PATH }, { id: "promotions" }] } },
  }).select("_id").lean();
  return Boolean(config);
};

// Sets req.promoScope ("platform" | "company") after checking the caller may manage it.
// Upload routes run this before multer, so clients pass ?scope= in the URL.
const requireManage = async (req, res, next) => {
  try {
    const scope = String(req.query.scope || req.body?.scope || "company");
    if (scope === "platform") {
      if (!isPlatformOwner(req.user)) return res.status(403).json({ success: false, message: "Only the platform owner can manage these promotions." });
    } else if (scope === "company") {
      if (!(await canManageCompanyPromos(req.user))) return res.status(403).json({ success: false, message: "You do not have access to Promotions." });
    } else {
      return res.status(400).json({ success: false, message: "Invalid scope" });
    }
    req.promoScope = scope;
    return next();
  } catch (error) {
    return next(error);
  }
};

// Loads a promotion the caller may change (same scope; company promos of own company only).
const loadOwnPromo = async (req, res) => {
  if (!isObjectId(req.params.id)) {
    res.status(404).json({ success: false, message: "Promotion not found" });
    return null;
  }
  const filter = { _id: req.params.id, scope: req.promoScope };
  if (req.promoScope === "company") filter.company = idOf(req.user.company);
  const promo = await Promo.findOne(filter);
  if (!promo) res.status(404).json({ success: false, message: "Promotion not found" });
  return promo;
};

// ---------- audience and push ----------
const audienceUserIds = async ({ scope, allCompanies, companyIds, company }) => {
  const filter = { isActive: true };
  if (scope === "company") filter.company = idOf(company);
  else if (!allCompanies) filter.company = { $in: (companyIds || []).map(idOf) };
  else filter.company = { $ne: null };
  const users = await User.find(filter).select("_id").lean();
  return users.map((user) => String(user._id));
};

const sendAudiencePush = async ({ scope, allCompanies, companyIds, company, title, body, promoId }) => {
  const userIds = await audienceUserIds({ scope, allCompanies, companyIds, company });
  if (!userIds.length) return { users: 0, sent: 0, reason: "no-users" };
  const result = await sendPushToUsers({
    userIds,
    title: title || "New update",
    body: body || "",
    data: { type: "promotion", ...(promoId ? { promoId: String(promoId) } : {}) },
  });
  return { users: userIds.length, sent: result?.sent || 0, ...(result?.reason ? { reason: result.reason } : {}) };
};

// Reads and checks the audience fields of a create/update/notify request.
const readAudience = (req, existing) => {
  if (req.promoScope === "company") {
    return { audience: "companies", allCompanies: false, companyIds: [], company: idOf(req.user.company) };
  }
  const audience = req.body.audience || existing?.audience;
  if (!["public", "companies"].includes(audience)) return { error: "Choose who sees it: before login or after login" };
  if (audience === "public") return { audience, allCompanies: false, companyIds: [] };
  const allCompanies = req.body.allCompanies !== undefined ? parseBool(req.body.allCompanies) : Boolean(existing?.allCompanies);
  const companyIds = req.body.companyIds !== undefined ? parseIdList(req.body.companyIds) : (existing?.companyIds || []).map(idOf);
  if (!allCompanies && !companyIds.length) return { error: "Select at least one company" };
  return { audience, allCompanies, companyIds };
};

// ---------- public / viewer ----------
// Before login: platform promotions for everyone (login screens).
router.get("/public", async (_req, res, next) => {
  try {
    const promos = await Promo.find({ scope: "platform", audience: "public", ...liveFilter() })
      .sort({ updatedAt: -1 }).limit(20).lean();
    res.set("Cache-Control", "public, max-age=60");
    res.json({ success: true, promos: promos.map(viewerShape) });
  } catch (error) {
    next(error);
  }
});

router.use(protect);

// After login: platform promotions for this company + the company's own promotions.
router.get("/feed", async (req, res, next) => {
  try {
    const companyId = idOf(req.user.company);
    if (!isObjectId(companyId)) return res.json({ success: true, promos: [] });
    const promos = await Promo.find({
      ...liveFilter(),
      $and: [{
        $or: [
          { scope: "platform", audience: "companies", allCompanies: true },
          { scope: "platform", audience: "companies", companyIds: companyId },
          { scope: "company", company: companyId },
        ],
      }],
    }).sort({ updatedAt: -1 }).limit(20).lean();
    res.json({ success: true, promos: promos.map(viewerShape) });
  } catch (error) {
    next(error);
  }
});

// Can this user open the company Promotions page? (used by the sidebar/screen guard)
router.get("/access", async (req, res, next) => {
  try {
    res.json({
      success: true,
      company: await canManageCompanyPromos(req.user),
      platform: isPlatformOwner(req.user),
    });
  } catch (error) {
    next(error);
  }
});

// ---------- manage ----------
// Company picker for the Super Admin page.
router.get("/companies", async (req, res, next) => {
  try {
    if (!isPlatformOwner(req.user)) return res.status(403).json({ success: false, message: "Only the platform owner can see all companies." });
    const companies = await Company.find({}).select("companyName companyCode isActive").sort({ companyName: 1 }).lean();
    res.json({ success: true, companies: companies.map((c) => ({ _id: c._id, companyName: c.companyName, companyCode: c.companyCode, isActive: c.isActive !== false })) });
  } catch (error) {
    next(error);
  }
});

router.get("/manage", requireManage, async (req, res, next) => {
  try {
    const filter = { scope: req.promoScope };
    if (req.promoScope === "company") filter.company = idOf(req.user.company);
    const promos = await Promo.find(filter).sort({ createdAt: -1 }).limit(200)
      .populate("companyIds", "companyName companyCode").populate("createdBy", "name").lean();
    const now = new Date();
    res.json({ success: true, promos: promos.map((promo) => ({ ...promo, status: statusOf(promo, now) })) });
  } catch (error) {
    next(error);
  }
});

router.post("/manage", requireManage, promoUpload, async (req, res, next) => {
  const files = req.files || [];
  try {
    const audience = readAudience(req);
    const endAt = parseDate(req.body.endAt);
    const startAt = parseDate(req.body.startAt) || new Date();
    const problem = audience.error
      || (!files.length && "Add at least one image or video")
      || (!endAt && "Choose the date until which it shows")
      || (endAt <= new Date() && "The end date must be in the future")
      || (endAt <= startAt && "The end date must be after the start date");
    if (problem) {
      dropUploaded(files);
      return res.status(400).json({ success: false, message: problem });
    }
    const promo = await Promo.create({
      scope: req.promoScope,
      audience: audience.audience,
      allCompanies: audience.allCompanies,
      companyIds: audience.companyIds,
      company: req.promoScope === "company" ? audience.company : undefined,
      title: String(req.body.title || "").trim().slice(0, 120),
      message: String(req.body.message || "").trim().slice(0, 1000),
      media: mediaFromFiles(files),
      startAt,
      endAt,
      createdBy: req.user._id,
    });

    let notify = null;
    if (parseBool(req.body.notify)) {
      notify = await sendAudiencePush({
        scope: promo.scope,
        allCompanies: promo.audience === "public" ? true : promo.allCompanies,
        companyIds: promo.companyIds,
        company: promo.company,
        title: promo.title || "New update",
        body: promo.message,
        promoId: promo._id,
      });
      promo.lastNotifiedAt = new Date();
      promo.lastNotifyResult = notify;
      await promo.save();
    }
    res.status(201).json({ success: true, promo, notify });
  } catch (error) {
    dropUploaded(files);
    next(error);
  }
});

router.put("/manage/:id", requireManage, promoUpload, async (req, res, next) => {
  const files = req.files || [];
  try {
    const promo = await loadOwnPromo(req, res);
    if (!promo) return dropUploaded(files);
    const audience = readAudience(req, promo);
    const removeIds = new Set(parseIdList(req.body.removeMediaIds));
    const kept = (promo.media || []).filter((item) => !removeIds.has(String(item._id)));
    const media = [...kept, ...mediaFromFiles(files)];
    const endAt = req.body.endAt !== undefined ? parseDate(req.body.endAt) : promo.endAt;
    const startAt = req.body.startAt !== undefined ? (parseDate(req.body.startAt) || promo.startAt) : promo.startAt;
    const problem = audience.error
      || (!media.length && "Keep at least one image or video")
      || (!endAt && "Choose the date until which it shows")
      || (startAt && endAt <= startAt && "The end date must be after the start date");
    if (problem) {
      dropUploaded(files);
      return res.status(400).json({ success: false, message: problem });
    }
    const removed = (promo.media || []).filter((item) => removeIds.has(String(item._id)));
    Object.assign(promo, {
      audience: audience.audience,
      allCompanies: audience.allCompanies,
      companyIds: audience.companyIds,
      media,
      startAt,
      endAt,
    });
    if (req.body.title !== undefined) promo.title = String(req.body.title || "").trim().slice(0, 120);
    if (req.body.message !== undefined) promo.message = String(req.body.message || "").trim().slice(0, 1000);
    if (req.body.isActive !== undefined) promo.isActive = parseBool(req.body.isActive);
    await promo.save();
    removed.forEach((item) => removePromoFile(item.url));
    res.json({ success: true, promo });
  } catch (error) {
    dropUploaded(files);
    next(error);
  }
});

router.delete("/manage/:id", requireManage, async (req, res, next) => {
  try {
    const promo = await loadOwnPromo(req, res);
    if (!promo) return undefined;
    await promo.deleteOne();
    (promo.media || []).forEach((item) => removePromoFile(item.url));
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Push for an existing promotion (same audience; "before login" ones go to every company).
router.post("/manage/:id/notify", requireManage, async (req, res, next) => {
  try {
    const promo = await loadOwnPromo(req, res);
    if (!promo) return undefined;
    const title = String(req.body.title || promo.title || "New update").trim().slice(0, 120);
    const body = String(req.body.body ?? promo.message ?? "").trim().slice(0, 500);
    const notify = await sendAudiencePush({
      scope: promo.scope,
      allCompanies: promo.audience === "public" ? true : promo.allCompanies,
      companyIds: promo.companyIds,
      company: promo.company,
      title,
      body,
      promoId: promo._id,
    });
    promo.lastNotifiedAt = new Date();
    promo.lastNotifyResult = notify;
    await promo.save();
    res.json({ success: true, notify });
  } catch (error) {
    next(error);
  }
});

// Push on its own, without a promotion.
router.post("/notify", requireManage, async (req, res, next) => {
  try {
    const title = String(req.body.title || "").trim().slice(0, 120);
    const body = String(req.body.body || "").trim().slice(0, 500);
    if (!title || !body) return res.status(400).json({ success: false, message: "Title and message are required" });
    const audience = req.promoScope === "company"
      ? { company: idOf(req.user.company) }
      : { allCompanies: parseBool(req.body.allCompanies), companyIds: parseIdList(req.body.companyIds) };
    if (req.promoScope === "platform" && !audience.allCompanies && !audience.companyIds.length) {
      return res.status(400).json({ success: false, message: "Select at least one company" });
    }
    const notify = await sendAudiencePush({ scope: req.promoScope, ...audience, title, body });
    res.json({ success: true, notify });
  } catch (error) {
    next(error);
  }
});

router.use((error, _req, res, _next) => {
  console.error("[promotions] request failed:", error);
  res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Something went wrong" });
});

module.exports = router;
