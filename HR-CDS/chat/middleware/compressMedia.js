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
  fs.promises.unlink(filePath).catch(() => {});
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

  if (compressedSize < originalSize || !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(file.mimetype)) {
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
