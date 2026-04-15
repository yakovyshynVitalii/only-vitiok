import { resetConfigAnalysisState } from "~/server/utils/media-config";
import { readSettings } from "~/server/utils/settings";

export default defineEventHandler(() => {
  const settings = readSettings();
  const result = resetConfigAnalysisState(settings);

  return {
    ok: true,
    configPath: result.configPath,
    itemCount: result.itemCount,
    cleared: result.cleared,
  };
});
