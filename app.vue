<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";

interface SettingsResponse {
  env: Record<string, string>;
  envText: string;
  collectionId: string;
  autoUploadAfterAnalyze: boolean;
  globalTagLimit: number;
  uploadDistributionMode: UploadDistributionMode;
  uploadCollections: UploadCollectionTarget[];
}

type UploadDistributionMode = "range" | "even";

interface UploadCollectionTarget {
  collectionId: string;
  createUrl: string;
  rangeStart: number | null;
  rangeEnd: number | null;
}

interface AuthStatusResponse {
  stateExists: boolean;
  loginSessionActive: boolean;
}

interface MediaResponse {
  mediaFolder: string;
  files: string[];
  count: number;
}

interface ConfigResponse {
  exists: boolean;
  configPath: string;
  text: string;
}

interface ConfigItem {
  fileName?: string;
  filePath?: string;
  title?: string;
  description?: string;
  hashtags?: string[];
  trendTermsUsed?: string[];
  trendScore?: number;
  contentSummary?: string;
  vip?: boolean;
  uploaded?: boolean;
  uploadCollectionId?: string;
  uploadCreateUrl?: string;
}

interface TaskStatusResponse {
  runningTask: string | null;
  isBusy: boolean;
  stopRequested?: boolean;
}

const envMap = reactive<Record<string, string>>({});
const uploadCollections = ref<UploadCollectionTarget[]>([]);
const uploadDistributionMode = ref<UploadDistributionMode>("range");
const autoUploadAfterAnalyze = ref(false);
const globalTagLimit = ref<15 | 100>(15);

const stateExists = ref(false);
const loginSessionActive = ref(false);
const mediaFiles = ref<string[]>([]);
const configText = ref("");
const configPath = ref("");
const configData = ref<Record<string, unknown> | null>(null);
const runningTask = ref<string | null>(null);
const isBusy = ref(false);
const infoMessage = ref("");
const errorMessage = ref("");
const runLog = ref("");

const mediaPage = ref(1);
const MEDIA_PAGE_SIZE = 24;

const isSavingSettings = ref(false);
const isSavingCreateUrl = ref(false);
const isUploadingMedia = ref(false);
const isSavingConfig = ref(false);
const isRunningAnalyze = ref(false);
const isRunningUpload = ref(false);
const isRunningAddTags = ref(false);
const isHandlingLogin = ref(false);
const isStoppingAnalyze = ref(false);
const isDragOver = ref(false);
const isSettingsOpen = ref(false);
const isClearingMedia = ref(false);
const isClearingGeneratedConfig = ref(false);
const isScanningMedia = ref(false);
const isConfigDrawerOpen = ref(false);
const isLogsDrawerOpen = ref(false);
const canResumeAnalyze = ref(false);

const collectionPrompt = ref("");
const collectionGenTitle = ref("");
const collectionGenDescription = ref("");
const isGeneratingCollection = ref(false);

const newEnvKey = ref("");
const newEnvValue = ref("");
const lastPickedFiles = ref(0);
const fileInputRef = ref<HTMLInputElement | null>(null);
const tagDraftByIndex = reactive<Record<number, string>>({});
let analyzeLiveSyncTimer: ReturnType<typeof setInterval> | null = null;
let collectionSaveTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedSaveCollections() {
  if (collectionSaveTimer) clearTimeout(collectionSaveTimer);
  collectionSaveTimer = setTimeout(() => saveUploadCollections(), 800);
}

const MANAGED_ENV_KEYS = new Set([
  "BASE_URL",
  "COLLECTION_ID",
  "CREATE_URL",
  "UPLOAD_COLLECTIONS",
  "UPLOAD_DISTRIBUTION_MODE",
  "AUTO_UPLOAD_AFTER_ANALYZE",
]);

const envKeys = computed(() =>
  Object.keys(envMap)
    .filter((key) => !MANAGED_ENV_KEYS.has(key))
    .sort((a, b) => a.localeCompare(b))
);

const baseUrl = computed({
  get: () => envMap.BASE_URL || "",
  set: (value: string) => {
    envMap.BASE_URL = value;
  },
});



const loginButtonText = computed(() => {
  if (stateExists.value) return "Logout";
  if (loginSessionActive.value) return "Finish login";
  return "Login";
});

const loginButtonColor = computed(() => {
  if (stateExists.value) return "error";
  return "primary";
});

const pendingActions = computed(
  () =>
    isRunningAnalyze.value ||
    isRunningUpload.value ||
    isRunningAddTags.value ||
    isHandlingLogin.value
);



function isItemAnalyzed(item: ConfigItem): boolean {
  const title = String(item.title || "").trim();
  const description = String(item.description || "").trim();
  const hashtags = Array.isArray(item.hashtags) ? item.hashtags : [];

  return Boolean(title && description && hashtags.length);
}

const analysisProgress = computed(() => {
  const total = configItems.value.length;
  const done = configItems.value.filter((item) => isItemAnalyzed(item)).length;
  const percent = total ? Math.round((done / total) * 100) : 0;

  return { total, done, percent };
});

const configItems = computed<ConfigItem[]>(() => {
  const items = (configData.value as { items?: unknown[] } | null)?.items;
  return Array.isArray(items) ? (items as ConfigItem[]) : [];
});

const mediaTotalPages = computed(() =>
  Math.max(1, Math.ceil(configItems.value.length / MEDIA_PAGE_SIZE))
);

const paginatedItems = computed(() => {
  const start = (mediaPage.value - 1) * MEDIA_PAGE_SIZE;
  return configItems.value.slice(start, start + MEDIA_PAGE_SIZE);
});

// Reset page when items change significantly
watch(() => configItems.value.length, () => {
  if (mediaPage.value > mediaTotalPages.value) {
    mediaPage.value = mediaTotalPages.value;
  }
});

const globalTags = computed(() => {
  const source = configData.value as
    | {
        hashtags?: unknown;
        items?: ConfigItem[];
      }
    | null;

  const fromRoot = Array.isArray(source?.hashtags)
    ? source.hashtags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => normalizeTag(tag))
        .filter(Boolean)
    : [];

  if (fromRoot.length) {
    return [...new Set(fromRoot)];
  }

  const fromItems = Array.isArray(source?.items)
    ? source.items
        .flatMap((item) => getTagsArray(item))
        .map((tag) => normalizeTag(tag))
        .filter(Boolean)
    : [];

  return [...new Set(fromItems)];
});

const normalizedUploadCollections = computed<UploadCollectionTarget[]>(() =>
  uploadCollections.value
    .map((target) => {
      const rawUrl = stripLocaleFromCollectionUrl(String(target.createUrl || "").trim());
      const collectionId = String(target.collectionId || "").trim() || extractCollectionIdFromUrl(rawUrl);
      const createUrl = rawUrl || deriveCreateUrl(baseUrl.value, collectionId);
      const rangeStart = normalizeRangePoint(target.rangeStart);
      let rangeEnd = normalizeRangePoint(target.rangeEnd);

      if (rangeStart != null && rangeEnd != null && rangeEnd < rangeStart) {
        rangeEnd = rangeStart;
      }

      if (!collectionId && !createUrl) return null;

      return {
        collectionId,
        createUrl,
        rangeStart,
        rangeEnd,
      };
    })
    .filter((target): target is UploadCollectionTarget => Boolean(target))
);

const plannedUploadBreakdown = computed(() => {
  const breakdown: Array<{
    label: string;
    rangeText: string;
    assignedCount: number;
    createUrl: string;
  }> = [];
  const plans = planUploadTargets(
    configItems.value,
    normalizedUploadCollections.value,
    uploadDistributionMode.value
  );

  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    breakdown.push({
      label: getUploadCollectionLabel(plan, index),
      rangeText: formatTargetRange(plan, uploadDistributionMode.value),
      assignedCount: plan.items.length,
      createUrl: plan.createUrl,
    });
  }

  return {
    assignedCount: plans.reduce((sum, plan) => sum + plan.items.length, 0),
    unassignedCount: Math.max(
      configItems.value.length - plans.reduce((sum, plan) => sum + plan.items.length, 0),
      0
    ),
    targets: breakdown,
  };
});

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".bmp",
]);

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
  ".m4v",
]);

function setMessage(message: string) {
  infoMessage.value = message;
  errorMessage.value = "";
}

