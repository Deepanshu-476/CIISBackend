const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const chatUploadDir = path.join(__dirname, "../../../uploads/chat");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = chatUploadDir;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, "").slice(0, 12);
    cb(null, `${randomUUID()}${extension}`);
  },
});

module.exports = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024, files: 1, fieldSize: 8 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/");
    cb(allowed ? null : new Error("Only image and video files are allowed"), allowed);
  },
});
