<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";

interface SettingsResponse {
  env: Record<string, string>;
  envText: string;
  collectionId: string;
  autoUploadAfterAnalyze: boolean;
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
  vip?: boolean;
}

interface TaskStatusResponse {
  runningTask: string | null;
  isBusy: boolean;
  stopRequested?: boolean;
}

const envMap = reactive<Record<string, string>>({});
const collectionId = ref("");
const autoUploadAfterAnalyze = ref(false);

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
const isConfigDrawerOpen = ref(false);
const isLogsDrawerOpen = ref(false);
const canResumeAnalyze = ref(false);

const newEnvKey = ref("");
const newEnvValue = ref("");
const lastPickedFiles = ref(0);
const fileInputRef = ref<HTMLInputElement | null>(null);
const tagDraftByIndex = reactive<Record<number, string>>({});
let analyzeLiveSyncTimer: ReturnType<typeof setInterval> | null = null;

const MANAGED_ENV_KEYS = new Set([
  "BASE_URL",
  "COLLECTION_ID",
  "CREATE_URL",
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

const createUrl = computed({
  get: () => envMap.CREATE_URL || "",
  set: (value: string) => {
    envMap.CREATE_URL = value;
  },
});

const loginStatusText = computed(() => {
  if (stateExists.value) return "Logged in (state.json found)";
  if (loginSessionActive.value) return "Login session is active";
  return "Not logged in";
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

const pickedFileText = computed(() => {
  if (!lastPickedFiles.value) return "No file selected";
  return `${lastPickedFiles.value} file(s) selected`;
});

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

function syncConfigTextFromData() {
  if (!configData.value) return;
  configText.value = JSON.stringify(configData.value, null, 2);
}

function deriveCreateUrl(base: string, collection: string): string {
  const trimmedBase = String(base || "").replace(/\/+$/, "");
  const trimmedCollection = String(collection || "").trim();

  if (!trimmedBase || !trimmedCollection) return "";
  return `${trimmedBase}/collection/${trimmedCollection}`;
}

function applyCollectionToCreateUrl() {
  const generated = deriveCreateUrl(baseUrl.value, collectionId.value);
  if (generated) createUrl.value = generated;
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
  collectionId.value = settings.collectionId || "";
  autoUploadAfterAnalyze.value = settings.autoUploadAfterAnalyze;
  envMap.AUTO_UPLOAD_AFTER_ANALYZE = settings.autoUploadAfterAnalyze
    ? "true"
    : "false";
}

async function saveSettings() {
  isSavingSettings.value = true;

  try {
    envMap.AUTO_UPLOAD_AFTER_ANALYZE = autoUploadAfterAnalyze.value
      ? "true"
      : "false";

    const saved = await $fetch<SettingsResponse>("/api/settings", {
      method: "PUT",
      body: {
        env: cloneEnvMap(),
        collectionId: collectionId.value,
        autoUploadAfterAnalyze: autoUploadAfterAnalyze.value,
      },
    });

    resetEnv(saved.env);
    collectionId.value = saved.collectionId;
    autoUploadAfterAnalyze.value = saved.autoUploadAfterAnalyze;
    isSettingsOpen.value = false;
    setMessage("Settings saved.");
  } catch (error) {
    setError(error);
  } finally {
    isSavingSettings.value = false;
  }
}

async function saveCreateUrl() {
  isSavingCreateUrl.value = true;

  try {
    const saved = await $fetch<SettingsResponse>("/api/settings", {
      method: "PUT",
      body: {
        env: cloneEnvMap(),
        collectionId: collectionId.value,
        autoUploadAfterAnalyze: autoUploadAfterAnalyze.value,
      },
    });

    resetEnv(saved.env);
    collectionId.value = saved.collectionId;
    autoUploadAfterAnalyze.value = saved.autoUploadAfterAnalyze;
    setMessage("CREATE_URL saved.");
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
    setMessage("Tags added to collection.");

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
      <header class="topbar">
        <div class="topbar-brand">
          <UBadge color="primary" variant="subtle">Only Vitiok</UBadge>
          <h1>Media Pipeline Studio</h1>
        </div>

        <div class="topbar-actions">
          <UButton
            color="neutral"
            variant="soft"
            icon="i-lucide-settings-2"
            label="Settings"
            @click="isSettingsOpen = true"
          />
        </div>
      </header>

      <div class="studio-layout">
        <aside class="left-sidebar">
          <UCard id="workflow" class="surface-card">
            <template #header>
              <div class="section-title">
                <h2>Workflow</h2>
                <UBadge :color="pendingActions ? 'warning' : 'success'" variant="soft">
                  {{ pendingActions ? "Running" : "Ready" }}
                </UBadge>
              </div>
            </template>

            <div class="stack-lg">
              <UButton
                class="w-full"
                size="lg"
                :color="loginButtonColor"
                icon="i-lucide-key-round"
                :loading="isHandlingLogin"
                :disabled="isHandlingLogin"
                @click="handleLoginButton"
              >
                {{ loginButtonText }}
              </UButton>

              <UCheckbox
                v-model="autoUploadAfterAnalyze"
                label="Automatically run Upload after Analyze"
              />

              <UButton
                class="w-full"
                size="lg"
                color="primary"
                icon="i-lucide-sparkles"
                :loading="isRunningAnalyze"
                :disabled="isBusy || isRunningAnalyze"
                @click="startAnalyze"
              >
                Start analysis
              </UButton>

              <UButton
                class="w-full"
                size="lg"
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
                class="w-full"
                size="lg"
                color="neutral"
                variant="soft"
                icon="i-lucide-tags"
                :loading="isRunningAddTags"
                :disabled="isBusy || isRunningAddTags"
                @click="startAddTags"
              >
                Add tags to collection
              </UButton>

              <UButton
                class="w-full"
                size="lg"
                color="neutral"
                variant="soft"
                icon="i-lucide-file-json-2"
                @click="isConfigDrawerOpen = true"
              >
                Config Editor
              </UButton>

              <UButton
                class="w-full"
                size="lg"
                color="neutral"
                variant="soft"
                icon="i-lucide-logs"
                @click="isLogsDrawerOpen = true"
              >
                Run Log
              </UButton>

              <p class="muted-text">
                After starting login, finish sign-in in the browser and click
                "Finish login".
              </p>
            </div>
          </UCard>

          <UCard class="surface-card">
            <template #header>
              <div class="section-title">
                <h2>Session</h2>
              </div>
            </template>

            <div class="stack-md">
              <UBadge color="neutral" variant="soft">{{ loginStatusText }}</UBadge>
              <UBadge color="primary" variant="soft">Files in media: {{ mediaFiles.length }}</UBadge>
              <UBadge color="neutral" variant="soft">Env keys: {{ envKeys.length }}</UBadge>
            </div>
          </UCard>
        </aside>

        <main class="center-content">
          <UAlert
            v-if="infoMessage"
            color="success"
            variant="subtle"
            icon="i-lucide-check-circle-2"
            :title="infoMessage"
          />

          <UAlert
            v-if="errorMessage"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :title="errorMessage"
          />

          <UCard id="media" class="surface-card media-card">
            <template #header>
              <div class="section-title">
                <h2>Media Dropzone</h2>
                <div class="media-header-actions">
                  <UBadge color="neutral" variant="soft">{{ configItems.length }} cards</UBadge>
                  <UButton
                    color="error"
                    variant="soft"
                    size="sm"
                    icon="i-lucide-trash-2"
                    :loading="isClearingMedia"
                    @click="clearAllMedia"
                  >
                    Clear all media
                  </UButton>
                </div>
              </div>
            </template>

            <div class="create-url-input">
              <p class="field-label">CREATE_URL (full upload URL)</p>
              <div class="create-url-row">
                <UInput
                  v-model="createUrl"
                  class="create-url-field"
                  size="lg"
                  icon="i-lucide-link-2"
                  placeholder="https://collections.only-nice.com/collection/..."
                />
                <UButton
                  color="primary"
                  size="lg"
                  :loading="isSavingCreateUrl"
                  @click="saveCreateUrl"
                >
                  Save URL
                </UButton>
              </div>
            </div>

            <div class="global-tags-panel">
              <div class="global-tags-head">
                <p class="field-label">Global tags array</p>
                <UBadge color="neutral" variant="soft">{{ globalTags.length }} tags</UBadge>
              </div>

              <div class="tag-list">
                <UBadge
                  v-for="tag in globalTags"
                  :key="`global-${tag}`"
                  class="tag-badge"
                  color="primary"
                  variant="soft"
                >
                  #{{ tag }}
                </UBadge>
              </div>

              <p v-if="!globalTags.length" class="muted-text">
                No global tags in config yet.
              </p>
            </div>

            <div
              class="dropzone"
              :class="{ 'is-drag-over': isDragOver }"
              @drop="onDrop"
              @dragover="onDragOver"
              @dragleave="onDragLeave"
            >
              <div class="dropzone-head">
                <UBadge color="primary" variant="subtle">Drag & Drop</UBadge>
              </div>

              <div class="file-picker-row">
                <UButton
                  size="lg"
                  color="primary"
                  icon="i-lucide-upload"
                  :loading="isUploadingMedia"
                  @click="openFileDialog"
                >
                  Select files
                </UButton>
                <span class="muted-text">{{ pickedFileText }}</span>
              </div>

              <input
                ref="fileInputRef"
                class="hidden-file-input"
                type="file"
                multiple
                @change="onInputFiles"
              >
            </div>

            <div v-if="isRunningAnalyze || canResumeAnalyze" class="analysis-progress">
              <div class="analysis-progress-head">
                <div class="analysis-progress-meta">
                  <span class="analysis-progress-title">
                    {{ isRunningAnalyze ? "Analysis in progress" : "Analysis stopped" }}
                  </span>
                  <span class="muted-text">
                    {{ analysisProgress.done }} / {{ analysisProgress.total }} analyzed
                    ({{ analysisProgress.percent }}%)
                  </span>
                </div>

                <UButton
                  v-if="isRunningAnalyze"
                  color="error"
                  variant="soft"
                  icon="i-lucide-square"
                  :loading="isStoppingAnalyze"
                  :disabled="isStoppingAnalyze"
                  @click="stopAnalyze"
                >
                  Stop analysis
                </UButton>

                <UButton
                  v-else
                  color="primary"
                  variant="soft"
                  icon="i-lucide-play"
                  :disabled="isBusy || isRunningAnalyze"
                  @click="resumeAnalyze"
                >
                  Resume analysis
                </UButton>
              </div>

              <UProgress :model-value="analysisProgress.percent" />
            </div>

            <div class="media-cards">
              <UCard
                v-for="(item, index) in configItems"
                :key="item.filePath || item.fileName || index"
                class="media-card-item"
              >
                <template #header>
                  <div class="media-card-head">
                    <div class="media-preview">
                      <div class="vip-overlay">
                        <UCheckbox
                          :model-value="Boolean(item.vip)"
                          label="VIP"
                          @update:model-value="updateCardField(index, 'vip', $event)"
                        />
                      </div>

                      <div class="card-top-actions">
                        <UButton
                          class="delete-card-btn"
                          color="error"
                          variant="solid"
                          size="xs"
                          square
                          aria-label="Delete card"
                          @click.stop="removeCard(index)"
                        >
                          <UIcon name="i-lucide-trash-2" class="size-4" />
                        </UButton>
                      </div>

                      <img
                        v-if="isImageItem(item)"
                        :src="getAssetUrl(item)"
                        alt="Media preview"
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
                      <div v-else class="media-preview-fallback">No preview</div>
                    </div>
                  </div>
                </template>

                <div class="media-card-body">
                  <UInput
                    :model-value="item.title || ''"
                    placeholder="Title"
                    @update:model-value="updateCardField(index, 'title', $event)"
                  />
                  <UTextarea
                    :model-value="item.description || ''"
                    :rows="4"
                    autoresize
                    placeholder="Description"
                    @update:model-value="updateCardField(index, 'description', $event)"
                  />
                  <div class="tag-list">
                    <UBadge
                      v-for="tag in getTagsArray(item)"
                      :key="`${index}-${tag}`"
                      class="tag-badge"
                      color="primary"
                      variant="soft"
                      @click="removeTagFromCard(index, tag)"
                    >
                      #{{ tag }}
                    </UBadge>
                  </div>
                  <div class="tag-input-row">
                    <UInput
                      v-model="tagDraftByIndex[index]"
                      placeholder="New tag"
                      @keyup.enter="addTagToCard(index)"
                    />
                    <UButton
                      color="neutral"
                      variant="soft"
                      size="sm"
                      @click="addTagToCard(index)"
                    >
                      Add
                    </UButton>
                  </div>
                </div>
              </UCard>
              <p v-if="!configItems.length" class="muted-text">
                No items in config yet. Start analysis or edit the config.
              </p>
            </div>
          </UCard>

        </main>
      </div>
    </div>

    <UDrawer
      v-model:open="isSettingsOpen"
      title="Settings (.env)"
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
              <p class="field-label">COLLECTION ID</p>
              <UInput
                v-model="collectionId"
                size="lg"
                placeholder="10802cfc-dc6e-4506-9ca2-abfe83d64506"
                @blur="applyCollectionToCreateUrl"
              />
            </div>

            <div class="field-block field-action">
              <UButton
                class="w-full"
                size="lg"
                color="neutral"
                variant="soft"
                icon="i-lucide-link"
                @click="applyCollectionToCreateUrl"
              >
                Sync CREATE_URL
              </UButton>
            </div>
          </div>

          <div class="env-list">
            <div v-for="key in envKeys" :key="key" class="env-item">
              <UBadge color="neutral" variant="outline">{{ key }}</UBadge>
              <div class="env-input-row">
                <UInput v-model="envMap[key]" size="lg" />
                <UButton
                  color="error"
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  aria-label="Delete env key"
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

    <UDrawer
      v-model:open="isConfigDrawerOpen"
      title="Config Editor"
      :ui="{ content: '!max-w-none !w-screen !h-screen !rounded-none' }"
    >
      <template #body>
        <div class="drawer-body">
          <UBadge color="neutral" variant="soft">{{ configPath || "no file" }}</UBadge>
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
          <UButton
            class="w-full"
            size="lg"
            color="neutral"
            variant="soft"
            icon="i-lucide-refresh-ccw"
            @click="loadConfig"
          >
            Refresh
          </UButton>
          <UButton
            class="w-full"
            size="lg"
            color="primary"
            icon="i-lucide-file-check-2"
            :loading="isSavingConfig"
            @click="saveConfig"
          >
            Save config
          </UButton>
        </div>
      </template>
    </UDrawer>

    <UDrawer
      v-model:open="isLogsDrawerOpen"
      title="Run Log"
      :ui="{ content: '!max-w-none !w-screen !h-screen !rounded-none' }"
    >
      <template #body>
        <div class="drawer-body">
          <UBadge color="primary" variant="soft">Live</UBadge>
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
          <UButton
            class="w-full"
            size="lg"
            color="neutral"
            variant="soft"
            icon="i-lucide-refresh-ccw"
            @click="loadTaskStatus"
          >
            Refresh status
          </UButton>
        </div>
      </template>
    </UDrawer>
  </UApp>
</template>

<style scoped>
.studio-ui {
  min-height: 100vh;
  color: #e2e8f0;
}

.studio-shell {
  max-width: 1760px;
  margin: 0 auto;
  padding: 16px;
  display: grid;
  gap: 16px;
}

.topbar {
  border: 1px solid rgba(71, 85, 105, 0.5);
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.95), rgba(15, 23, 42, 0.8));
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.topbar-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.topbar-brand h1 {
  margin: 0;
  font-size: clamp(1.2rem, 2.1vw, 1.7rem);
  line-height: 1.1;
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.studio-layout {
  display: grid;
  gap: 16px;
  grid-template-columns: 320px minmax(0, 1fr);
}

.left-sidebar,
.center-content {
  display: grid;
  align-content: start;
  gap: 16px;
}

.surface-card {
  border: 1px solid rgba(71, 85, 105, 0.5);
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.9), rgba(15, 23, 42, 0.82));
}

.section-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.section-title h2 {
  margin: 0;
  font-size: 1.03rem;
  line-height: 1.2;
}

.section-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.media-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stack-lg {
  display: grid;
  gap: 14px;
}

.stack-md {
  display: grid;
  gap: 10px;
}

.media-card {
  scroll-margin-top: 24px;
}

.create-url-input {
  border: 1px solid rgba(71, 85, 105, 0.45);
  border-radius: 14px;
  background:
    radial-gradient(circle at 10% 0%, rgba(34, 211, 238, 0.12), transparent 40%),
    rgba(2, 6, 23, 0.45);
  padding: 16px;
  display: grid;
  gap: 12px;
  box-shadow: inset 0 1px 0 rgba(148, 163, 184, 0.08);
}

.create-url-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.create-url-field {
  flex: 1 1 360px;
  min-width: 0;
}

.global-tags-panel {
  margin-top: 12px;
  border: 1px solid rgba(71, 85, 105, 0.45);
  border-radius: 14px;
  background: rgba(2, 6, 23, 0.38);
  padding: 12px;
  display: grid;
  gap: 10px;
}

.global-tags-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.dropzone {
  margin-top: 18px;
  border: 1px dashed rgba(34, 211, 238, 0.55);
  border-radius: 14px;
  padding: 20px;
  display: grid;
  gap: 16px;
  background:
    radial-gradient(circle at 20% 0%, rgba(14, 165, 233, 0.12), transparent 48%),
    rgba(2, 6, 23, 0.36);
  min-height: 240px;
  align-content: center;
}

.dropzone.is-drag-over {
  border-color: rgba(45, 212, 191, 0.9);
  background:
    radial-gradient(circle at 20% 0%, rgba(20, 184, 166, 0.2), transparent 52%),
    rgba(15, 23, 42, 0.9);
  box-shadow: inset 0 0 0 1px rgba(34, 211, 238, 0.35);
}

.dropzone p {
  margin: 0;
}

.dropzone-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.file-picker-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  justify-content: flex-start;
}

.hidden-file-input {
  display: none;
}

.analysis-progress {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid rgba(71, 85, 105, 0.45);
  border-radius: 12px;
  background: rgba(2, 6, 23, 0.38);
  display: grid;
  gap: 10px;
}

.analysis-progress-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.analysis-progress-meta {
  display: grid;
  gap: 4px;
}

.analysis-progress-title {
  font-weight: 600;
  font-size: 0.96rem;
}

.media-cards {
  margin-top: 20px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  min-height: 720px;
  max-height: 72vh;
  overflow: auto;
  padding-right: 4px;
}

.media-card-item {
  border: 1px solid rgba(71, 85, 105, 0.45);
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.9), rgba(8, 17, 39, 0.92)),
    rgba(2, 6, 23, 0.5);
  box-shadow: inset 0 1px 0 rgba(148, 163, 184, 0.08);
  transition: border-color 0.2s ease, transform 0.2s ease;
}

.media-card-item:hover {
  border-color: rgba(56, 189, 248, 0.55);
  transform: translateY(-1px);
}

.media-card-head {
  display: grid;
  gap: 8px;
}

.media-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 10;
  border: 1px solid rgba(71, 85, 105, 0.45);
  border-radius: 10px;
  overflow: hidden;
  background: rgba(2, 6, 23, 0.5);
}