function setError(error: unknown) {
  infoMessage.value = "";

  if (typeof error === "string") {
    errorMessage.value = error;
    return;
  }

  if (
    error &&
    typeof error === "object" &&
    "data" in error &&
    typeof (error as { data?: { statusMessage?: string } }).data?.statusMessage ===
      "string"
  ) {
    errorMessage.value =
      (error as { data: { statusMessage: string } }).data.statusMessage;
    return;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: string }).message === "string"
  ) {
    errorMessage.value = (error as { message: string }).message;
    return;
  }

  errorMessage.value = "Unknown error";
}

function extractErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;

  if (
    error &&
    typeof error === "object" &&
    "data" in error &&
    typeof (error as { data?: { statusMessage?: string } }).data?.statusMessage ===
      "string"
  ) {
    return (error as { data: { statusMessage: string } }).data.statusMessage;
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message?: string }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return "";
}

function resetEnv(next: Record<string, string>) {
  for (const key of Object.keys(envMap)) {
    Reflect.deleteProperty(envMap, key);
  }

  for (const [key, value] of Object.entries(next)) {
    envMap[key] = value;
  }
}

function cloneEnvMap(): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(envMap)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) continue;
    out[normalizedKey] = String(value ?? "").trim();
  }

  return out;
}

function getItemFileName(item: ConfigItem): string {
  const raw = item.fileName || item.filePath || "";
  if (!raw) return "";
  const parts = String(raw).split(/[\\/]/);
  return parts[parts.length - 1] || "";
}

function getItemExt(item: ConfigItem): string {
  const fileName = getItemFileName(item).toLowerCase();
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(idx) : "";
}

function getFileExt(fileName: string): string {
  const normalized = String(fileName || "").toLowerCase();
  const idx = normalized.lastIndexOf(".");
  return idx >= 0 ? normalized.slice(idx) : "";
}

function isImageItem(item: ConfigItem): boolean {
  return IMAGE_EXTENSIONS.has(getItemExt(item));
}

function isVideoItem(item: ConfigItem): boolean {
  return VIDEO_EXTENSIONS.has(getItemExt(item));
}

function getAssetUrl(item: ConfigItem): string {
  const fileName = getItemFileName(item);
  return fileName ? `/api/media/asset?file=${encodeURIComponent(fileName)}` : "";
}

function getPosterUrl(item: ConfigItem): string {
  const fileName = getItemFileName(item);
  return fileName ? `/api/media/poster?file=${encodeURIComponent(fileName)}` : "";
}

