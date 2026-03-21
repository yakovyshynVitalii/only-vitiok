import fs from "node:fs";
import { getConfigPath, readSettings } from "~/server/utils/settings";

export default defineEventHandler(() => {
  const settings = readSettings();
  const configPath = getConfigPath(settings);

  if (!fs.existsSync(configPath)) {
    return {
      exists: false,
      configPath,
      text: "",
      parsed: null,
    };
  }

  const text = fs.readFileSync(configPath, "utf8");

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  return {
    exists: true,
    configPath,
    text,
    parsed,
  };
});
