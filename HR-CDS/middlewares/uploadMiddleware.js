const multer = require("multer");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");


const pdfUploadDir = "uploads/pdfs";
const taskUploadDir = "uploads/tasks";
const remarksUploadDir = "uploads/remarks";

if (!fs.existsSync(pdfUploadDir)) fs.mkdirSync(pdfUploadDir, { recursive: true });
if (!fs.existsSync(taskUploadDir)) fs.mkdirSync(taskUploadDir, { recursive: true });
if (!fs.existsSync(remarksUploadDir)) fs.mkdirSync(remarksUploadDir, { recursive: true });


const pdfStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, pdfUploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});


const taskStorage = multer.memoryStorage();


const remarksStorage = multer.memoryStorage();


const uploadPDF = multer({
  storage: pdfStorage,
  fileFilter: (req, file, cb) => {
    const allowed = ["application/pdf"];
    if (!allowed.includes(file.mimetype)) return cb(new Error("Only PDF files allowed"));
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});


const uploadTaskImage = multer({
  storage: taskStorage,
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/jpg"];
    if (!allowed.includes(file.mimetype)) return cb(new Error("Only JPG, PNG, JPEG images are allowed"));
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
}).single("image");


const remarkMulter = multer({
  storage: remarksStorage,
  fileFilter: (req, file, cb) => {
    const mime = (file.mimetype || "").toLowerCase();
    const ext = path.extname(file.originalname || "").toLowerCase();
    const allowedExts = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif"];
    if (mime.startsWith("image/") || allowedExts.includes(ext)) {
      return cb(null, true);
    }
    return cb(new Error("Only image files are allowed (JPG, PNG, JPEG, GIF, WEBP, HEIC)"));
  },
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
}).single("image");

const uploadRemarkImage = (req, res, next) => {
  remarkMulter(req, res, (err) => {
    if (err) {
      console.error("Remark image upload error:", err);
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ success: false, message: "Image size exceeds 25MB limit." });
      }
      return res.status(400).json({ success: false, message: err.message || "Image upload failed" });
    }
    next();
  });
}; 

module.exports = {
  uploadPDF,
  uploadTaskImage,
  uploadRemarkImage 
};