function parseConfigData(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

let isSyncingFromData = false;

function syncConfigTextFromData() {
  if (!configData.value) return;
  isSyncingFromData = true;
  configText.value = JSON.stringify(configData.value, null, 2);
  nextTick(() => { isSyncingFromData = false; });
}

function deriveCreateUrl(base: string, collection: string): string {
  const trimmedBase = String(base || "").replace(/\/+$/, "");
  const trimmedCollection = String(collection || "").trim();

  if (!trimmedBase || !trimmedCollection) return "";
  return `${trimmedBase}/collection/${trimmedCollection}`;
}

function stripLocaleFromCollectionUrl(url: string): string {
  return String(url || "").replace(/\/[a-z]{2}(\/collection\/)/i, "$1");
}

function extractCollectionIdFromUrl(url: string): string {
  const match = String(url || "").match(/\/collection\/([^/?#]+)/i);
  return match?.[1] ?? "";
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

function createEmptyUploadCollection(): UploadCollectionTarget {
  return {
    collectionId: "",
    createUrl: "",
    rangeStart: null,
    rangeEnd: null,
  };
}

function cloneUploadCollections(): UploadCollectionTarget[] {
  return uploadCollections.value.map((target) => ({
    collectionId: String(target.collectionId || "").trim(),
    createUrl: stripLocaleFromCollectionUrl(String(target.createUrl || "").trim()),
    rangeStart: normalizeRangePoint(target.rangeStart),
    rangeEnd: normalizeRangePoint(target.rangeEnd),
  }));
}

function getUploadCollectionLabel(target: UploadCollectionTarget, index: number): string {
  return (
    String(target.collectionId || "").trim() ||
    extractCollectionIdFromUrl(target.createUrl) ||
    `Collection ${index + 1}`
  );
}

function handleCollectionUrlInput(index: number, rawUrl: string) {
  const target = uploadCollections.value[index];
  if (!target) return;

  const cleanUrl = stripLocaleFromCollectionUrl(rawUrl.trim());
  target.createUrl = cleanUrl;
  const extractedId = extractCollectionIdFromUrl(cleanUrl);
  if (extractedId) {
    target.collectionId = extractedId;
  }
  debouncedSaveCollections();
}





function addUploadCollection() {
  uploadCollections.value.push(createEmptyUploadCollection());
}

function removeUploadCollection(index: number) {
  uploadCollections.value.splice(index, 1);
  saveUploadCollections();
}

function updateUploadCollectionRangePoint(
  index: number,
  field: "rangeStart" | "rangeEnd",
  value: string | number
) {
  const target = uploadCollections.value[index];
  if (!target) return;
  target[field] = normalizeRangePoint(value);
  debouncedSaveCollections();
}

function formatTargetRange(
  target: UploadCollectionTarget,
  mode: UploadDistributionMode
): string {
  if (mode === "even") return "Even split";

  const start = target.rangeStart ?? 1;
  const end = target.rangeEnd;
  return end != null ? `${start}-${end}` : `${start}+`;
}

function planUploadTargets(
  items: ConfigItem[],
  targets: UploadCollectionTarget[],
  mode: UploadDistributionMode
) {
  if (!targets.length || !items.length) return [];

  if (mode === "even") {
    const total = items.length;
    const base = Math.floor(total / targets.length);
    const remainder = total % targets.length;
    const plans: Array<UploadCollectionTarget & { items: ConfigItem[] }> = [];
    let cursor = 0;

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      const size = base + (index < remainder ? 1 : 0);
      const targetItems = items.slice(cursor, cursor + size);
      cursor += size;
      plans.push({
        ...target,
        items: targetItems,
      });
    }

    return plans.filter((plan) => plan.items.length > 0);
  }

  const taken = new Set<number>();
  const plans: Array<UploadCollectionTarget & { items: ConfigItem[] }> = [];

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const start = Math.max((target.rangeStart ?? 1) - 1, 0);
    const end = target.rangeEnd != null ? Math.min(target.rangeEnd - 1, items.length - 1) : items.length - 1;
    const targetItems: ConfigItem[] = [];

    for (let cursor = start; cursor <= end; cursor += 1) {
      if (cursor < 0 || cursor >= items.length || taken.has(cursor)) continue;
      taken.add(cursor);
      targetItems.push(items[cursor] as ConfigItem);
    }

    plans.push({
      ...target,
      items: targetItems,
    });
  }

  return plans.filter((plan) => plan.items.length > 0);
}

function addEnvField() {
  const key = newEnvKey.value.trim();
  if (!key) return;

  envMap[key] = newEnvValue.value.trim();
  newEnvKey.value = "";
  newEnvValue.value = "";
}

function removeEnvField(key: string) {
  Reflect.deleteProperty(envMap, key);
}

function openFileDialog() {
  fileInputRef.value?.click();
}

async function loadSettings() {
  const settings = await $fetch<SettingsResponse>("/api/settings");

  resetEnv(settings.env);
  uploadDistributionMode.value = settings.uploadDistributionMode || "range";
  uploadCollections.value = settings.uploadCollections?.length
    ? settings.uploadCollections.map((target) => ({
        collectionId: target.collectionId || "",
        createUrl: target.createUrl || "",
        rangeStart: target.rangeStart ?? null,
        rangeEnd: target.rangeEnd ?? null,
      }))
    : [];
  autoUploadAfterAnalyze.value = settings.autoUploadAfterAnalyze;
  globalTagLimit.value = settings.globalTagLimit === 100 ? 100 : 15;
  envMap.AUTO_UPLOAD_AFTER_ANALYZE = settings.autoUploadAfterAnalyze
    ? "true"
    : "false";
  envMap.GLOBAL_TAG_LIMIT = String(globalTagLimit.value);
}

async function saveSettings() {
  isSavingSettings.value = true;

  try {
    envMap.AUTO_UPLOAD_AFTER_ANALYZE = autoUploadAfterAnalyze.value
      ? "true"
      : "false";
    envMap.GLOBAL_TAG_LIMIT = String(globalTagLimit.value);

    const saved = await $fetch<SettingsResponse>("/api/settings", {
      method: "PUT",
      body: {
        env: cloneEnvMap(),
        collectionId: normalizedUploadCollections.value[0]?.collectionId || "",
        autoUploadAfterAnalyze: autoUploadAfterAnalyze.value,
        globalTagLimit: globalTagLimit.value,
        uploadDistributionMode: uploadDistributionMode.value,
        uploadCollections: cloneUploadCollections(),
      },
    });

    resetEnv(saved.env);
    uploadDistributionMode.value = saved.uploadDistributionMode || "range";
    uploadCollections.value = saved.uploadCollections || [];
    autoUploadAfterAnalyze.value = saved.autoUploadAfterAnalyze;
    globalTagLimit.value = saved.globalTagLimit === 100 ? 100 : 15;
    isSettingsOpen.value = false;
    setMessage("Settings saved.");
  } catch (error) {
    setError(error);
  } finally {
    isSavingSettings.value = false;
  }
}

async function saveUploadCollections() {
  isSavingCreateUrl.value = true;

  try {
    envMap.AUTO_UPLOAD_AFTER_ANALYZE = autoUploadAfterAnalyze.value
      ? "true"
      : "false";
    envMap.GLOBAL_TAG_LIMIT = String(globalTagLimit.value);

    const saved = await $fetch<SettingsResponse>("/api/settings", {
      method: "PUT",
      body: {
        env: cloneEnvMap(),
        collectionId: normalizedUploadCollections.value[0]?.collectionId || "",
        autoUploadAfterAnalyze: autoUploadAfterAnalyze.value,
        globalTagLimit: globalTagLimit.value,
        uploadDistributionMode: uploadDistributionMode.value,
        uploadCollections: cloneUploadCollections(),
      },
    });

    resetEnv(saved.env);
    uploadDistributionMode.value = saved.uploadDistributionMode || "range";
    uploadCollections.value = saved.uploadCollections || [];
    autoUploadAfterAnalyze.value = saved.autoUploadAfterAnalyze;
    globalTagLimit.value = saved.globalTagLimit === 100 ? 100 : 15;
    setMessage("Upload collections saved.");
  } catch (error) {
    setError(error);
  } finally {
    isSavingCreateUrl.value = false;
  }
}

async function loadAuthStatus() {
  const auth = await $fetch<AuthStatusResponse>("/api/auth/status");
  stateExists.value = auth.stateExists;
  loginSessionActive.value = auth.loginSessionActive;
}

async function handleLoginButton() {
  isHandlingLogin.value = true;

  try {
    if (stateExists.value) {
      await $fetch("/api/auth/logout", { method: "POST" });
      setMessage("Logged out. state.json removed.");
    } else if (loginSessionActive.value) {
      await $fetch("/api/auth/login-finish", { method: "POST" });
      setMessage("state.json saved.");
    } else {
      await $fetch("/api/auth/login-start", { method: "POST" });
      setMessage("Browser opened. Sign in and click 'Finish login'.");
    }

    await loadAuthStatus();
  } catch (error) {
    setError(error);
  } finally {
    isHandlingLogin.value = false;
  }
}

async function loadMedia() {
  const media = await $fetch<MediaResponse>("/api/media");
  mediaFiles.value = media.files;
  return media;
}

async function scanMedia() {
  isScanningMedia.value = true;

  try {
    const scanned = await $fetch<{
      files: string[];
      count: number;
      itemCount: number;
    }>("/api/media/scan", {
      method: "POST",
    });
    mediaFiles.value = scanned.files;
    await loadConfig();

    const videoCount = scanned.files.filter((file) =>
      VIDEO_EXTENSIONS.has(getFileExt(file))
    ).length;
    setMessage(
      `Scan completed: ${scanned.count} media file(s), ${videoCount} video file(s), ${scanned.itemCount} card(s).`
    );
  } catch (error) {
    setError(error);
  } finally {
    isScanningMedia.value = false;
  }
}

async function uploadMediaFiles(files: File[]) {
  if (!files.length) return;

  isUploadingMedia.value = true;

  try {
    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file, file.name);
    }

    const uploaded = await $fetch<{
      count: number;
      files: string[];
      itemCount: number;
    }>(
      "/api/media/upload",
      {
        method: "POST",
        body: formData,
      }
    );

    mediaFiles.value = uploaded.files;
    await loadConfig();
    setMessage(`Uploaded ${files.length} files. In media: ${uploaded.count}.`);
  } catch (error) {
    setError(error);
  } finally {
    isUploadingMedia.value = false;
  }
}

async function clearAllMedia() {
  if (!mediaFiles.value.length && !configItems.value.length) {
    setMessage("Media and config are already empty.");
    return;
  }

  const confirmed = window.confirm(
    "Clear all files from media? This action cannot be undone."
  );
  if (!confirmed) return;

  isClearingMedia.value = true;

  try {
    const result = await $fetch<{
      deleted: number;
      files: string[];
      configCleared: boolean;
    }>(
      "/api/media/clear",
      {
        method: "DELETE",
      }
    );

    mediaFiles.value = result.files;
    lastPickedFiles.value = 0;
    await loadConfig();
    setMessage(
      `Deleted files: ${result.deleted}. Config cleared: ${
        result.configCleared ? "yes" : "no"
      }.`
    );
  } catch (error) {
    setError(error);
  } finally {
    isClearingMedia.value = false;
  }
}

async function clearGeneratedConfig() {
  if (!configItems.value.length) {
    setMessage("Config is already empty.");
    return;
  }

  const confirmed = window.confirm(
    "Clear generated titles, descriptions, tags, trends, VIP and upload flags from config? Media files will stay in place."
  );
  if (!confirmed) return;

  isClearingGeneratedConfig.value = true;

  try {
    const result = await $fetch<{
      ok: boolean;
      configPath: string;
      itemCount: number;
      cleared: boolean;
    }>("/api/config/clear", {
      method: "DELETE",
    });

    canResumeAnalyze.value = false;
    await loadConfig();
    setMessage(
      result.cleared
        ? `Generated config cleared for ${result.itemCount} card(s). You can start full analysis again.`
        : "Config file was not found, nothing to clear."
    );
  } catch (error) {
    setError(error);
  } finally {
    isClearingGeneratedConfig.value = false;
  }
}

async function onInputFiles(event: Event) {
  const target = event.target as HTMLInputElement;
  const files = target.files ? Array.from(target.files) : [];
  lastPickedFiles.value = files.length;

  await uploadMediaFiles(files);
  target.value = "";
}

async function onDrop(event: DragEvent) {
  event.preventDefault();
  isDragOver.value = false;

  const files = event.dataTransfer?.files
    ? Array.from(event.dataTransfer.files)
    : [];

  lastPickedFiles.value = files.length;
  await uploadMediaFiles(files);
}

function updateCardField(
  index: number,
  field: keyof ConfigItem,
  value: string | boolean | string[]
) {
  const item = configItems.value[index];
  if (!item) return;
  (item as Record<string, unknown>)[field] = value;
  syncConfigTextFromData();
}

function getTagsArray(item: ConfigItem): string[] {
  return Array.isArray(item.hashtags)
    ? item.hashtags.filter((tag): tag is string => typeof tag === "string")
    : [];
}

function normalizeTag(value: string): string {
  return value.trim().replace(/^#/, "");
}

function addTagToCard(index: number) {
  const item = configItems.value[index];
  if (!item) return;

  const draft = normalizeTag(tagDraftByIndex[index] || "");
  if (!draft) return;

  const tags = getTagsArray(item);
  if (!tags.includes(draft)) {
    tags.push(draft);
    updateCardField(index, "hashtags", tags);
  }

  tagDraftByIndex[index] = "";
}

function removeTagFromCard(index: number, tag: string) {
  const item = configItems.value[index];
  if (!item) return;

  const tags = getTagsArray(item).filter((current) => current !== tag);
  updateCardField(index, "hashtags", tags);
}

function removeCard(index: number) {
  const data = configData.value as { items?: ConfigItem[] } | null;
  if (!data || !Array.isArray(data.items)) return;
  data.items.splice(index, 1);
  syncConfigTextFromData();
}

function onDragOver(event: DragEvent) {
  event.preventDefault();
  isDragOver.value = true;
}

function onDragLeave() {
  isDragOver.value = false;
}

async function loadConfig() {
  const config = await $fetch<ConfigResponse>("/api/config");
  configPath.value = config.configPath;
  configText.value = config.text;
  configData.value = parseConfigData(config.text);
}

async function saveConfig() {
  isSavingConfig.value = true;

  try {
    syncConfigTextFromData();
    await $fetch("/api/config", {
      method: "PUT",
      body: {
        text: configText.value,
      },
    });

    setMessage("media-config.json updated.");
  } catch (error) {
    setError(error);
  } finally {
    isSavingConfig.value = false;
  }
}

async function loadTaskStatus() {
  const status = await $fetch<TaskStatusResponse>("/api/run/status");
  runningTask.value = status.runningTask;
  isBusy.value = status.isBusy;
}

function stopAnalyzeLiveSync() {
  if (!analyzeLiveSyncTimer) return;
  clearInterval(analyzeLiveSyncTimer);
  analyzeLiveSyncTimer = null;
}

function startAnalyzeLiveSync() {
  stopAnalyzeLiveSync();

  void Promise.all([loadConfig(), loadMedia(), loadTaskStatus()]).catch(() => {});

  analyzeLiveSyncTimer = setInterval(() => {
    if (!isRunningAnalyze.value) return;
    void Promise.all([loadConfig(), loadMedia(), loadTaskStatus()]).catch(() => {});
  }, 1500);
}

async function generateCollectionMeta() {
  const promptText = collectionPrompt.value.trim();
  if (!promptText) {
    setError("Enter a prompt first");
    return;
  }

  isGeneratingCollection.value = true;
  collectionGenTitle.value = "";
  collectionGenDescription.value = "";
  infoMessage.value = "";
  errorMessage.value = "";

  try {
    const res = await $fetch<{ ok: boolean; title: string; description: string }>("/api/run/generate-collection", {
      method: "POST",
      body: { prompt: promptText },
    });
    collectionGenTitle.value = res.title;
    collectionGenDescription.value = res.description;
    setMessage(`Collection meta generated`);
  } catch (err: unknown) {
    setError(err instanceof Error ? err.message : String(err));
  } finally {
    isGeneratingCollection.value = false;
  }
}

async function copyCollectionMeta() {
  const title = collectionGenTitle.value.trim();
  const description = collectionGenDescription.value.trim();

  if (!title && !description) {
    setError("Nothing to copy yet");
    return;
  }

  const text = [`Title: ${title}`, `Description: ${description}`]
    .filter((line) => !line.endsWith(": "))
    .join("\n");

  try {
    await navigator.clipboard.writeText(text);
    setMessage("Collection title and description copied");
  } catch (error) {
    setError(extractErrorMessage(error) || "Clipboard access failed");
  }
}

async function startAnalyze() {
  canResumeAnalyze.value = false;
  isRunningAnalyze.value = true;
  startAnalyzeLiveSync();

  try {
    const result = await $fetch<{
      autoUpload: boolean;
      analyzeOutput: string;
      addTagsOutput: string;
      uploadOutput: string;
    }>("/api/run/analyze", {
      method: "POST",
    });

    runLog.value = result.autoUpload
      ? [
          result.analyzeOutput,
          "----- AUTO ADD TAGS -----",
          result.addTagsOutput,
          "----- AUTO UPLOAD -----",
          result.uploadOutput,
        ]
          .filter(Boolean)
          .join("\n\n")
      : result.analyzeOutput;

    setMessage(
      result.autoUpload
        ? "Analysis completed. Auto upload completed as well."
        : "Analysis completed."
    );

    await Promise.all([loadConfig(), loadMedia(), loadTaskStatus()]);
  } catch (error) {
    const message = extractErrorMessage(error).toLowerCase();
    if (
      message.includes("stopped by user") ||
      message.includes("stop signal sent") ||
      message.includes("499")
    ) {
      canResumeAnalyze.value = true;
      setMessage("Analysis stopped. Click Resume analysis to continue.");
    } else {
      setError(error);
    }
    await loadTaskStatus();
  } finally {
    stopAnalyzeLiveSync();
    isRunningAnalyze.value = false;
  }
}

async function startUpload() {
  isRunningUpload.value = true;

  try {
    const result = await $fetch<{ output: string }>("/api/run/upload", {
      method: "POST",
    });

    runLog.value = result.output;
    setMessage("Upload completed.");

    await Promise.all([loadTaskStatus(), loadMedia()]);
  } catch (error) {
    setError(error);
    await loadTaskStatus();
  } finally {
    isRunningUpload.value = false;
  }
}

async function startAddTags() {
  isRunningAddTags.value = true;

  try {
    const result = await $fetch<{ output: string }>("/api/run/add-tags", {
      method: "POST",
    });

    runLog.value = result.output;
    setMessage("Tags added to configured collections.");

    await Promise.all([loadTaskStatus(), loadConfig()]);
  } catch (error) {
    setError(error);
    await loadTaskStatus();
  } finally {
    isRunningAddTags.value = false;
  }
}

async function stopAnalyze() {
  if (!isRunningAnalyze.value || isStoppingAnalyze.value) return;
  isStoppingAnalyze.value = true;

  try {
    const result = await $fetch<{ ok: boolean; message: string }>("/api/run/stop", {
      method: "POST",
    });

    setMessage(result.message || "Stopping analysis...");
    await loadTaskStatus();
  } catch (error) {
    setError(error);
  } finally {
    isStoppingAnalyze.value = false;
  }
}

async function resumeAnalyze() {
  if (isBusy.value || isRunningAnalyze.value) return;
  await startAnalyze();
}

async function refreshAll() {
  try {
    await Promise.all([
      loadSettings(),
      loadAuthStatus(),
      loadMedia(),
      loadConfig(),
      loadTaskStatus(),
    ]);
  } catch (error) {
    setError(error);
  }
}

watch(
  () => configText.value,
  (value) => {
    if (isSyncingFromData) return;
    const parsed = parseConfigData(value);
    if (parsed) {
      configData.value = parsed;
    }
  }
);

onMounted(async () => {
  await refreshAll();
});

onBeforeUnmount(() => {
  stopAnalyzeLiveSync();
});
</script>

<template>
  <UApp class="studio-ui">
    <div class="studio-shell">
      <!-- ═══════════ TOP BAR ═══════════ -->
      <header class="topbar">
        <div class="topbar-brand">
          <img src="~/assets/images/logo.jpg" class="brand-logo" alt="logo">
          <h1>Only Vitiok</h1>
          <UBadge
            :color="pendingActions ? 'warning' : 'success'"
            variant="subtle"
            size="sm"
          >
            {{ pendingActions ? "⏳ Running" : "✅ Ready" }}
          </UBadge>
        </div>

        <div class="topbar-actions">
          <UBadge color="neutral" variant="soft" size="sm">
            {{ mediaFiles.length }} files
          </UBadge>
          <UBadge color="neutral" variant="soft" size="sm">
            {{ configItems.length }} cards
          </UBadge>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-file-json-2"
            size="sm"
            @click="isConfigDrawerOpen = true"
          />
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-logs"
            size="sm"
            @click="isLogsDrawerOpen = true"
          />
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-settings-2"
            size="sm"
            @click="isSettingsOpen = true"
          />
        </div>
      </header>

      <div class="studio-layout">
        <!-- ═══════════ LEFT SIDEBAR ═══════════ -->
        <aside class="left-sidebar">
          <!-- Auth -->
          <div class="sidebar-section">
            <div class="sidebar-section-head">
              <span class="sidebar-section-icon">🔐</span>
              <span class="sidebar-section-label">Auth</span>
              <UBadge
                :color="stateExists ? 'success' : loginSessionActive ? 'warning' : 'neutral'"
                variant="subtle"
                size="sm"
              >
                {{ stateExists ? 'Active' : loginSessionActive ? 'Pending' : 'None' }}
              </UBadge>
            </div>
            <UButton
              class="w-full"
              size="md"
              :color="loginButtonColor"
              :variant="stateExists ? 'soft' : 'solid'"
              icon="i-lucide-key-round"
              :loading="isHandlingLogin"
              :disabled="isHandlingLogin"
              @click="handleLoginButton"
            >
              {{ loginButtonText }}
            </UButton>
          </div>

          <!-- Workflow -->
          <div class="sidebar-section">
            <div class="sidebar-section-head">
              <span class="sidebar-section-icon">⚡</span>
              <span class="sidebar-section-label">Pipeline</span>
            </div>

            <div class="sidebar-actions">
              <UButton
                class="w-full action-btn-primary"
                size="lg"
                color="primary"
                icon="i-lucide-sparkles"
                :loading="isRunningAnalyze"
                :disabled="isBusy || isRunningAnalyze"
                @click="startAnalyze"
              >
                Analyze
              </UButton>

              <div class="sidebar-actions-row">
                <UButton
                  class="flex-1"
                  size="md"
                  color="neutral"
                  variant="soft"
                  icon="i-lucide-cloud-upload"
                  :loading="isRunningUpload"
                  :disabled="isBusy || isRunningUpload"
                  @click="startUpload"
                >
                  Upload
                </UButton>
                <UButton
                  class="flex-1"
                  size="md"
                  color="neutral"
                  variant="soft"
                  icon="i-lucide-tags"
                  :loading="isRunningAddTags"
                  :disabled="isBusy || isRunningAddTags"
                  @click="startAddTags"
                >
                  Tags
                </UButton>
              </div>

              <UCheckbox
                v-model="autoUploadAfterAnalyze"
                label="Auto-upload after analyze"
                class="sidebar-checkbox"
              />

              <div class="tag-limit-toggle">
                <span class="tag-limit-label">Global tags</span>
                <div class="mode-toggle">
                  <UButton
                    size="xs"
                    :variant="globalTagLimit === 15 ? 'solid' : 'ghost'"
                    :color="globalTagLimit === 15 ? 'primary' : 'neutral'"
                    @click="globalTagLimit = 15"
                  >
                    15
                  </UButton>
                  <UButton
                    size="xs"
                    :variant="globalTagLimit === 100 ? 'solid' : 'ghost'"
                    :color="globalTagLimit === 100 ? 'primary' : 'neutral'"
                    @click="globalTagLimit = 100"
                  >
                    100
                  </UButton>
                </div>
              </div>
            </div>
          </div>

          <!-- Collection Meta Generator -->
          <div class="sidebar-section">
            <div class="sidebar-section-head">
              <span class="sidebar-section-icon">✍️</span>
              <span class="sidebar-section-label">Meta Generator</span>
            </div>

            <div class="meta-gen-form">
              <UInput
                v-model="collectionPrompt"
                size="md"
                icon="i-lucide-flame"
                placeholder="Persian Baby photo leaks Part 1"
              />
              <UButton
                class="w-full"
                color="primary"
                variant="soft"
                size="md"
                icon="i-lucide-sparkles"
                :loading="isGeneratingCollection"
                :disabled="isGeneratingCollection || !collectionPrompt.trim()"
                @click="generateCollectionMeta"
              >
                Generate title & description
              </UButton>
            </div>

            <div v-if="collectionGenTitle" class="meta-gen-result">
              <div class="meta-gen-field">
                <span class="meta-gen-label">Title</span>
                <div class="meta-gen-text">{{ collectionGenTitle }}</div>
              </div>
              <div class="meta-gen-field">
                <span class="meta-gen-label">Description</span>
                <div class="meta-gen-text">{{ collectionGenDescription }}</div>
              </div>
              <UButton
                class="w-full"
                size="sm"
                color="neutral"
                variant="soft"
                icon="i-lucide-copy"
                @click="copyCollectionMeta"
              >
                Copy both
              </UButton>
            </div>
          </div>
        </aside>

        <!-- ═══════════ MAIN CONTENT ═══════════ -->
        <main class="center-content">
          <!-- Alerts -->
          <Transition name="fade">
            <UAlert
              v-if="infoMessage"
              color="success"
              variant="subtle"
              icon="i-lucide-check-circle-2"
              :title="infoMessage"
              class="alert-toast"
            />
          </Transition>

          <Transition name="fade">
            <UAlert
              v-if="errorMessage"
              color="error"
              variant="subtle"
              icon="i-lucide-circle-alert"
              :title="errorMessage"
              class="alert-toast"
            />
          </Transition>

          <!-- ═══════════ UPLOAD COLLECTIONS ═══════════ -->
          <div class="panel collections-panel">
            <div class="panel-header">
              <div class="panel-header-left">
                <h2 class="panel-title">📦 Collections</h2>
                <UBadge v-if="isSavingCreateUrl" color="primary" variant="soft" size="sm">
                  saving...
                </UBadge>
              </div>
              <div class="panel-header-right">
                <div class="mode-toggle">
                  <UButton
                    :color="uploadDistributionMode === 'range' ? 'primary' : 'neutral'"
                    :variant="uploadDistributionMode === 'range' ? 'solid' : 'ghost'"
                    size="xs"
                    @click="uploadDistributionMode = 'range'; debouncedSaveCollections()"
                  >
                    Range
                  </UButton>
                  <UButton
                    :color="uploadDistributionMode === 'even' ? 'primary' : 'neutral'"
                    :variant="uploadDistributionMode === 'even' ? 'solid' : 'ghost'"
                    size="xs"
                    @click="uploadDistributionMode = 'even'; debouncedSaveCollections()"
                  >
                    Even
                  </UButton>
                </div>
                <UButton
                  color="neutral"
                  variant="soft"
                  size="sm"
                  icon="i-lucide-plus"
                  @click="addUploadCollection"
                >
                  Add
                </UButton>
              </div>
            </div>

            <div v-if="!uploadCollections.length" class="empty-state-mini">
              No collections — click <strong>Add</strong> to start
            </div>

            <div v-else class="collections-grid">
              <div
                v-for="(target, index) in uploadCollections"
                :key="`upload-target-${index}`"
                class="col-card"
                :class="{ 'col-card-has-plan': plannedUploadBreakdown.targets[index] }"
              >
                <!-- Card header -->
                <div class="col-card-head">
                  <span class="col-card-num">{{ index + 1 }}</span>
                  <UButton
                    color="error"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-trash-2"
                    square
                    @click="removeUploadCollection(index)"
                  />
                </div>

                <!-- URL input -->
                <UInput
                  :model-value="target.createUrl"
                  size="lg"
                  icon="i-lucide-link-2"
                  placeholder="Paste collection URL..."
                  @update:model-value="handleCollectionUrlInput(index, String($event))"
                />

                <!-- Extracted collection ID -->
                <div v-if="target.collectionId" class="col-card-id">
                  <span class="col-card-id-label">ID</span>
                  <span class="col-card-id-value">{{ target.collectionId }}</span>
                </div>

                <!-- Range inputs (only in range mode) -->
                <div v-if="uploadDistributionMode === 'range'" class="col-card-range">
                  <div class="col-card-range-field">
                    <label class="col-card-range-label">From</label>
                    <UInput
                      :model-value="target.rangeStart == null ? '' : String(target.rangeStart)"
                      type="number"
                      size="md"
                      min="1"
                      placeholder="1"
                      @update:model-value="updateUploadCollectionRangePoint(index, 'rangeStart', $event)"
                    />
                  </div>
                  <div class="col-card-range-field">
                    <label class="col-card-range-label">To</label>
                    <UInput
                      :model-value="target.rangeEnd == null ? '' : String(target.rangeEnd)"
                      type="number"
                      size="md"
                      min="1"
                      placeholder="∞"
                      @update:model-value="updateUploadCollectionRangePoint(index, 'rangeEnd', $event)"
                    />
                  </div>
                </div>

                <!-- Inline distribution info -->
                <div v-if="plannedUploadBreakdown.targets[index]" class="col-card-plan">
                  <span class="col-card-plan-range">
                    {{ plannedUploadBreakdown.targets[index].rangeText }}
                  </span>
                  <span class="col-card-plan-count">
                    {{ plannedUploadBreakdown.targets[index].assignedCount }} items
                  </span>
                </div>
              </div>
            </div>

            <!-- Total assigned summary -->
            <div v-if="plannedUploadBreakdown.targets.length" class="col-total-bar">
              <span class="col-total-label">Total assigned</span>
              <span class="col-total-value">
                {{ plannedUploadBreakdown.assignedCount }} / {{ configItems.length }}
              </span>
              <span v-if="plannedUploadBreakdown.unassignedCount" class="col-total-unassigned">
                ({{ plannedUploadBreakdown.unassignedCount }} unassigned)
              </span>
            </div>
          </div>

          <!-- ═══════════ DROPZONE ═══════════ -->
          <div class="panel">
            <div class="panel-header">
              <div class="panel-header-left">
                <h2 class="panel-title">📁 Media</h2>
                <UBadge color="neutral" variant="soft" size="sm">
                  {{ mediaFiles.length }} files
                </UBadge>
              </div>
              <div class="panel-header-right">
                <UButton
                  color="primary"
                  variant="soft"
                  size="xs"
                  icon="i-lucide-scan-search"
                  :loading="isScanningMedia"
                  :disabled="isBusy || isScanningMedia || isClearingGeneratedConfig"
                  @click="scanMedia"
                >
                  Scan
                </UButton>
                <UButton
                  color="warning"
                  variant="soft"
                  size="xs"
                  icon="i-lucide-eraser"
                  :loading="isClearingGeneratedConfig"
                  :disabled="isBusy || isClearingMedia || isClearingGeneratedConfig"
                  @click="clearGeneratedConfig"
                >
                  Clear config
                </UButton>
                <UButton
                  color="error"
                  variant="soft"
                  size="xs"
                  icon="i-lucide-trash-2"
                  :loading="isClearingMedia"
                  :disabled="isBusy || isClearingMedia || isClearingGeneratedConfig"
                  @click="clearAllMedia"
                >
                  Clear all
                </UButton>
              </div>
            </div>

            <div
              class="dropzone"
              :class="{ 'is-drag-over': isDragOver }"
              @drop="onDrop"
              @dragover="onDragOver"
              @dragleave="onDragLeave"
            >
              <div class="dropzone-content">
                <UIcon name="i-lucide-upload-cloud" class="dropzone-icon" />
                <p class="dropzone-text">Drop files here or click to upload</p>
                <UButton
                  size="sm"
                  color="primary"
                  variant="soft"
                  icon="i-lucide-upload"
                  :loading="isUploadingMedia"
                  @click="openFileDialog"
                >
                  Select files
                </UButton>
              </div>
              <input
                ref="fileInputRef"
                class="hidden-file-input"
                type="file"
                multiple
                @change="onInputFiles"
              >
            </div>

            <!-- Global tags -->
            <div v-if="globalTags.length" class="global-tags">
              <div class="global-tags-head">
                <span class="panel-subtitle">Global tags</span>
                <UBadge color="neutral" variant="soft" size="sm">{{ globalTags.length }}</UBadge>
              </div>
              <div class="tag-list">
                <UBadge
                  v-for="tag in globalTags"
                  :key="`global-${tag}`"
                  class="tag-badge"
                  color="primary"
                  variant="soft"
                  size="sm"
                >
                  #{{ tag }}
                </UBadge>
              </div>
            </div>
          </div>

          <!-- ═══════════ ANALYSIS PROGRESS ═══════════ -->
          <div v-if="isRunningAnalyze || canResumeAnalyze" class="panel analysis-panel">
            <div class="analysis-bar">
              <div class="analysis-info">
                <span class="analysis-status">
                  {{ isRunningAnalyze ? "⏳ Analyzing..." : "⏸️ Paused" }}
                </span>
                <span class="muted-text small-text">
                  {{ analysisProgress.done }}/{{ analysisProgress.total }}
                  ({{ analysisProgress.percent }}%)
                </span>
              </div>
              <UButton
                v-if="isRunningAnalyze"
                color="error"
                variant="soft"
                size="xs"
                icon="i-lucide-square"
                :loading="isStoppingAnalyze"
                :disabled="isStoppingAnalyze"
                @click="stopAnalyze"
              >
                Stop
              </UButton>
              <UButton
                v-else
                color="primary"
                variant="soft"
                size="xs"
                icon="i-lucide-play"
                :disabled="isBusy || isRunningAnalyze"
                @click="resumeAnalyze"
              >
                Resume
              </UButton>
            </div>
            <UProgress :model-value="analysisProgress.percent" size="sm" />
          </div>

          <!-- ═══════════ MEDIA CARDS GRID ═══════════ -->
          <div v-if="configItems.length" class="media-pagination-bar">
            <span class="muted-text small-text">
              {{ configItems.length }} items total — page {{ mediaPage }}/{{ mediaTotalPages }}
            </span>
            <div class="media-pagination-btns">
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-chevrons-left"
                :disabled="mediaPage <= 1"
                @click="mediaPage = 1"
              />
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-chevron-left"
                :disabled="mediaPage <= 1"
                @click="mediaPage = Math.max(1, mediaPage - 1)"
              />
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-chevron-right"
                :disabled="mediaPage >= mediaTotalPages"
                @click="mediaPage = Math.min(mediaTotalPages, mediaPage + 1)"
              />
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-chevrons-right"
                :disabled="mediaPage >= mediaTotalPages"
                @click="mediaPage = mediaTotalPages"
              />
            </div>
          </div>

          <div class="media-cards">
            <div
              v-for="(item, pIndex) in paginatedItems"
              :key="item.filePath || item.fileName || pIndex"
              class="media-card-item"
              :class="{ 'is-vip': item.vip }"
            >
              <!-- Preview -->
              <div class="media-preview">
                <UButton
                  class="delete-card-btn"
                  color="error"
                  variant="solid"
                  size="xs"
                  square
                  @click.stop="removeCard((mediaPage - 1) * MEDIA_PAGE_SIZE + pIndex)"
                >
                  <UIcon name="i-lucide-x" class="size-3" />
                </UButton>

                <img
                  v-if="isImageItem(item)"
                  :src="getAssetUrl(item)"
                  alt=""
                  loading="lazy"
                >
                <video
                  v-else-if="isVideoItem(item)"
                  :src="getAssetUrl(item)"
                  :poster="getPosterUrl(item)"
                  preload="metadata"
                  muted
                  playsinline
                />
                <div v-else class="media-preview-fallback">?</div>

                <div v-if="isVideoItem(item)" class="media-type-badge">
                  <UIcon name="i-lucide-video" class="size-3" />
                </div>
              </div>

              <!-- Card body -->
              <div class="media-card-body">
                <!-- VIP + index row -->
                <div class="card-top-row">
                  <span class="card-index">#{{ (mediaPage - 1) * MEDIA_PAGE_SIZE + pIndex + 1 }}</span>
                  <button
                    class="vip-toggle"
                    :class="{ active: item.vip }"
                    @click="updateCardField((mediaPage - 1) * MEDIA_PAGE_SIZE + pIndex, 'vip', !item.vip)"
                  >
                    {{ item.vip ? '★ VIP' : '☆ VIP' }}
                  </button>
                </div>

                <UInput
                  :model-value="item.title || ''"
                  size="sm"
                  placeholder="Title"
                  :maxlength="60"
                  @update:model-value="updateCardField((mediaPage - 1) * MEDIA_PAGE_SIZE + pIndex, 'title', String($event).slice(0, 60))"
                />
                <UTextarea
                  :model-value="item.description || ''"
                  :rows="2"
                  autoresize
                  size="sm"
                  placeholder="Description"
                  @update:model-value="updateCardField((mediaPage - 1) * MEDIA_PAGE_SIZE + pIndex, 'description', $event)"
                />

                <!-- Tags -->
                <div class="tag-list">
                  <UBadge
                    v-for="tag in getTagsArray(item)"
                    :key="`${pIndex}-${tag}`"
                    class="tag-badge"
                    color="primary"
                    variant="soft"
                    size="sm"
                    @click="removeTagFromCard((mediaPage - 1) * MEDIA_PAGE_SIZE + pIndex, tag)"
                  >
                    #{{ tag }}
                  </UBadge>
                </div>
                <div class="tag-input-row">
                  <UInput
                    v-model="tagDraftByIndex[(mediaPage - 1) * MEDIA_PAGE_SIZE + pIndex]"
                    size="sm"
                    placeholder="+ tag"
                    @keyup.enter="addTagToCard((mediaPage - 1) * MEDIA_PAGE_SIZE + pIndex)"
                  />
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-plus"
                    square
                    @click="addTagToCard((mediaPage - 1) * MEDIA_PAGE_SIZE + pIndex)"
                  />
                </div>

                <!-- AI Vision -->
                <div v-if="item.contentSummary" class="ai-vision">
                  <span class="ai-vision-icon">👁️</span>
                  <span class="ai-vision-text">{{ item.contentSummary }}</span>
                </div>

                <!-- Trends -->
                <div v-if="item.trendTermsUsed?.length || item.trendScore" class="trend-section">
                  <div class="trend-header">
                    <span class="trend-label">📈</span>
                    <UBadge
                      v-if="item.trendScore"
                      :color="item.trendScore >= 60 ? 'success' : item.trendScore >= 30 ? 'warning' : 'neutral'"
                      variant="soft"
                      size="sm"
                    >
                      {{ item.trendScore }}/100
                    </UBadge>
                  </div>
                  <div v-if="item.trendTermsUsed?.length" class="trend-terms">
                    <UBadge
                      v-for="term in item.trendTermsUsed"
                      :key="`trend-${pIndex}-${term}`"
                      color="success"
                      variant="subtle"
                      size="sm"
                    >
                      {{ term }}
                    </UBadge>
                  </div>
                </div>
              </div>
            </div>

            <div v-if="!configItems.length" class="empty-state">
              <UIcon name="i-lucide-image-off" class="empty-icon" />
              <p>No items yet. Drop files and run analysis.</p>
            </div>
          </div>

          <div v-if="configItems.length > MEDIA_PAGE_SIZE" class="media-pagination-bar bottom">
            <span class="muted-text small-text">
              Page {{ mediaPage }} of {{ mediaTotalPages }}
            </span>
            <div class="media-pagination-btns">
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-chevron-left"
                :disabled="mediaPage <= 1"
                @click="mediaPage = Math.max(1, mediaPage - 1)"
              />
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-chevron-right"
                :disabled="mediaPage >= mediaTotalPages"
                @click="mediaPage = Math.min(mediaTotalPages, mediaPage + 1)"
              />
            </div>
          </div>
        </main>
      </div>
    </div>

    <!-- ═══════════ SETTINGS DRAWER ═══════════ -->
    <UDrawer
      v-model:open="isSettingsOpen"
      title="⚙️ Settings"
      :ui="{ content: '!max-w-none !w-screen !h-screen !rounded-none' }"
    >
      <template #body>
        <div class="drawer-body">
          <div class="triple-grid">
            <div class="field-block">
              <p class="field-label">BASE_URL</p>
              <UInput v-model="baseUrl" size="lg" placeholder="https://collections.only-nice.com" />
            </div>

            <div class="field-block">
              <p class="field-label">PRIMARY COLLECTION</p>
              <UInput
                :model-value="normalizedUploadCollections[0]?.collectionId || ''"
                size="lg"
                readonly
                placeholder="Synced from upload collections"
              />
            </div>

            <div class="field-block field-action">
              <p class="muted-text small-text">
                CREATE_URL and COLLECTION_ID sync from the first upload collection on save.
              </p>
            </div>
          </div>

          <div class="env-list">
            <div v-for="key in envKeys" :key="key" class="env-item">
              <UBadge color="neutral" variant="outline" size="sm">{{ key }}</UBadge>
              <div class="env-input-row">
                <UInput v-model="envMap[key]" size="lg" />
                <UButton
                  color="error"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  aria-label="Delete"
                  @click="removeEnvField(key)"
                />
              </div>
            </div>
          </div>

          <div class="triple-grid">
            <div class="field-block">
              <p class="field-label">NEW KEY</p>
              <UInput v-model="newEnvKey" size="lg" placeholder="NEW_ENV_KEY" />
            </div>
            <div class="field-block">
              <p class="field-label">VALUE</p>
              <UInput v-model="newEnvValue" size="lg" placeholder="value" />
            </div>
            <div class="field-block field-action">
              <UButton
                class="w-full"
                size="lg"
                color="neutral"
                variant="soft"
                icon="i-lucide-plus"
                @click="addEnvField"
              >
                Add field
              </UButton>
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="drawer-footer">
          <UButton
            class="w-full"
            size="lg"
            color="primary"
            icon="i-lucide-save"
            :loading="isSavingSettings"
            @click="saveSettings"
          >
            Save settings
          </UButton>
        </div>
      </template>
    </UDrawer>

    <!-- ═══════════ CONFIG DRAWER ═══════════ -->
    <UDrawer
      v-model:open="isConfigDrawerOpen"
      title="📄 Config Editor"
      :ui="{ content: '!max-w-none !w-screen !h-screen !rounded-none' }"
    >
      <template #body>
        <div class="drawer-body">
          <UBadge color="neutral" variant="soft" size="sm">{{ configPath || "no file" }}</UBadge>
          <UTextarea
            v-model="configText"
            class="drawer-textarea"
            autoresize
            :rows="28"
            placeholder="media-config.json"
          />
        </div>
      </template>
      <template #footer>
        <div class="drawer-actions">
          <UButton class="w-full" size="lg" color="neutral" variant="soft" icon="i-lucide-refresh-ccw" @click="loadConfig">
            Refresh
          </UButton>
          <UButton class="w-full" size="lg" color="primary" icon="i-lucide-file-check-2" :loading="isSavingConfig" @click="saveConfig">
            Save config
          </UButton>
        </div>
      </template>
    </UDrawer>

    <!-- ═══════════ LOGS DRAWER ═══════════ -->
    <UDrawer
      v-model:open="isLogsDrawerOpen"
      title="📋 Run Log"
      :ui="{ content: '!max-w-none !w-screen !h-screen !rounded-none' }"
    >
      <template #body>
        <div class="drawer-body">
          <UBadge color="primary" variant="soft" size="sm">Live</UBadge>
          <UTextarea
            class="drawer-textarea"
            readonly
            autoresize
            :rows="28"
            :model-value="runLog || 'No logs yet'"
          />
        </div>
      </template>
      <template #footer>
        <div class="drawer-actions">
          <UButton class="w-full" size="lg" color="neutral" variant="soft" icon="i-lucide-refresh-ccw" @click="loadTaskStatus">
            Refresh
          </UButton>
        </div>
      </template>
    </UDrawer>
  </UApp>
</template>

<style scoped>
/* ═══════════ GLOBALS ═══════════ */
.studio-ui {
  min-height: 100vh;
  color: var(--text-primary);
  background: var(--bg-body);
}

.studio-shell {
  max-width: 1800px;
  margin: 0 auto;
  padding: 10px 14px;
  display: grid;
  gap: 10px;
}

/* ═══════════ TOP BAR ═══════════ */
.topbar {
  border: 1px solid var(--border-default);
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.85));
  backdrop-filter: blur(16px);
  padding: 10px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  position: sticky;
  top: 0;
  z-index: 50;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
}

