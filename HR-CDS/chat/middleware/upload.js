const multer = require("multer");
const fs = require("fs");
const path = require("path");

const chatUploadDir = path.join(__dirname, "../../../uploads/chat");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    if (!fs.existsSync(chatUploadDir)) fs.mkdirSync(chatUploadDir, { recursive: true });
    cb(null, chatUploadDir);
  },
  filename: (_req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

module.exports = multer({ storage });
