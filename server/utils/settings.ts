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
  globalTagLimit: number;
  uploadDistributionMode: UploadDistributionMode;
  uploadCollections: UploadCollectionTarget[];
}

export type UploadDistributionMode = "range" | "even";

export interface UploadCollectionTarget {
  collectionId: string;
  createUrl: string;
  rangeStart: number | null;
  rangeEnd: number | null;
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

function stripLocaleFromCollectionUrl(url: string): string {
  return String(url || "").replace(/\/[a-z]{2}(\/collection\/)/i, "$1");
}

function buildCreateUrl(baseUrl: string, collectionId: string): string {
  const trimmedBase = String(baseUrl || "").replace(/\/+$/, "");
  const trimmedCollection = String(collectionId || "").trim();
  if (!trimmedBase || !trimmedCollection) return "";
  return `${trimmedBase}/collection/${trimmedCollection}`;
}

function normalizeAssetCount(value: unknown): number | null {
  if (value == null) return null;

  const normalized = String(value).trim();
  if (!normalized) return null;

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.floor(parsed));
}

function normalizeRangePoint(value: unknown): number | null {
  const normalized = normalizeAssetCount(value);
  if (normalized == null) return null;
  return normalized <= 0 ? 1 : normalized;
}

function parseDistributionMode(value: string): UploadDistributionMode {
  return String(value || "").trim().toLowerCase() === "even" ? "even" : "range";
}

function normalizeUploadCollectionTarget(
  input:
    | (Partial<UploadCollectionTarget> & { assetCount?: number | null })
    | null
    | undefined,
  baseUrl: string
): UploadCollectionTarget | null {
  const explicitCreateUrl = stripLocaleFromCollectionUrl(String(input?.createUrl || "").trim());
  const collectionId = String(input?.collectionId || "").trim() || extractCollectionId(explicitCreateUrl);
  const createUrl = explicitCreateUrl || buildCreateUrl(baseUrl, collectionId);
  let rangeStart = normalizeRangePoint(input?.rangeStart);
  let rangeEnd = normalizeRangePoint(input?.rangeEnd);

  if (rangeStart != null && rangeEnd != null && rangeEnd < rangeStart) {
    rangeEnd = rangeStart;
  }

  if (rangeStart == null && rangeEnd == null) {
    const legacyAssetCount = normalizeAssetCount(input?.assetCount);
    if (legacyAssetCount != null) {
      rangeStart = 1;
      rangeEnd = legacyAssetCount === 0 ? 1 : legacyAssetCount;
    }
  }

  if (!collectionId && !createUrl) return null;

  return {
    collectionId,
    createUrl,
    rangeStart,
    rangeEnd,
  };
}

function parseUploadCollections(
  raw: string,
  baseUrl: string
): UploadCollectionTarget[] {
  const normalizedRaw = String(raw || "").trim();
  if (!normalizedRaw) return [];

  try {
    const parsed = JSON.parse(normalizedRaw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) =>
        normalizeUploadCollectionTarget(
          item as Partial<UploadCollectionTarget>,
          baseUrl
        )
      )
      .filter((item): item is UploadCollectionTarget => Boolean(item));
  } catch {
    return [];
  }
}

function getLegacyUploadCollections(
  env: Record<string, string>
): UploadCollectionTarget[] {
  const collectionId = String(env.COLLECTION_ID || "").trim();
  const createUrl =
    String(env.CREATE_URL || "").trim() || buildCreateUrl(env.BASE_URL, collectionId);

  if (!collectionId && !createUrl) return [];

  return [
    {
      collectionId,
      createUrl,
      rangeStart: null,
      rangeEnd: null,
    },
  ];
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
  const uploadDistributionMode = parseDistributionMode(
    env.UPLOAD_DISTRIBUTION_MODE
  );
  const parsedUploadCollections = parseUploadCollections(
    env.UPLOAD_COLLECTIONS,
    env.BASE_URL
  );
  const uploadCollections = parsedUploadCollections.length
    ? parsedUploadCollections
    : getLegacyUploadCollections(env);
  const autoUploadAfterAnalyze = parseBool(
    env.AUTO_UPLOAD_AFTER_ANALYZE,
    false
  );
  const globalTagLimit = env.GLOBAL_TAG_LIMIT === "100" ? 100 : 15;

  return {
    env,
    envText,
    collectionId: uploadCollections[0]?.collectionId || collectionId,
    autoUploadAfterAnalyze,
    globalTagLimit,
    uploadDistributionMode,
    uploadCollections,
  };
}