.vip-overlay {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 4;
  padding: 4px 8px;
  border-radius: 10px;
  background: rgba(2, 6, 23, 0.76);
  border: 1px solid rgba(71, 85, 105, 0.55);
  backdrop-filter: blur(5px);
}

.card-top-actions {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 6;
  display: flex;
  align-items: center;
  justify-content: center;
}

.delete-card-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  min-width: 34px;
  height: 34px;
  opacity: 1 !important;
  visibility: visible !important;
  box-shadow: 0 8px 16px rgba(2, 6, 23, 0.62);
}

.delete-card-btn :deep(.iconify) {
  font-size: 15px;
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
  color: #94a3b8;
  font-size: 0.8rem;
}

.media-card-body {
  display: grid;
  gap: 10px;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 28px;
}

.tag-badge {
  cursor: pointer;
}

.tag-input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.actions-row {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

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
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #94a3b8;
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

.muted-text {
  margin: 0;
  font-size: 0.86rem;
  color: #94a3b8;
}

.run-log-area {
  width: 100%;
}

.run-log-area :deep(textarea) {
  width: 100%;
  min-height: min(72vh, 920px);
}

@media (max-width: 1320px) {
  .studio-layout {
    grid-template-columns: 290px minmax(0, 1fr);
  }
}

@media (max-width: 980px) {
  .studio-shell {
    padding: 12px;
  }

  .topbar {
    flex-direction: column;
    align-items: stretch;
  }

  .studio-layout {
    grid-template-columns: 1fr;
  }

  .actions-row {
    grid-template-columns: 1fr;
  }

  .drawer-actions {
    grid-template-columns: 1fr;
  }

  .media-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .media-cards {
    grid-template-columns: 1fr;
  }
}
</style>
