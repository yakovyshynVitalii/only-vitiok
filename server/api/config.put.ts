import fs from "node:fs";
import { createError, readBody } from "h3";
import { getConfigPath, readSettings } from "~/server/utils/settings";

export default defineEventHandler(async (event) => {
  const body = await readBody<{ text?: string }>(event);
  const text = String(body?.text ?? "").trim();

  if (!text) {
    throw createError({
      statusCode: 400,
      statusMessage: "Provide JSON text in the 'text' field",
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: `Invalid JSON: ${(error as Error).message}`,
    });
  }

  const settings = readSettings();
  const configPath = getConfigPath(settings);
  fs.writeFileSync(configPath, JSON.stringify(parsed, null, 2), "utf8");

  const itemCount = Array.isArray((parsed as { items?: unknown[] }).items)
    ? (parsed as { items: unknown[] }).items.length
    : 0;

  return {
    saved: true,
    configPath,
    itemCount,
  };
});
