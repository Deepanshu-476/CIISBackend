const multer = require("multer");
const fs = require("fs");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = "uploads/chat";
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

module.exports = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/");
    cb(allowed ? null : new Error("Only image and video files are allowed"), allowed);
  },
});
