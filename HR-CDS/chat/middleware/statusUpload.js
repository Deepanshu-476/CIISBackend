const multer = require("multer");
const fs = require("fs");
const path = require("path");

const chatUploadDir = path.join(__dirname, "../../../uploads/chat");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = chatUploadDir;
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

module.exports = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const allowed = file.mimetype.startsWith("image/") || file.mimetype.startsWith("video/");
    cb(allowed ? null : new Error("Only image and video files are allowed"), allowed);
  },
});
