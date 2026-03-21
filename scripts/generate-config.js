const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const TARGET_GLOBAL_HASHTAGS = 15;
const MAX_ITEM_HASHTAGS = 12;
const VIDEO_ANALYSIS_FRAME_COUNT = 6;
const TITLE_EMOJIS = ["🔥", "💋", "✨", "😈", "🥵", "🍑", "👅", "🫦", "❤️‍🔥"];
const DESCRIPTION_EMOJIS = [
  "💦",
  "🌶",
  "🖤",
  "💞",
  "🔞",
  "🍒",
  "🍓",
  "😮‍💨",
  "🤤",
];
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
const DEFAULT_SEXY_TAGS = [
  "sexy",
  "sensual",
  "lingerie",
  "erotic",
  "seductive",
  "intimate",
  "alluring",
  "provocative",
  "adult",
  "glamour",
  "tempting",
  "passion",
  "romantic",
  "nightwear",
  "bodysuit",
  "boobs",
  "ass",
  "blowjob",
  "strapon",
  "oral",
  "hardcore",
  "nsfw",
  "fetish",
  "nude",
  "pussy",
  "sex",
  "twogirl",
  "lesbian",
  "milf",
  "dildo",
];
const EXPLICIT_VIP_KEYWORDS =
  /(blowjob|strapon|hardcore|nsfw|nude|pussy|explicit|penetration|oral sex|anal|boobs|ass)/i;
let wdTaggerClientPromise = null;
let gradioModulePromise = null;

function getEnv() {
  const parsedConcurrency = Number(process.env.AI_ANALYSIS_CONCURRENCY || 3);
  const aiConcurrency = Number.isFinite(parsedConcurrency)
    ? Math.max(1, Math.min(8, Math.round(parsedConcurrency)))
    : 3;
  const parsedRetryCount = Number(process.env.MODEL_RETRY_COUNT || 2);
  const modelRetryCount = Number.isFinite(parsedRetryCount)
    ? Math.max(0, Math.min(6, Math.round(parsedRetryCount)))
    : 2;
  const ollamaUrl = process.env.OLLAMA_URL;

  if (!ollamaUrl) {
    throw new Error("OLLAMA_URL is missing. Add OLLAMA_URL to .env");
  }

  return {
    OLLAMA_URL: ollamaUrl,
    OLLAMA_MODEL: process.env.OLLAMA_MODEL || "llava:13b",
    WD_TAGGER_SPACE: process.env.WD_TAGGER_SPACE || "SmilingWolf/wd-tagger",
    WD_TAGGER_MODEL_REPO:
      process.env.WD_TAGGER_MODEL_REPO || "SmilingWolf/wd-swinv2-tagger-v3",
    WD_TAGGER_GENERAL_THRESHOLD: Number(
      process.env.WD_TAGGER_GENERAL_THRESHOLD || 0.35
    ),
    WD_TAGGER_CHARACTER_THRESHOLD: Number(
      process.env.WD_TAGGER_CHARACTER_THRESHOLD || 0.85
    ),
    HF_TOKEN: String(process.env.HF_TOKEN || "").trim(),
    AI_ANALYSIS_CONCURRENCY: aiConcurrency,
    MODEL_RETRY_COUNT: modelRetryCount,
    MEDIA_FOLDER: path.resolve(process.env.MEDIA_FOLDER || "./media"),
    TAG_CATEGORIES_PATH: path.resolve(
      process.env.TAG_CATEGORIES_PATH || "./config/tag-categories.txt"
    ),
    MEDIA_CONFIG_PATH: path.resolve(
      process.env.MEDIA_CONFIG_PATH || "./media-config.json"
    ),
  };
}

function isLowQualityModelOutput({ title, description, hashtags, filename }) {
  const normalizedTitle = String(title || "").trim().toLowerCase();
  const normalizedDescription = String(description || "").trim().toLowerCase();
  const normalizedFile = String(filename || "").trim().toLowerCase();
  const tags = Array.isArray(hashtags) ? hashtags : [];

  if (!normalizedTitle || !normalizedDescription) return true;
  if (tags.length === 0) return true;
  if (normalizedTitle === normalizedFile) return true;
  if (normalizedTitle === path.parse(normalizedFile).name) return true;
  if (normalizedDescription.startsWith("sexy media content")) return true;

  return false;
}

