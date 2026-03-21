import fs from "node:fs";
import path from "node:path";
import { createError, getQuery, sendStream, setHeader } from "h3";
import { importProjectRootMediaFiles } from "~/server/utils/media-files";
import { ensureMediaFolder, readSettings } from "~/server/utils/settings";

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".m4v": "video/x-m4v",
};

export default defineEventHandler((event) => {
  const query = getQuery(event);
  const raw = String(query.file || "").trim();
  const file = path.basename(raw);

  if (!file) {
    throw createError({
      statusCode: 400,
      statusMessage: "Pass file in query",
    });
  }

  const settings = readSettings();
  const mediaFolder = ensureMediaFolder(settings);
  importProjectRootMediaFiles(settings, mediaFolder);
  const fullPath = path.join(mediaFolder, file);

  if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
    throw createError({
      statusCode: 404,
      statusMessage: "File not found",
    });
  }

  const ext = path.extname(file).toLowerCase();
  setHeader(event, "Cache-Control", "public, max-age=3600");
  setHeader(
    event,
    "Content-Type",
    MIME_MAP[ext] || "application/octet-stream"
  );

  return sendStream(
    event,
    fs.createReadStream(fullPath) as unknown as ReadableStream
  );
});
