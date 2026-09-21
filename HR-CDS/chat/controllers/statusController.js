const mongoose = require("mongoose");
const fs = require("fs");
const Status = require("../models/Status");

const userId = req => req.user._id || req.user.id;
const publicFileUrl = req => req.file
  ? `/api/uploads/chat/${encodeURIComponent(req.file.filename)}`
  : "";
const discardUpload = req => {
  if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {});
};
const hasCompany = (req, res) => {
  if (req.user.company) return true;
  discardUpload(req);
  res.status(403).json({ success: false, message: "A company account is required for statuses" });
  return false;
};
const validStatusId = (req, res) => {
  if (mongoose.isValidObjectId(req.params.statusId)) return true;
  res.status(400).json({ success: false, message: "Invalid status ID" });
  return false;
};

const serialize = (status, viewerId) => {
  const value = status.toObject ? status.toObject() : status;
  const owner = value.userId || {};
  const isOwn = String(owner._id || owner) === String(viewerId);
  const viewers = new Set((value.viewedBy || []).map(view => String(view.userId)));
  return {
    id: value._id,
    type: value.type,
    text: value.text,
    mediaUrl: value.mediaUrl,
    mimeType: value.mimeType,
    backgroundColor: value.backgroundColor || "#256c62",
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    viewed: viewers.has(String(viewerId)),
    isOwn,
    ...(isOwn ? { viewCount: viewers.size } : {}),
    user: {
      id: owner._id || owner,
      name: owner.name || "User",
      avatar: owner.profileImage || owner.avatar || owner.image || owner.photo || "",
      profileImage: owner.profileImage || owner.avatar || owner.image || owner.photo || "",
    },
  };
};

exports.getStatuses = async (req, res) => {
  if (!hasCompany(req, res)) return;
  try {
    const statuses = await Status.find({
      companyId: req.user.company,
      expiresAt: { $gt: new Date() },
    })
      .populate("userId", "name profileImage avatar image photo")
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ success: true, statuses: statuses.filter(item => item.userId).map(item => serialize(item, userId(req))) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.createStatus = async (req, res) => {
  if (!hasCompany(req, res)) return;
  try {
    const text = String(req.body.text || "").trim();
    const mimeType = req.file?.mimetype || "";
    const backgroundColor = String(req.body.backgroundColor || "#256c62");
    let validationError = "";
    if (req.file && !mimeType.startsWith("image/") && !mimeType.startsWith("video/")) {
      validationError = "Only image and video statuses are allowed";
    } else if (!req.file && !text) {
      validationError = "Add text, photo or video";
    } else if (text.length > 500) {
      validationError = "Status text must be 500 characters or fewer";
    } else if (!/^#[0-9a-f]{6}$/i.test(backgroundColor)) {
      validationError = "Choose a valid status background color";
    }
    if (validationError) {
      discardUpload(req);
      return res.status(400).json({ success: false, message: validationError });
    }
    const status = await Status.create({
      companyId: req.user.company,
      userId: userId(req),
      type: req.file ? (mimeType.startsWith("video/") ? "video" : "image") : "text",
      text,
      mediaUrl: publicFileUrl(req),
      mimeType,
      backgroundColor,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    await status.populate("userId", "name profileImage avatar image photo");
    global.io?.to(`company:${req.user.company}`).emit("chat:status-update");
    return res.status(201).json({ success: true, status: serialize(status, userId(req)) });
  } catch (error) {
    discardUpload(req);
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.markViewed = async (req, res) => {
  if (!hasCompany(req, res) || !validStatusId(req, res)) return;
  try {
    const scope = {
      _id: req.params.statusId,
      companyId: req.user.company,
      expiresAt: { $gt: new Date() },
    };
    const status = await Status.findOne(scope);
    if (!status) return res.status(404).json({ success: false, message: "Status not found" });
    if (String(status.userId) !== String(userId(req))) {
      // Conditional atomic update keeps concurrent tabs from counting one viewer twice.
      const result = await Status.updateOne({
        ...scope,
        "viewedBy.userId": { $ne: userId(req) },
      }, { $push: { viewedBy: { userId: userId(req), viewedAt: new Date() } } });
      if (result.modifiedCount) {
        global.io?.to(`user:${status.userId}`).emit("chat:status-views", { statusId: status._id });
        global.io?.to(`user:${userId(req)}`).emit("chat:status-update");
      }
    }
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteStatus = async (req, res) => {
  if (!hasCompany(req, res) || !validStatusId(req, res)) return;
  try {
    const status = await Status.findOneAndDelete({
      _id: req.params.statusId,
      companyId: req.user.company,
      userId: userId(req),
    });
    if (!status) return res.status(404).json({ success: false, message: "Status not found" });
    global.io?.to(`company:${req.user.company}`).emit("chat:status-update");
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