.topbar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
}

.brand-icon {
  font-size: 1.4rem;
}

.brand-logo {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  object-fit: cover;
  border: 2px solid rgba(56, 189, 248, 0.4);
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.2);
  flex-shrink: 0;
}

.topbar-brand h1 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  background: linear-gradient(135deg, #38bdf8, #7dd3fc);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* ═══════════ LAYOUT ═══════════ */
.studio-layout {
  display: grid;
  gap: 10px;
  grid-template-columns: 270px minmax(0, 1fr);
}

/* ═══════════ SIDEBAR ═══════════ */
.left-sidebar {
  display: grid;
  align-content: start;
  gap: 0;
  position: sticky;
  top: 68px;
  max-height: calc(100vh - 80px);
  overflow-y: auto;
  scrollbar-width: thin;
  border: 1px solid var(--border-default);
  border-radius: 12px;
  background: linear-gradient(180deg, var(--bg-surface), rgba(11, 17, 32, 0.95));
  backdrop-filter: blur(12px);
}

.sidebar-section {
  padding: 14px;
  border-bottom: 1px solid var(--border-default);
}

.sidebar-section:last-child {
  border-bottom: none;
}

.sidebar-section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.sidebar-section-icon {
  font-size: 1rem;
}

.sidebar-section-label {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--text-secondary);
  flex: 1;
}

