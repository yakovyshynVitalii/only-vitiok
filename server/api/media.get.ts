import path from "node:path";
import {
  importProjectRootMediaFiles,
  listMediaFiles,
} from "~/server/utils/media-files";
import { ensureMediaFolder, readSettings } from "~/server/utils/settings";

export default defineEventHandler(() => {
  const settings = readSettings();
  const mediaFolder = ensureMediaFolder(settings);
  importProjectRootMediaFiles(settings, mediaFolder);
  const files = listMediaFiles(mediaFolder);

  return {
    mediaFolder,
    files,
    count: files.length,
    relativeMediaFolder: path.relative(process.cwd(), mediaFolder) || ".",
  };
});
