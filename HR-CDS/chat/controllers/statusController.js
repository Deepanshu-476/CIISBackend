const Status = require("../models/Status");

const userId = req => req.user._id || req.user.id;
const publicFileUrl = req => req.file
  ? `${req.protocol}://${req.get("host")}/api/uploads/chat/${req.file.filename}`
  : "";

const serialize = (status, viewerId) => {
  const value = status.toObject ? status.toObject() : status;
  const owner = value.userId || {};
  return {
    id: value._id,
    type: value.type,
    text: value.text,
    mediaUrl: value.mediaUrl,
    mimeType: value.mimeType,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    viewed: (value.viewedBy || []).some(view => String(view.userId) === String(viewerId)),
    isOwn: String(owner._id || owner) === String(viewerId),
    user: {
      id: owner._id || owner,
      name: owner.name || "User",
      avatar: owner.profileImage || "",
    },
  };
};

exports.getStatuses = async (req, res) => {
  try {
    const now = new Date();
    const statuses = await Status.find({
      companyId: req.user.company,
      expiresAt: { $gt: now },
    })
      .populate("userId", "name profileImage")
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ success: true, statuses: statuses.map(item => serialize(item, userId(req))) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.createStatus = async (req, res) => {
  try {
    const text = String(req.body.text || "").trim();
    const mimeType = req.file?.mimetype || "";
    if (req.file && !mimeType.startsWith("image/") && !mimeType.startsWith("video/")) {
      return res.status(400).json({ success: false, message: "Only image and video statuses are allowed" });
    }
    const type = req.file
      ? (mimeType.startsWith("video/") ? "video" : "image")
      : "text";
    if (!req.file && !text) {
      return res.status(400).json({ success: false, message: "Add text, photo or video" });
    }
    const status = await Status.create({
      companyId: req.user.company,
      userId: userId(req),
      type,
      text,
      mediaUrl: publicFileUrl(req),
      mimeType,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    await status.populate("userId", "name profileImage");
    global.io?.to(`company:${req.user.company}`).emit("chat:status-update");
    return res.status(201).json({ success: true, status: serialize(status, userId(req)) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.markViewed = async (req, res) => {
  try {
    const status = await Status.findOne({
      _id: req.params.statusId,
      companyId: req.user.company,
      expiresAt: { $gt: new Date() },
    });
    if (!status) return res.status(404).json({ success: false, message: "Status not found" });
    if (String(status.userId) !== String(userId(req)) &&
        !status.viewedBy.some(view => String(view.userId) === String(userId(req)))) {
      status.viewedBy.push({ userId: userId(req) });
      await status.save();
    }
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

exports.deleteStatus = async (req, res) => {
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