.sidebar-actions {
  display: grid;
  gap: 8px;
}

.sidebar-actions-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.sidebar-checkbox {
  padding: 2px 0;
}

.tag-limit-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 0;
}

.tag-limit-label {
  font-size: 0.72rem;
  color: var(--text-secondary);
}

.action-btn-primary {
  font-weight: 700;
}

/* ═══════════ META GENERATOR ═══════════ */
.meta-gen-form {
  display: grid;
  gap: 8px;
}

.meta-gen-result {
  margin-top: 10px;
  display: grid;
  gap: 8px;
}

.meta-gen-field {
  display: grid;
  gap: 3px;
}

.meta-gen-label {
  font-size: 0.65rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  font-weight: 600;
}

.meta-gen-text {
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--bg-body);
  border: 1px solid var(--border-default);
  font-size: 0.8rem;
  line-height: 1.45;
  user-select: all;
  word-break: break-word;
  color: var(--text-primary);
}

/* ═══════════ CENTER CONTENT ═══════════ */
.center-content {
  display: grid;
  align-content: start;
  gap: 10px;
}

/* ═══════════ PANELS ═══════════ */
.panel {
  border: 1px solid var(--border-default);
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.6));
  backdrop-filter: blur(8px);
  padding: 16px;
  display: grid;
  gap: 12px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.panel-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel-header-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.panel-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
}

