import { syncMediaConfig } from "~/server/utils/media-config";
import { listMediaFiles } from "~/server/utils/media-files";
import { ensureMediaFolder, readSettings } from "~/server/utils/settings";

export default defineEventHandler(() => {
  const settings = readSettings();
  const mediaFolder = ensureMediaFolder(settings);
  const files = listMediaFiles(mediaFolder);
  const { syncedItems } = syncMediaConfig(settings, mediaFolder, files);

  return {
    files,
    count: files.length,
    itemCount: syncedItems.length,
  };
});
