const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

// Promotion media (carousel images/videos). Served publicly at /api/uploads/promos/<file>,
// because public promotions are shown on the login screens before anyone signs in.
const promoUploadDir = path.join(__dirname, "../../uploads/promos");
const MAX_FILES = 10;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(promoUploadDir)) fs.mkdirSync(promoUploadDir, { recursive: true });
    cb(null, promoUploadDir);
  },
  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12);
    cb(null, `${randomUUID()}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024, files: MAX_FILES, fieldSize: 64 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /^(image|video)\//.test(file.mimetype || "");
    cb(allowed ? null : Object.assign(new Error("Only image and video files are allowed"), { status: 400 }), allowed);
  },
});

// Multer errors become a JSON 400/413 instead of an HTML error page.
const promoUpload = (req, res, next) => upload.array("media", MAX_FILES)(req, res, (error) => {
  if (!error) return next();
  const tooBig = error.code === "LIMIT_FILE_SIZE";
  const tooMany = error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE";
  return res.status(tooBig ? 413 : 400).json({
    success: false,
    message: tooBig ? "Each file must be 200 MB or smaller" : tooMany ? `Up to ${MAX_FILES} files at a time` : error.message,
  });
});

const promoFileUrl = (filename) => `/api/uploads/promos/${encodeURIComponent(filename)}`;

// Deletes a promo file from disk given its public URL (ignores anything outside the folder).
const removePromoFile = (url) => {
  const name = decodeURIComponent(String(url || "").split("/api/uploads/promos/")[1] || "");
  if (!name || name.includes("/") || name.includes("..")) return;
  fs.promises.unlink(path.join(promoUploadDir, name)).catch(() => {});
};

module.exports = { promoUpload, promoFileUrl, removePromoFile, MAX_FILES };