.panel-subtitle {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
}

/* ═══════════ COLLECTIONS ═══════════ */
.mode-toggle {
  display: flex;
  gap: 2px;
  border-radius: 6px;
  background: var(--bg-body);
  padding: 2px;
}

.collections-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 10px;
}

.col-card {
  display: grid;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--border-default);
  border-radius: 10px;
  background: linear-gradient(150deg, rgba(15, 23, 42, 0.8), rgba(30, 41, 59, 0.4));
  transition: border-color 0.15s ease;
}

.col-card:hover {
  border-color: var(--border-hover);
}

.col-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.col-card-num {
  font-size: 1.1rem;
  font-weight: 800;
  color: var(--accent);
}

.col-card-range {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.col-card-range-field {
  display: grid;
  gap: 3px;
}

.col-card-range-label {
  font-size: 0.65rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.col-card-id {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--bg-body);
  border: 1px solid var(--border-default);
}

.col-card-id-label {
  font-size: 0.6rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-muted);
  flex-shrink: 0;
}

.col-card-id-value {
  font-size: 0.72rem;
  font-family: ui-monospace, 'SF Mono', Consolas, monospace;
  color: var(--accent);
  word-break: break-all;
}

.col-card-plan {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--accent-soft);
  border: 1px solid var(--accent-glow);
}

