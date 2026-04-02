const express = require("express");
const multer = require("multer");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { v4: uuidv4 } = require("uuid");
const path = require("path");
const { adminAuth } = require("../middleware/auth");

const router = express.Router();

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const EXT_MAP = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPG, PNG, WebP and GIF images are allowed"));
    }
  },
});

const BUCKET = process.env.S3_IMAGES_BUCKET;
const REGION = process.env.S3_IMAGES_REGION || "eu-west-1";

// POST /api/uploads/image
router.post("/image", adminAuth, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file provided" });
    }
    if (!BUCKET) {
      return res.status(500).json({ message: "S3_IMAGES_BUCKET not configured" });
    }

    const ext = EXT_MAP[req.file.mimetype] || ".jpg";
    const key = `markets/${uuidv4()}${ext}`;

    const s3 = new S3Client({ region: REGION });
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      })
    );

    const url = `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key}`;
    res.json({ url });
  } catch (err) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ message: "File exceeds 2MB limit" });
    }
    console.error("[uploads] image upload error:", err?.message || err);
    res.status(500).json({ message: "Upload failed" });
  }
});

// multer error handler
router.use((err, _req, res, _next) => {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ message: "File exceeds 2MB limit" });
  }
  res.status(400).json({ message: err?.message || "Upload error" });
});

module.exports = router;