export function writeSettings(input: {
  env?: Record<string, string>;
  collectionId?: string;
  autoUploadAfterAnalyze?: boolean;
  globalTagLimit?: number;
  uploadDistributionMode?: UploadDistributionMode;
  uploadCollections?: Array<
    Partial<UploadCollectionTarget> & {
      assetCount?: number | null;
    }
  >;
}): AppSettings {
  const current = readSettings();
  const explicitCreateUrlProvided = Object.prototype.hasOwnProperty.call(
    input.env || {},
    "CREATE_URL"
  );
  const explicitUploadCollectionsProvided = Object.prototype.hasOwnProperty.call(
    input,
    "uploadCollections"
  );
  const nextEnv = {
    ...current.env,
    ...(input.env || {}),
  };

  if (explicitUploadCollectionsProvided) {
    const normalizedTargets = Array.isArray(input.uploadCollections)
      ? input.uploadCollections
          .map((item) => normalizeUploadCollectionTarget(item, nextEnv.BASE_URL))
          .filter((item): item is UploadCollectionTarget => Boolean(item))
      : [];

    nextEnv.UPLOAD_COLLECTIONS = normalizedTargets.length
      ? JSON.stringify(normalizedTargets)
      : "";

    const primaryTarget = normalizedTargets[0];
    nextEnv.COLLECTION_ID = primaryTarget?.collectionId || "";
    nextEnv.CREATE_URL = primaryTarget?.createUrl || "";
  }

  if (typeof input.collectionId === "string" && !explicitUploadCollectionsProvided) {
    const trimmedCollection = input.collectionId.trim();
    nextEnv.COLLECTION_ID = trimmedCollection;

    if (!explicitCreateUrlProvided) {
      const generatedCreateUrl = buildCreateUrl(nextEnv.BASE_URL, trimmedCollection);
      if (generatedCreateUrl) {
        nextEnv.CREATE_URL = generatedCreateUrl;
      }
    }

    const primaryTarget = normalizeUploadCollectionTarget(
      {
        collectionId: nextEnv.COLLECTION_ID,
        createUrl: nextEnv.CREATE_URL,
        rangeStart: null,
        rangeEnd: null,
      },
      nextEnv.BASE_URL
    );

    nextEnv.UPLOAD_COLLECTIONS = primaryTarget ? JSON.stringify([primaryTarget]) : "";
  }

  if (explicitCreateUrlProvided && !explicitUploadCollectionsProvided) {
    nextEnv.COLLECTION_ID =
      String(nextEnv.COLLECTION_ID || "").trim() ||
      extractCollectionId(nextEnv.CREATE_URL);

    const primaryTarget = normalizeUploadCollectionTarget(
      {
        collectionId: nextEnv.COLLECTION_ID,
        createUrl: nextEnv.CREATE_URL,
        rangeStart: null,
        rangeEnd: null,
      },
      nextEnv.BASE_URL
    );

    nextEnv.UPLOAD_COLLECTIONS = primaryTarget ? JSON.stringify([primaryTarget]) : "";
  }

  if (typeof input.autoUploadAfterAnalyze === "boolean") {
    nextEnv.AUTO_UPLOAD_AFTER_ANALYZE = input.autoUploadAfterAnalyze
      ? "true"
      : "false";
  }

  if (typeof input.globalTagLimit === "number") {
    nextEnv.GLOBAL_TAG_LIMIT = input.globalTagLimit === 100 ? "100" : "15";
  }

  if (typeof input.uploadDistributionMode === "string") {
    nextEnv.UPLOAD_DISTRIBUTION_MODE =
      input.uploadDistributionMode === "even" ? "even" : "range";
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