.col-card-plan-range {
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.col-card-plan-count {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--accent);
}

.col-total-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--bg-body);
  border: 1px solid var(--border-default);
}

.col-total-label {
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.col-total-value {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--text-primary);
}

.col-total-unassigned {
  font-size: 0.72rem;
  color: var(--text-muted);
}

.empty-state-mini {
  padding: 24px;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.85rem;
}

/* ═══════════ DROPZONE ═══════════ */
.dropzone {
  border: 2px dashed rgba(56, 189, 248, 0.25);
  border-radius: 12px;
  padding: 28px;
  display: grid;
  place-items: center;
  min-height: 120px;
  transition: all 0.2s ease;
  cursor: pointer;
  background: transparent;
}

.dropzone.is-drag-over {
  border-color: var(--accent);
  background: rgba(56, 189, 248, 0.06);
  box-shadow: inset 0 0 32px rgba(56, 189, 248, 0.04);
}

.dropzone-content {
  display: grid;
  place-items: center;
  gap: 8px;
}

.dropzone-icon {
  font-size: 2rem;
  color: var(--text-muted);
}

.dropzone-text {
  margin: 0;
  font-size: 0.82rem;
  color: var(--text-secondary);
}

.hidden-file-input {
  display: none;
}

/* ═══════════ GLOBAL TAGS ═══════════ */
.global-tags {
  border: 1px solid var(--border-default);
  border-radius: 10px;
  background: var(--bg-body);
  padding: 10px;
  display: grid;
  gap: 8px;
}

