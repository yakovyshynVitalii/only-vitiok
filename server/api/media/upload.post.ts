import fs from "node:fs";
import path from "node:path";
import { createError, readMultipartFormData } from "h3";
import { syncMediaConfig } from "~/server/utils/media-config";
import {
  importProjectRootMediaFiles,
  listMediaFiles,
} from "~/server/utils/media-files";
import { ensureMediaFolder, readSettings } from "~/server/utils/settings";

function sanitizeFileName(fileName: string): string {
  const normalized = path.basename(fileName).replace(/[^\w.-]+/g, "_");
  return normalized || `media-${Date.now()}`;
}

function resolveCollision(mediaFolder: string, fileName: string): string {
  const parsed = path.parse(fileName);
  let candidate = path.join(mediaFolder, fileName);
  let suffix = 1;

  while (fs.existsSync(candidate)) {
    candidate = path.join(
      mediaFolder,
      `${parsed.name}-${suffix}${parsed.ext}`
    );
    suffix += 1;
  }

  return candidate;
}

export default defineEventHandler(async (event) => {
  const settings = readSettings();
  const mediaFolder = ensureMediaFolder(settings);
  const form = await readMultipartFormData(event);

  if (!form || !form.length) {
    throw createError({
      statusCode: 400,
      statusMessage: "Files were not provided",
    });
  }

  const saved: Array<{ name: string; bytes: number }> = [];

  for (const part of form) {
    if (!part.filename || !part.data) continue;

    const safeFileName = sanitizeFileName(part.filename);
    const destination = resolveCollision(mediaFolder, safeFileName);
    fs.writeFileSync(destination, part.data);

    saved.push({
      name: path.basename(destination),
      bytes: part.data.length,
    });
  }

  if (!saved.length) {
    throw createError({
      statusCode: 400,
      statusMessage: "No files found in multipart payload",
    });
  }

  importProjectRootMediaFiles(settings, mediaFolder);
  const files = listMediaFiles(mediaFolder);
  const { syncedItems } = syncMediaConfig(settings, mediaFolder, files);

  return {
    saved,
    files,
    count: files.length,
    itemCount: syncedItems.length,
  };
});
