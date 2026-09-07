const multer = require("multer");
const fs = require("fs");
const path = require("path");
const {randomUUID} = require("crypto");

const chatUploadDir = path.join(__dirname, "../../../uploads/chat");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(chatUploadDir)) fs.mkdirSync(chatUploadDir, { recursive: true });
    cb(null, chatUploadDir);
  },
  filename: (_req, file, cb) => {
    // A generated basename keeps spaces, URL fragments and platform path
    // characters in the original filename from breaking attachment URLs.
    const extension = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, "");
    cb(null, `${randomUUID()}${extension.slice(0, 16)}`);
  },
});

module.exports = multer({ storage, limits: {fileSize: 100 * 1024 * 1024, files: 1} });
