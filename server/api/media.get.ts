import fs from "node:fs";
import path from "node:path";
import { ensureMediaFolder, readSettings } from "~/server/utils/settings";

export default defineEventHandler(() => {
  const settings = readSettings();
  const mediaFolder = ensureMediaFolder(settings);
  const files = fs
    .readdirSync(mediaFolder, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  return {
    mediaFolder,
    files,
    count: files.length,
    relativeMediaFolder: path.relative(process.cwd(), mediaFolder) || ".",
  };
});