function loadDotEnv() {
  const envPath = path.resolve(".env");
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && process.env[key] == null) process.env[key] = value;
  }
}

function normalizeHashtag(tag) {
  const cleaned = String(tag || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/gi, "")
    .trim();

  if (!cleaned) return "";
  if (/^tag\d*$/i.test(cleaned)) return "";
  return cleaned;
}

function normalizeTags(tags) {
  const out = [];
  for (const tag of tags || []) {
    const normalized = normalizeHashtag(tag);
    if (!normalized) continue;
    if (!out.includes(normalized)) out.push(normalized);
  }
  return out;
}

function loadAllowedTags(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Tag categories file not found: ${filePath}`);
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const tags = lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(normalizeHashtag)
    .filter(Boolean);

  const unique = [...new Set(tags)];
  if (!unique.length) {
    throw new Error(`Tag categories file is empty: ${filePath}`);
  }
  return unique;
}

function filterModelTags(tags, allowedTagSet) {
  const filtered = (tags || [])
    .map(normalizeHashtag)
    .filter((tag) => tag && tag.length >= 3 && allowedTagSet.has(tag));

  return [...new Set(filtered)];
}

function normalizeItemTags(tags) {
  const ownTags = [
    ...new Set((tags || []).map(normalizeHashtag).filter(Boolean)),
  ];
  return ownTags.slice(0, MAX_ITEM_HASHTAGS);
}

function sanitizeEnglishText(value, fallback = "") {
  const cleaned = String(value || "")
    .replace(
      /[^a-zA-Z0-9\s.,!?'"():;\-_/&\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || fallback;
}

function removeOverusedTitleWords(title, fallback = "Sexy moment") {
  const cleaned = String(title || "")
    .replace(/\bsensual\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || fallback;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function createProgressBar(percent, width = 24) {
  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round((safePercent / 100) * width);
  const empty = Math.max(0, width - filled);
  return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}

function pickEmoji(seed, pool) {
  const source = String(seed || "default");
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) % 2147483647;
  }
  return pool[Math.abs(hash) % pool.length];
}

function enforceSexyTone(text, { isTitle = false, emoji = "🔥" } = {}) {
  const base = String(text || "").trim();
  if (!base) {
    const fallback = isTitle ? "Sexy moment" : "Seductive mood.";
    return `${fallback} ${emoji}`;
  }

  const hasEmoji = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(
    base
  );
  return hasEmoji ? base : `${base} ${emoji}`;
}

function detectMediaType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  return "unknown";
}

function isSupportedMedia(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext);
}

function toBase64(filePath) {
  return fs.readFileSync(filePath).toString("base64");
}

function writeJsonAtomic(filePath, value) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tempPath, filePath);
}

function parseJsonFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Model returned an empty response");

  try {
    return JSON.parse(raw);
  } catch {}

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced && fenced[1]) {
    return JSON.parse(fenced[1]);
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return JSON.parse(raw.slice(start, end + 1));
  }

  throw new Error(`Could not parse model JSON response: ${raw}`);
}

function hasFfmpeg() {
  const check = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
  return check.status === 0;
}

function hasFfprobe() {
  const check = spawnSync("ffprobe", ["-version"], { stdio: "ignore" });
  return check.status === 0;
}

function hasSips() {
  const check = spawnSync("sips", ["--version"], { stdio: "ignore" });
  return check.status === 0;
}

function createResizedImageForAi(imagePath, maxSize = 1024) {
  if (!hasSips()) return null;

  const tempFile = path.join(
    os.tmpdir(),
    `onlynice-ai-image-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
  );

  const run = spawnSync(
    "sips",
    [
      "-s",
      "format",
      "jpeg",
      "-Z",
      String(maxSize),
      imagePath,
      "--out",
      tempFile,
    ],
    { stdio: "ignore" }
  );

  if (run.status !== 0 || !fs.existsSync(tempFile)) return null;
  return tempFile;
}

