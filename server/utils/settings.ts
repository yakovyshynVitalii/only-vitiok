import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_ENV,
  ENV_WRITE_ORDER,
  ROOT_DIR,
} from "./constants";
import {
  parseEnvText,
  readEnvText,
  serializeEnv,
  writeEnvText,
} from "./env-file";

export interface AppSettings {
  env: Record<string, string>;
  envText: string;
  collectionId: string;
  autoUploadAfterAnalyze: boolean;
}

function sortEnvKeys(env: Record<string, string>): Record<string, string> {
  const extras = Object.keys(env)
    .filter((key) => !ENV_WRITE_ORDER.includes(key))
    .sort((a, b) => a.localeCompare(b));

  const ordered: Record<string, string> = {};

  for (const key of [...ENV_WRITE_ORDER, ...extras]) {
    if (env[key] == null) continue;
    ordered[key] = String(env[key]);
  }

  return ordered;
}

function extractCollectionId(createUrl: string): string {
  const match = String(createUrl || "").match(/\/collection\/([^/?#]+)/i);
  return match?.[1] ?? "";
}

function buildCreateUrl(baseUrl: string, collectionId: string): string {
  const trimmedBase = String(baseUrl || "").replace(/\/+$/, "");
  const trimmedCollection = String(collectionId || "").trim();
  if (!trimmedBase || !trimmedCollection) return "";
  return `${trimmedBase}/collection/${trimmedCollection}`;
}

function parseBool(value: string, fallback = false): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function readSettings(): AppSettings {
  const envText = readEnvText();
  const parsed = parseEnvText(envText);
  const env = sortEnvKeys({
    ...DEFAULT_ENV,
    ...parsed,
  });

  const collectionId = env.COLLECTION_ID || extractCollectionId(env.CREATE_URL);
  const autoUploadAfterAnalyze = parseBool(
    env.AUTO_UPLOAD_AFTER_ANALYZE,
    false
  );

  return {
    env,
    envText,
    collectionId,
    autoUploadAfterAnalyze,
  };
}

export function writeSettings(input: {
  env?: Record<string, string>;
  collectionId?: string;
  autoUploadAfterAnalyze?: boolean;
}): AppSettings {
  const current = readSettings();
  const explicitCreateUrlProvided = Object.prototype.hasOwnProperty.call(
    input.env || {},
    "CREATE_URL"
  );
  const nextEnv = {
    ...current.env,
    ...(input.env || {}),
  };

  if (typeof input.collectionId === "string") {
    const trimmedCollection = input.collectionId.trim();
    nextEnv.COLLECTION_ID = trimmedCollection;

    if (!explicitCreateUrlProvided) {
      const generatedCreateUrl = buildCreateUrl(nextEnv.BASE_URL, trimmedCollection);
      if (generatedCreateUrl) {
        nextEnv.CREATE_URL = generatedCreateUrl;
      }
    }
  }

  if (typeof input.autoUploadAfterAnalyze === "boolean") {
    nextEnv.AUTO_UPLOAD_AFTER_ANALYZE = input.autoUploadAfterAnalyze
      ? "true"
      : "false";
  }

  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(nextEnv)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    sanitized[normalizedKey] = String(value ?? "").trim();
  }

  const ordered = sortEnvKeys(sanitized);
  writeEnvText(serializeEnv(ordered));
  return readSettings();
}

function resolveFromRoot(candidate: string, fallback: string): string {
  return path.resolve(ROOT_DIR, candidate || fallback);
}

export function getMediaFolder(settings: AppSettings): string {
  return resolveFromRoot(settings.env.MEDIA_FOLDER, "./media");
}

export function getConfigPath(settings: AppSettings): string {
  return resolveFromRoot(settings.env.MEDIA_CONFIG_PATH, "./media-config.json");
}

export function ensureMediaFolder(settings: AppSettings): string {
  const mediaFolder = getMediaFolder(settings);
  fs.mkdirSync(mediaFolder, { recursive: true });
  return mediaFolder;
}
