const multer = require("multer");
const path = require("path");
const fs = require("fs");
const sharp = require("sharp");

// Ensure the upload folders exist
const pdfUploadDir = "uploads/pdfs";
const taskUploadDir = "uploads/tasks";
const remarksUploadDir = "uploads/remarks";

if (!fs.existsSync(pdfUploadDir)) fs.mkdirSync(pdfUploadDir, { recursive: true });
if (!fs.existsSync(taskUploadDir)) fs.mkdirSync(taskUploadDir, { recursive: true });
if (!fs.existsSync(remarksUploadDir)) fs.mkdirSync(remarksUploadDir, { recursive: true });

// PDF Multer setup
const pdfStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, pdfUploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

// Task image Multer setup
const taskStorage = multer.memoryStorage();

// Remarks image Multer setup
const remarksStorage = multer.memoryStorage();

// Upload middleware for PDFs
const uploadPDF = multer({
  storage: pdfStorage,
  fileFilter: (req, file, cb) => {
    const allowed = ["application/pdf"];
    if (!allowed.includes(file.mimetype)) return cb(new Error("Only PDF files allowed"));
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Upload middleware for Task images
const uploadTaskImage = multer({
  storage: taskStorage,
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/jpg"];
    if (!allowed.includes(file.mimetype)) return cb(new Error("Only JPG, PNG, JPEG images are allowed"));
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
}).single("image");

// Upload middleware for Remarks images - NEW
const uploadRemarkImage = multer({
  storage: remarksStorage,
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/jpg", "image/gif", "image/webp"];
    if (!allowed.includes(file.mimetype)) return cb(new Error("Only image files are allowed (JPG, PNG, JPEG, GIF, WEBP)"));
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
}).single("image"); // Single image for remarks

module.exports = {
  uploadPDF,
  uploadTaskImage,
  uploadRemarkImage // Export the new middleware
};