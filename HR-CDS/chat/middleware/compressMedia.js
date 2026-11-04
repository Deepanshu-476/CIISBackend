const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const sharp = require("sharp");

let ffmpegPath = null;
try {
  ffmpegPath = require("ffmpeg-static");
} catch {
  ffmpegPath = null;
}

const IMAGE_MAX_DIMENSION = 1600;
const IMAGE_QUALITY = 76;
const AUTO_COMPRESS_IMAGE_BYTES = 10 * 1024 * 1024;
const AUTO_COMPRESS_VIDEO_BYTES = 200 * 1024 * 1024;
const WEB_SAFE_IMAGE_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif", "image/avif"]);
const HEIC_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);
const IMAGE_EXTENSION_TYPES = {
  ".heic": "image/heic", ".heif": "image/heif", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif",
  ".bmp": "image/bmp", ".tif": "image/tiff", ".tiff": "image/tiff",
};

const isHd = req => String(req.body?.compressionMode || "normal").toLowerCase() === "hd";

// Some phones send HEIC/JPEG files as application/octet-stream; use the extension then.
const normalizeImageMimetype = file => {
  const type = String(file.mimetype || "").toLowerCase();
  if (type && type !== "application/octet-stream") return;
  const fromExtension = IMAGE_EXTENSION_TYPES[path.extname(file.originalname || file.path || "").toLowerCase()];
  if (fromExtension) file.mimetype = fromExtension;
};

// "hd" (the default of the current app and web) keeps photos and videos exactly
// as uploaded: same bytes, size and format. Only "normal" (older app builds)
// re-encodes. Audio is still normalised so every client can play it.
const shouldCompressFile = (req, file) => {
  if (!isHd(req)) return true;
  if (file.mimetype?.startsWith("image/")) return false;
  if (file.mimetype?.startsWith("video/")) return Number(file.size || 0) > AUTO_COMPRESS_VIDEO_BYTES;
  return false;
};

// Photos kept in original form that a browser cannot show (HEIC/TIFF/BMP) or that
// are very large get a small display-only copy. Download/save/share always use
// the original file; clients show `previewFile` only inside the chat.
const needsDisplayPreview = file => file.mimetype?.startsWith("image/")
  && file.mimetype !== "image/gif"
  && (!WEB_SAFE_IMAGE_TYPES.has(file.mimetype) || Number(file.size || 0) > AUTO_COMPRESS_IMAGE_BYTES);

const decodeHeic = async filePath => {
  const decode = require("heic-decode");
  const {width, height, data} = await decode({buffer: await fs.promises.readFile(filePath)});
  return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {raw: {width, height, channels: 4}});
};

const writePreview = (image, outputPath) => image
  .resize(IMAGE_MAX_DIMENSION, IMAGE_MAX_DIMENSION, {fit: "inside", withoutEnlargement: true})
  .webp({quality: 80})
  .toFile(outputPath);

const createDisplayPreview = async file => {
  const outputPath = previewPathFor(file.path);
  try {
    try {
      await writePreview(sharp(file.path, {failOn: "none"}).rotate(), outputPath);
    } catch (error) {
      // The sharp build reads AVIF but not HEVC-coded HEIC (iPhone photos); decode those in JS.
      if (!HEIC_TYPES.has(file.mimetype)) throw error;
      await writePreview(await decodeHeic(file.path), outputPath);
    }
    file.previewFilename = path.basename(outputPath);
  } catch (error) {
    removeQuietly(outputPath);
    console.warn("Chat image preview skipped:", error.message);
  }
};

const updateFile = (file, targetPath, mimetype) => {
  const stat = fs.statSync(targetPath);
  file.path = targetPath;
  file.destination = path.dirname(targetPath);
  file.filename = path.basename(targetPath);
  file.size = stat.size;
  file.mimetype = mimetype;
};

const removeQuietly = filePath => {
  if (!filePath) return;
  fs.promises.unlink(filePath).catch(() => { });
};

const previewPathFor = filePath => {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}-preview.webp`);
};

const compressedPathFor = (filePath, extension) => {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}-compressed${extension}`);
};

const compressImage = async file => {
  // Re-encoding an animated GIF as a single-frame image discards the animation.
  if (file.mimetype === "image/gif") return;
  const outputPath = compressedPathFor(file.path, ".webp");

  await sharp(file.path)
    .rotate()
    .resize(IMAGE_MAX_DIMENSION, IMAGE_MAX_DIMENSION, {
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: IMAGE_QUALITY })
    .toFile(outputPath);

  const originalSize = file.size || fs.statSync(file.path).size;
  const compressedSize = fs.statSync(outputPath).size;

  if (compressedSize < originalSize || !WEB_SAFE_IMAGE_TYPES.has(file.mimetype)) {
    removeQuietly(file.path);
    updateFile(file, outputPath, "image/webp");
  } else {
    removeQuietly(outputPath);
  }
};

const runFfmpeg = (args, timeoutMs = 120000) =>
  new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath || "ffmpeg", args, { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Video compression timed out"));
    }, timeoutMs);

    child.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", code => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`));
    });
  });

const compressVideo = async file => {
  const outputPath = compressedPathFor(file.path, ".mp4");

  await runFfmpeg([
    "-y",
    "-i",
    file.path,
    "-vf",
    "scale='min(1280,iw)':-2",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    outputPath,
  ]);

  const originalSize = file.size || fs.statSync(file.path).size;
  const compressedSize = fs.statSync(outputPath).size;

  if (compressedSize < originalSize || file.mimetype !== "video/mp4") {
    removeQuietly(file.path);
    updateFile(file, outputPath, "video/mp4");
  } else {
    removeQuietly(outputPath);
  }
};

const normalizeAudio = async file => {
  // MediaRecorder's WebM/Opus blobs may lack duration/seek metadata and are not
  // playable in every browser. AAC in an M4A container works across clients.
  if (["audio/mpeg", "audio/mp4", "audio/x-m4a"].includes(file.mimetype)) return;
  const outputPath = compressedPathFor(file.path, ".m4a");
  await runFfmpeg([
    "-y", "-i", file.path, "-vn", "-c:a", "aac", "-b:a", "96k",
    "-movflags", "+faststart", outputPath,
  ]);
  const originalPath = file.path;
  updateFile(file, outputPath, "audio/mp4");
  removeQuietly(originalPath);
};

const compressUploadedMedia = async (req, _res, next) => {
  const file = req.file;

  if (!file?.path) return next();
  normalizeImageMimetype(file);
  if (!shouldCompressFile(req, file)) {
    if (needsDisplayPreview(file)) await createDisplayPreview(file);
    return next();
  }

  try {
    if (file.mimetype?.startsWith("image/")) {
      await compressImage(file);
    } else if (file.mimetype?.startsWith("video/")) {
      await compressVideo(file);
    } else if (file.mimetype?.startsWith("audio/")) {
      await normalizeAudio(file);
    }
  } catch (error) {
    removeQuietly(compressedPathFor(file.path, ".webp"));
    removeQuietly(compressedPathFor(file.path, ".mp4"));
    removeQuietly(compressedPathFor(file.path, ".m4a"));
    console.warn("Chat media compression skipped:", error.message);
  }

  next();
};

module.exports = compressUploadedMedia;
