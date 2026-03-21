import fs from "node:fs";
import path from "node:path";
import {
  ensureMediaFolder,
  getConfigPath,
  readSettings,
} from "~/server/utils/settings";

export default defineEventHandler(() => {
  const settings = readSettings();
  const mediaFolder = ensureMediaFolder(settings);
  const entries = fs
    .readdirSync(mediaFolder, { withFileTypes: true })
    .filter((entry) => entry.isFile());

  let deleted = 0;

  for (const entry of entries) {
    const target = path.join(mediaFolder, entry.name);
    try {
      fs.unlinkSync(target);
      deleted += 1;
    } catch {
      // Skip files that cannot be deleted and continue.
    }
  }

  const files = fs
    .readdirSync(mediaFolder, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const configPath = getConfigPath(settings);
  let configCleared = false;

  try {
    const existing = fs.existsSync(configPath)
      ? JSON.parse(fs.readFileSync(configPath, "utf8"))
      : {};

    const nextConfig = {
      ...existing,
      generatedAt: new Date().toISOString(),
      sourceFolder: mediaFolder,
      hashtags: [],
      items: [],
    };

    fs.writeFileSync(configPath, JSON.stringify(nextConfig, null, 2), "utf8");
    configCleared = true;
  } catch {
    configCleared = false;
  }

  return {
    deleted,
    files,
    count: files.length,
    configCleared,
  };
});