.global-tags-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* ═══════════ ANALYSIS ═══════════ */
.analysis-panel {
  border-color: rgba(56, 189, 248, 0.3);
  background: linear-gradient(135deg, rgba(56, 189, 248, 0.04), rgba(15, 23, 42, 0.9));
}

.analysis-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.analysis-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.analysis-status {
  font-weight: 700;
  font-size: 0.88rem;
}

/* ═══════════ PAGINATION ═══════════ */
.media-pagination-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 10px;
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
}

.media-pagination-bar.bottom {
  margin-top: 4px;
}

.media-pagination-btns {
  display: flex;
  gap: 2px;
}

/* ═══════════ MEDIA CARDS ═══════════ */
.media-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
  padding-right: 2px;
}

.media-card-item {
  border: 1px solid var(--border-default);
  border-radius: 10px;
  background: var(--bg-surface);
  overflow: hidden;
  transition: border-color 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease;
}

.media-card-item:hover {
  border-color: var(--border-hover);
  transform: translateY(-1px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
}

.media-card-item.is-vip {
  border-color: rgba(245, 158, 11, 0.45);
  box-shadow: 0 0 14px rgba(245, 158, 11, 0.08);
}

.media-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 5;
  overflow: hidden;
  background: var(--bg-body);
}

.media-preview img,
.media-preview video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.media-preview-fallback {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--text-muted);
  font-size: 1.5rem;
}

.delete-card-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 6;
  width: 24px;
  min-width: 24px;
  height: 24px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.media-card-item:hover .delete-card-btn {
  opacity: 1;
}

.media-type-badge {
  position: absolute;
  bottom: 6px;
  right: 6px;
  z-index: 4;
  padding: 3px 6px;
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(6px);
  color: var(--text-secondary);
}

.media-card-body {
  padding: 10px;
  display: grid;
  gap: 6px;
}

.card-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.card-index {
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--text-muted);
}

.vip-toggle {
  all: unset;
  cursor: pointer;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--border-default);
  color: var(--text-muted);
  background: transparent;
  transition: all 0.15s ease;
}

.vip-toggle:hover {
  border-color: var(--vip-color);
  color: var(--vip-color);
}

.vip-toggle.active {
  border-color: var(--vip-color);
  color: var(--bg-body);
  background: var(--vip-color);
}

/* ═══════════ TAGS ═══════════ */
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-height: 22px;
}

.tag-badge {
  cursor: pointer;
  font-size: 0.68rem;
}

.tag-input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px;
  align-items: center;
}

/* ═══════════ AI VISION ═══════════ */
.ai-vision {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--accent-soft);
  border: 1px solid var(--accent-glow);
  font-size: 0.72rem;
  line-height: 1.4;
}

.ai-vision-icon {
  flex-shrink: 0;
}

.ai-vision-text {
  color: var(--text-secondary);
}

/* ═══════════ TRENDS ═══════════ */
.trend-section {
  display: grid;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--bg-body);
  border: 1px solid var(--border-default);
}

.trend-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.trend-label {
  font-size: 0.75rem;
}

.trend-terms {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

/* ═══════════ ALERTS ═══════════ */
.alert-toast {
  border-radius: 10px;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* ═══════════ EMPTY STATE ═══════════ */
.empty-state {
  grid-column: 1 / -1;
  display: grid;
  place-items: center;
  gap: 10px;
  padding: 48px 24px;
  color: var(--text-muted);
  text-align: center;
}

.empty-icon {
  font-size: 2.5rem;
  color: var(--text-muted);
}

/* ═══════════ DRAWERS ═══════════ */
.drawer-body {
  display: grid;
  gap: 16px;
  padding: 6px 2px;
}

.drawer-footer {
  width: 100%;
}

.drawer-actions {
  width: 100%;
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.drawer-textarea :deep(textarea) {
  width: 100%;
  min-height: min(76vh, 1080px);
}

/* ═══════════ SETTINGS ═══════════ */
.triple-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.field-block {
  display: grid;
  gap: 8px;
}

.field-label {
  margin: 0;
  font-size: 0.65rem;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-muted);
  font-weight: 600;
}

.field-action {
  align-content: end;
}

.env-list {
  display: grid;
  gap: 12px;
  max-height: 420px;
  overflow: auto;
  padding-right: 4px;
}

.env-item {
  display: grid;
  gap: 8px;
}

.env-input-row {
  display: grid;
  gap: 8px;
  grid-template-columns: minmax(0, 1fr) auto;
}

/* ═══════════ UTILITY ═══════════ */
.muted-text {
  margin: 0;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.small-text {
  font-size: 0.72rem;
}

.flex-1 {
  flex: 1;
}

/* ═══════════ RESPONSIVE ═══════════ */
@media (max-width: 1200px) {
  .studio-layout {
    grid-template-columns: 250px minmax(0, 1fr);
  }
}

@media (max-width: 900px) {
  .studio-shell {
    padding: 8px;
  }

  .topbar {
    flex-direction: column;
    align-items: stretch;
  }

  .studio-layout {
    grid-template-columns: 1fr;
  }

  .left-sidebar {
    position: static;
    max-height: none;
  }

  .drawer-actions {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .media-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .panel-header {
    flex-direction: column;
    align-items: stretch;
  }

  .panel-header-right {
    justify-content: flex-start;
  }
}
</style>