function getVideoDurationSeconds(videoPath) {
  if (!hasFfprobe()) return null;

  const run = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ],
    { encoding: "utf8" }
  );

  if (run.status !== 0) return null;
  const seconds = Number(String(run.stdout || "").trim());
  return Number.isFinite(seconds) ? seconds : null;
}

function buildVideoFrameTimestamps(
  durationSeconds,
  frameCount = VIDEO_ANALYSIS_FRAME_COUNT
) {
  const safeCount = Math.max(1, Math.min(10, Math.round(frameCount || 5)));

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return Array.from({ length: safeCount }, (_, i) => 0.5 + i * 1.0);
  }

  const maxTs = Math.max(0.05, durationSeconds - 0.05);
  const timestamps = [];

  for (let i = 0; i < safeCount; i += 1) {
    const fraction = (i + 1) / (safeCount + 1);
    const ts = Math.min(maxTs, Math.max(0, durationSeconds * fraction));
    timestamps.push(Number(ts.toFixed(3)));
  }

  return [...new Set(timestamps)];
}

function extractVideoFrames(
  videoPath,
  durationSeconds,
  frameCount = VIDEO_ANALYSIS_FRAME_COUNT
) {
  if (!hasFfmpeg()) return [];

  const timestamps = buildVideoFrameTimestamps(durationSeconds, frameCount);
  const frames = [];

  for (const timestamp of timestamps) {
    const tempFile = path.join(
      os.tmpdir(),
      `onlynice-frame-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
    );

    const run = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-ss",
        String(timestamp),
        "-i",
        videoPath,
        "-vframes",
        "1",
        tempFile,
      ],
      { stdio: "ignore" }
    );

    if (run.status === 0 && fs.existsSync(tempFile)) {
      frames.push(tempFile);
    }
  }

  return frames;
}

function toHumanTag(tag) {
  return String(tag || "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromTags(tags, fileName) {
  const fallback = sanitizeEnglishText(path.parse(fileName).name, "Media Content");
  if (!tags.length) return fallback;

  const parts = tags
    .slice(0, 3)
    .map(toHumanTag)
    .filter(Boolean)
    .map((text) => text.charAt(0).toUpperCase() + text.slice(1));

  return sanitizeEnglishText(parts.join(" • "), fallback);
}

function descriptionFromTags(tags, fileName) {
  const fallback = `Highlights: ${sanitizeEnglishText(fileName, "media content")}.`;
  if (!tags.length) return fallback;

  const preview = tags.slice(0, 8).map(toHumanTag).filter(Boolean).join(", ");
  return sanitizeEnglishText(`Highlights: ${preview}.`, fallback);
}

async function getGradioModule() {
  if (!gradioModulePromise) {
    gradioModulePromise = import("@gradio/client");
  }
  return gradioModulePromise;
}

async function getWdTaggerClient(env) {
  if (!wdTaggerClientPromise) {
    wdTaggerClientPromise = (async () => {
      const { Client } = await getGradioModule();
      const options = env.HF_TOKEN ? { token: env.HF_TOKEN } : undefined;
      return Client.connect(env.WD_TAGGER_SPACE, options);
    })();
  }

  try {
    return await wdTaggerClientPromise;
  } catch (error) {
    wdTaggerClientPromise = null;
    throw error;
  }
}

function asConfidenceMap(value) {
  if (!value || typeof value !== "object") return {};
  const out = {};

  for (const [key, score] of Object.entries(value)) {
    const normalized = normalizeHashtag(key);
    if (!normalized) continue;
    const numeric = Number(score);
    if (!Number.isFinite(numeric)) continue;
    out[normalized] = numeric;
  }

  return out;
}

async function runWdTaggerPredict(imagePath, env) {
  const app = await getWdTaggerClient(env);
  const { handle_file } = await getGradioModule();

  let response;
  try {
    response = await app.predict("/predict", {
      image: handle_file(imagePath),
      model_repo: env.WD_TAGGER_MODEL_REPO,
      general_thresh: env.WD_TAGGER_GENERAL_THRESHOLD,
      general_mcut_enabled: false,
      character_thresh: env.WD_TAGGER_CHARACTER_THRESHOLD,
      character_mcut_enabled: false,
    });
  } catch {
    response = await app.predict("/predict", [
      handle_file(imagePath),
      env.WD_TAGGER_MODEL_REPO,
      env.WD_TAGGER_GENERAL_THRESHOLD,
      false,
      env.WD_TAGGER_CHARACTER_THRESHOLD,
      false,
    ]);
  }

  const data = Array.isArray(response?.data) ? response.data : [];
  const rating = asConfidenceMap(data[1]);
  const general = asConfidenceMap(data[3]);
  const textTags = String(data[0] || "")
    .split(",")
    .map((tag) => normalizeHashtag(tag))
    .filter(Boolean);

  if (!Object.keys(general).length && textTags.length) {
    for (const tag of textTags) {
      general[tag] = 1;
    }
  }

  return {
    rating,
    general,
  };
}

async function callWdTaggerModel({
  filePath,
  mediaType,
  env,
  videoDurationSeconds,
  allowedTags,
}) {
  const filename = path.basename(filePath);
  const allowedTagSet = new Set(allowedTags);
  const framePaths =
    mediaType === "video"
      ? extractVideoFrames(
          filePath,
          videoDurationSeconds,
          VIDEO_ANALYSIS_FRAME_COUNT
        )
      : [filePath];

  if (!framePaths.length) {
    throw new Error("No frames extracted for WD Tagger");
  }

  const scoreMap = new Map();
  const ratingMap = new Map();

  try {
    for (const framePath of framePaths) {
      const result = await runWdTaggerPredict(framePath, env);
      for (const [tag, score] of Object.entries(result.general)) {
        const previous = scoreMap.get(tag) || 0;
        scoreMap.set(tag, Math.max(previous, Number(score)));
      }
      for (const [tag, score] of Object.entries(result.rating)) {
        const previous = ratingMap.get(tag) || 0;
        ratingMap.set(tag, Math.max(previous, Number(score)));
      }
    }
  } finally {
    for (const framePath of framePaths) {
      if (framePath === filePath) continue;
      try {
        fs.unlinkSync(framePath);
      } catch {}
    }
  }

  const sortedTags = [...scoreMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);

  let hashtags = sortedTags.filter((tag) => allowedTagSet.has(tag));
  if (!hashtags.length) {
    hashtags = sortedTags;
  }
  hashtags = normalizeTags(hashtags);

  const explicitRating = Math.max(
    Number(ratingMap.get("explicit") || 0),
    Number(ratingMap.get("questionable") || 0)
  );
  return {
    hashtags,
    explicitRating,
    videoDurationSeconds: Number.isFinite(videoDurationSeconds)
      ? Math.round(videoDurationSeconds)
      : null,
  };
}

async function callKeywordModel({
  filePath,
  mediaType,
  env,
  videoDurationSeconds,
  allowedTags,
  keywords,
  explicitRating,
}) {
  const filename = path.basename(filePath);
  const keywordList = normalizeTags(keywords || []);
  if (!keywordList.length) {
    throw new Error("WD Tagger returned no keywords");
  }

  const durationLine =
    mediaType === "video" && Number.isFinite(videoDurationSeconds)
      ? `Video duration seconds: ${Math.round(videoDurationSeconds)}.`
      : "";
  const allowedTagSet = new Set(allowedTags);

  const prompt = [
    `File: ${filename}. Media type: ${mediaType}.`,
    durationLine,
    `Keywords from WD Tagger: ${keywordList.slice(0, 80).join(", ")}.`,
    "You are a content editor for a media platform. Build metadata using only these keywords and file context.",
    "Return JSON only (no markdown):",
    '{"title":"...","description":"...","hashtags":["keyword1","keyword2"]}',
    "Rules:",
    "- title: only English, short, up to 60 chars, sexual tone",
    "- description: only English, 1-2 sentences, up to 220 chars, sexual tone",
    "- emoji are allowed and recommended in title/description",
    "- hashtags: 5-12 tags for THIS media",
    "- each hashtag MUST be selected from WD Tagger keywords above",
    "- do not invent tags outside WD Tagger keywords",
    "- prioritize specific keywords over generic ones",
    `- use hashtags ONLY from this allowed list: ${allowedTags
      .slice(0, 300)
      .join(", ")}`,
    "- do not use placeholder tags like tag, tag1, tag2",
    "- no extra text outside JSON",
  ].join("\n");

  let response;
  try {
    response = await fetch(`${env.OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.OLLAMA_MODEL,
        format: "json",
        stream: false,
        options: { temperature: 0.4 },
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });
  } catch (err) {
    throw new Error(
      `No connection to Ollama (${env.OLLAMA_URL}). Start 'ollama serve'. Details: ${err.message}`
    );
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Ollama API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const parsed = parseJsonFromText(data.message?.content);

  const title = sanitizeEnglishText(parsed.title, titleFromTags(keywordList, filename));
  const description = sanitizeEnglishText(
    parsed.description,
    descriptionFromTags(keywordList, filename)
  );

  let hashtags = keywordList.filter((tag) => allowedTagSet.has(tag));
  if (!hashtags.length) hashtags = keywordList;
  hashtags = normalizeTags(hashtags).slice(0, MAX_ITEM_HASHTAGS);

  const titleEmoji = pickEmoji(`${filename}:title`, TITLE_EMOJIS);
  const descriptionEmoji = pickEmoji(
    `${filename}:description`,
    DESCRIPTION_EMOJIS
  );
  const cleanedTitle = removeOverusedTitleWords(title, "Sexy moment");
  const sexyTitle = enforceSexyTone(cleanedTitle, {
    isTitle: true,
    emoji: titleEmoji,
  });
  const sexyDescription = enforceSexyTone(description, {
    isTitle: false,
    emoji: descriptionEmoji,
  });

  if (
    isLowQualityModelOutput({
      title,
      description,
      hashtags,
      filename,
    })
  ) {
    throw new Error("Keyword model returned incomplete metadata");
  }

  const durationVip =
    mediaType === "video" &&
    Number.isFinite(videoDurationSeconds) &&
    videoDurationSeconds >= 120;
  const explicitTagHit = hashtags.some((tag) =>
    EXPLICIT_VIP_KEYWORDS.test(tag)
  );
  const explicitTextHit = EXPLICIT_VIP_KEYWORDS.test(
    `${sexyTitle} ${sexyDescription}`
  );
  const imageVip =
    Number(explicitRating || 0) >= 0.4 || explicitTagHit || explicitTextHit;
  const vip = mediaType === "video" ? Boolean(durationVip) : imageVip;

  return {
    title: sexyTitle,
    description: sexyDescription,
    hashtags,
    vip,
    videoDurationSeconds: Number.isFinite(videoDurationSeconds)
      ? Math.round(videoDurationSeconds)
      : null,
  };
}

function rankGlobalHashtags(mediaItems) {
  const stats = new Map();

  for (const item of mediaItems) {
    for (const tag of item.hashtags) {
      stats.set(tag, (stats.get(tag) || 0) + 1);
    }
  }

  return [...stats.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TARGET_GLOBAL_HASHTAGS)
    .map(([tag]) => tag);
}

async function buildConfig(env) {
  const allowedTags = loadAllowedTags(env.TAG_CATEGORIES_PATH);
  const allowedTagSet = new Set(allowedTags);

  if (!fs.existsSync(env.MEDIA_FOLDER)) {
    throw new Error(`Media folder not found: ${env.MEDIA_FOLDER}`);
  }

  const allFiles = fs
    .readdirSync(env.MEDIA_FOLDER)
    .filter((f) => fs.statSync(path.join(env.MEDIA_FOLDER, f)).isFile())
    .sort((a, b) => a.localeCompare(b));

  const files = allFiles.filter(
    (file) => !file.startsWith(".") && isSupportedMedia(file)
  );

  if (!files.length) {
    throw new Error(`No supported media files found in ${env.MEDIA_FOLDER}`);
  }

  let existingConfig = null;
  if (fs.existsSync(env.MEDIA_CONFIG_PATH)) {
    try {
      existingConfig = JSON.parse(fs.readFileSync(env.MEDIA_CONFIG_PATH, "utf8"));
    } catch {
      existingConfig = null;
    }
  }

  const existingItemsByFile = new Map();
  if (existingConfig && Array.isArray(existingConfig.items)) {
    for (const item of existingConfig.items) {
      const fileName = String(item?.fileName || "").trim();
      if (!fileName) continue;
      existingItemsByFile.set(fileName, item);
    }
  }

  const items = files.map((file) => {
    const fullPath = path.join(env.MEDIA_FOLDER, file);
    const mediaType = detectMediaType(fullPath);
    const existing = existingItemsByFile.get(file);

    if (existing) {
      return {
        filePath: fullPath,
        fileName: file,
        mediaType,
        title: String(existing.title || "").trim(),
        description: String(existing.description || "").trim(),
        hashtags: normalizeTags(existing.hashtags || []),
        vip: Boolean(existing.vip),
        videoDurationSeconds: Number.isFinite(existing.videoDurationSeconds)
          ? Math.round(existing.videoDurationSeconds)
          : null,
        uploaded: Boolean(existing.uploaded),
      };
    }

    return {
      filePath: fullPath,
      fileName: file,
      mediaType,
      title: "",
      description: "",
      hashtags: [],
      vip: false,
      videoDurationSeconds: null,
      uploaded: false,
    };
  });

  const completedMap = new Array(files.length).fill(false);
  const concurrency = env.AI_ANALYSIS_CONCURRENCY || 3;
  const total = files.length;
  const startedAt = Date.now();
  let completed = 0;
  let fallbackCount = 0;
  let lastProgressLineLength = 0;
  let spinnerIndex = 0;
  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

  function isItemAnalyzed(item) {
    return (
      String(item.title || "").trim().length > 0 &&
      String(item.description || "").trim().length > 0 &&
      Array.isArray(item.hashtags) &&
      item.hashtags.length > 0
    );
  }

  for (let index = 0; index < items.length; index += 1) {
    if (isItemAnalyzed(items[index])) {
      completedMap[index] = true;
      completed += 1;
    }
  }

  function clearProgressLine() {
    if (!process.stdout.isTTY) return;
    process.stdout.write(`\r${" ".repeat(lastProgressLineLength)}\r`);
  }

  function logInfo(message) {
    if (process.stdout.isTTY) {
      clearProgressLine();
      console.log(message);
      if (completed < total) renderProgress();
      return;
    }
    console.log(message);
  }

  function renderProgress() {
    const elapsedSec = (Date.now() - startedAt) / 1000;
    const percent = total > 0 ? (completed / total) * 100 : 0;
    const roundedPercent = Math.round(percent);
    const avgPerItem = completed > 0 ? elapsedSec / completed : 0;
    const remaining = Math.max(0, total - completed);
    const etaSec = avgPerItem * remaining;
    const bar = createProgressBar(percent);
    const spinner = spinnerFrames[spinnerIndex % spinnerFrames.length];
    spinnerIndex += 1;
    const line =
      `📊 ${spinner} Analysis ${bar} ${roundedPercent}% (${completed}/${total})` +
      ` | fallback: ${fallbackCount}` +
      ` | elapsed: ${formatDuration(elapsedSec)}` +
      ` | eta: ${formatDuration(etaSec)}`;

    if (process.stdout.isTTY) {
      const paddedLine =
        line.length < lastProgressLineLength
          ? line + " ".repeat(lastProgressLineLength - line.length)
          : line;
      process.stdout.write(`\r${paddedLine}`);
      lastProgressLineLength = Math.max(lastProgressLineLength, line.length);
      if (completed === total) {
        process.stdout.write("\n");
      }
    } else {
      console.log(line);
    }
  }

  function recomputeGlobalHashtags() {
    const completedItems = items.filter((_, index) => completedMap[index]);
    return rankGlobalHashtags(completedItems)
      .filter((tag) => allowedTagSet.has(tag))
      .slice(0, TARGET_GLOBAL_HASHTAGS);
  }

  function persistConfigSnapshot() {
    const hashtags = recomputeGlobalHashtags();

    for (let index = 0; index < items.length; index += 1) {
      if (!completedMap[index]) continue;
      items[index].hashtags = normalizeItemTags(items[index].hashtags);
    }

    const snapshot = {
      generatedAt: new Date().toISOString(),
      sourceFolder: env.MEDIA_FOLDER,
      hashtags,
      items,
    };

    writeJsonAtomic(env.MEDIA_CONFIG_PATH, snapshot);
    return snapshot;
  }

  async function analyzeFile(file) {
    const fullPath = path.join(env.MEDIA_FOLDER, file);
    const mediaType = detectMediaType(fullPath);
    const videoDurationSeconds =
      mediaType === "video" ? getVideoDurationSeconds(fullPath) : null;

    let ai;
    let usedFallback = false;
    let lastModelError = null;
    const attempts = Math.max(1, Number(env.MODEL_RETRY_COUNT || 0) + 1);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const wd = await callWdTaggerModel({
          filePath: fullPath,
          mediaType,
          env,
          videoDurationSeconds,
          allowedTags,
        });

        ai = await callKeywordModel({
          filePath: fullPath,
          mediaType,
          env,
          videoDurationSeconds,
          allowedTags,
          keywords: wd.hashtags,
          explicitRating: wd.explicitRating,
        });

        lastModelError = null;
        break;
      } catch (err) {
        lastModelError = err;
        if (attempt < attempts) {
          logInfo(
            `⚠️  Analyze retry ${attempt}/${attempts - 1} for ${file}: ${
              err.message
            }`
          );
        }
      }
    }

    if (!ai) {
      usedFallback = true;
      logInfo(
        `⚠️  Analyze failed for ${file}: ${
          lastModelError?.message || "Unknown model error"
        }`
      );
      ai = {
        title: "",
        description: "",
        hashtags: [],
        vip: false,
        videoDurationSeconds: Number.isFinite(videoDurationSeconds)
          ? Math.round(videoDurationSeconds)
          : null,
      };
    }

    return {
      filePath: fullPath,
      fileName: file,
      mediaType,
      title: ai.title,
      description: ai.description,
      hashtags: ai.hashtags,
      vip: Boolean(ai.vip),
      videoDurationSeconds: ai.videoDurationSeconds,
      uploaded: false,
      usedFallback,
    };
  }

  // Persist placeholders so UI can render cards immediately.
  persistConfigSnapshot();

  renderProgress();

  let nextIndex = 0;
  const workerCount = Math.min(concurrency, files.length);

  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= files.length) return;

      const file = files[index];
      if (completedMap[index]) {
        renderProgress();
        continue;
      }
      const result = await analyzeFile(file);

      const current = items[index];
      current.mediaType = result.mediaType;
      current.title = result.title;
      current.description = result.description;
      current.hashtags = result.hashtags;
      current.vip = Boolean(result.vip);
      current.videoDurationSeconds = result.videoDurationSeconds;
      current.uploaded = false;

      completedMap[index] = true;
      completed += 1;
      if (result.usedFallback) fallbackCount += 1;

      persistConfigSnapshot();
      renderProgress();
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  return persistConfigSnapshot();
}

async function main() {
  loadDotEnv();
  const env = getEnv();
  console.log("🔧 Analyze pipeline: wd_tagger -> keyword_model");

  const config = await buildConfig(env);

  console.log(`\n✅ Config saved: ${env.MEDIA_CONFIG_PATH}`);
  console.log(`🏷 Global hashtags: ${config.hashtags.length}`);
  console.log(`📦 Items ready for upload: ${config.items.length}`);
}

main().catch((err) => {
  console.error("❌ Failed to generate config:", err.message);
  process.exit(1);
});
