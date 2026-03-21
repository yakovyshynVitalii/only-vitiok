import fs from "node:fs";
import path from "node:path";
import { createError, readMultipartFormData } from "h3";
import {
  importProjectRootMediaFiles,
  listMediaFiles,
} from "~/server/utils/media-files";
import {
  ensureMediaFolder,
  getConfigPath,
  readSettings,
} from "~/server/utils/settings";

interface ConfigItem {
  fileName?: string;
  filePath?: string;
  title?: string;
  description?: string;
  hashtags?: string[];
  vip?: boolean;
  uploaded?: boolean;
}

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

function getItemFileName(item: ConfigItem): string {
  if (item.fileName) return String(item.fileName);
  if (item.filePath) return path.basename(String(item.filePath));
  return "";
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

  const configPath = getConfigPath(settings);
  let existingConfig: Record<string, unknown> = {};

  if (fs.existsSync(configPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (parsed && typeof parsed === "object") {
        existingConfig = parsed as Record<string, unknown>;
      }
    } catch {
      existingConfig = {};
    }
  }

  const existingItems = Array.isArray(existingConfig.items)
    ? (existingConfig.items as ConfigItem[])
    : [];

  const byFileName = new Map<string, ConfigItem>();
  for (const item of existingItems) {
    const fileName = getItemFileName(item);
    if (!fileName) continue;
    byFileName.set(fileName, item);
  }

  const syncedItems: ConfigItem[] = files.map((file) => {
    const existing = byFileName.get(file);

    if (existing) {
      return {
        ...existing,
        fileName: file,
        filePath: path.join(mediaFolder, file),
        title: String(existing.title ?? ""),
        description: String(existing.description ?? ""),
        hashtags: Array.isArray(existing.hashtags)
          ? existing.hashtags.filter((tag) => typeof tag === "string")
          : [],
        vip: Boolean(existing.vip),
      };
    }

    return {
      fileName: file,
      filePath: path.join(mediaFolder, file),
      title: "",
      description: "",
      hashtags: [],
      vip: false,
      uploaded: false,
    };
  });

  const nextConfig = {
    ...existingConfig,
    generatedAt: new Date().toISOString(),
    sourceFolder: mediaFolder,
    hashtags: Array.isArray(existingConfig.hashtags)
      ? existingConfig.hashtags.filter((tag) => typeof tag === "string")
      : [],
    items: syncedItems,
  };

  fs.writeFileSync(configPath, JSON.stringify(nextConfig, null, 2), "utf8");

  return {
    saved,
    files,
    count: files.length,
    itemCount: syncedItems.length,
  };
});
