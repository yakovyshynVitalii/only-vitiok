import fs from "node:fs";
import path from "node:path";
import { ROOT_DIR } from "./constants";

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
]);

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
  ".m4v",
]);

const MEDIA_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]);

function parseBool(value: string, fallback = false): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function isSupportedMediaFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return MEDIA_EXTENSIONS.has(ext);
}

export function listMediaFiles(mediaFolder: string): string[] {
  return fs
    .readdirSync(mediaFolder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isSupportedMediaFile(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export function importProjectRootMediaFiles(
  settings: { env?: Record<string, string> },
  mediaFolder: string
): { imported: string[]; skipped: number } {
  const enabled = parseBool(
    settings.env?.MEDIA_IMPORT_PROJECT_ROOT || "",
    false
  );

  if (!enabled) {
    return {
      imported: [],
      skipped: 0,
    };
  }

  const rootDir = path.resolve(ROOT_DIR);
  const targetDir = path.resolve(mediaFolder);

  if (rootDir === targetDir) {
    return {
      imported: [],
      skipped: 0,
    };
  }

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return {
      imported: [],
      skipped: 0,
    };
  }

  const imported: string[] = [];
  let skipped = 0;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!isSupportedMediaFile(entry.name)) continue;

    const sourcePath = path.join(rootDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (fs.existsSync(targetPath)) {
      skipped += 1;
      continue;
    }

    try {
      fs.copyFileSync(sourcePath, targetPath);
      imported.push(entry.name);
    } catch {
      skipped += 1;
    }
  }

  return {
    imported: imported.sort((a, b) => a.localeCompare(b)),
    skipped,
  };
}
