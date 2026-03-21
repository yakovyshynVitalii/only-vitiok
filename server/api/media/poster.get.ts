import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createError, getQuery, sendStream, setHeader } from "h3";
import { importProjectRootMediaFiles } from "~/server/utils/media-files";
import { ensureMediaFolder, readSettings } from "~/server/utils/settings";

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
  ".m4v",
]);

function hasFfmpeg() {
  const check = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  return check.status === 0;
}

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

  const ext = path.extname(file).toLowerCase();
  if (!VIDEO_EXTENSIONS.has(ext)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Poster is supported only for video files",
    });
  }

  const settings = readSettings();
  const mediaFolder = ensureMediaFolder(settings);
  importProjectRootMediaFiles(settings, mediaFolder);
  const sourcePath = path.join(mediaFolder, file);

  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw createError({
      statusCode: 404,
      statusMessage: "Video not found",
    });
  }

  if (!hasFfmpeg()) {
    throw createError({
      statusCode: 503,
      statusMessage: "ffmpeg is not installed for poster generation",
    });
  }

  const stat = fs.statSync(sourcePath);
  const cacheDir = path.resolve(process.cwd(), ".cache", "posters");
  fs.mkdirSync(cacheDir, { recursive: true });

  const cacheName = `${path.parse(file).name}-${Math.round(stat.mtimeMs)}.jpg`;
  const posterPath = path.join(cacheDir, cacheName);

  if (!fs.existsSync(posterPath)) {
    const run = spawnSync(
      "ffmpeg",
      ["-y", "-i", sourcePath, "-ss", "00:00:01", "-vframes", "1", posterPath],
      { stdio: "ignore" }
    );

    if (run.status !== 0 || !fs.existsSync(posterPath)) {
      throw createError({
        statusCode: 500,
        statusMessage: "Failed to generate poster",
      });
    }
  }

  setHeader(event, "Cache-Control", "public, max-age=3600");
  setHeader(event, "Content-Type", "image/jpeg");
  return sendStream(
    event,
    fs.createReadStream(posterPath) as unknown as ReadableStream
  );
});
