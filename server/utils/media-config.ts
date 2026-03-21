import fs from "node:fs";
import path from "node:path";
import type { AppSettings } from "./settings";
import { getConfigPath } from "./settings";

export interface ConfigItem {
  fileName?: string;
  filePath?: string;
  title?: string;
  description?: string;
  hashtags?: string[];
  vip?: boolean;
  uploaded?: boolean;
}

function getItemFileName(item: ConfigItem): string {
  if (item.fileName) return String(item.fileName);
  if (item.filePath) return path.basename(String(item.filePath));
  return "";
}

export function syncMediaConfig(
  settings: AppSettings,
  mediaFolder: string,
  files: string[]
): { configPath: string; syncedItems: ConfigItem[] } {
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
    configPath,
    syncedItems,
  };
}
