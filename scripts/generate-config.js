const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const TARGET_GLOBAL_HASHTAGS = 15;
const MAX_ITEM_HASHTAGS = 8;
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

function getEnv() {
  const ollamaUrl = process.env.OLLAMA_URL;
  if (!ollamaUrl) {
    throw new Error("OLLAMA_URL не задано. Додай OLLAMA_URL у .env");
  }

  return {
    OLLAMA_URL: ollamaUrl,
    OLLAMA_MODEL: process.env.OLLAMA_MODEL || "llava:13b",
    MEDIA_FOLDER: path.resolve(process.env.MEDIA_FOLDER || "./media"),
    TAG_CATEGORIES_PATH: path.resolve(
      process.env.TAG_CATEGORIES_PATH || "./tag-categories.txt"
    ),
    MEDIA_CONFIG_PATH: path.resolve(
      process.env.MEDIA_CONFIG_PATH || "./media-config.json"
    ),
  };
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
    throw new Error(`Файл категорій тегів не знайдено: ${filePath}`);
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  const tags = lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map(normalizeHashtag)
    .filter(Boolean);

  const unique = [...new Set(tags)];
  if (!unique.length) {
    throw new Error(`Файл категорій тегів порожній: ${filePath}`);
  }
  return unique;
}

function ensureTagRange(tags, target = TARGET_GLOBAL_HASHTAGS, fallbackPool = []) {
  const unique = [
    ...new Set((tags || []).map(normalizeHashtag).filter(Boolean)),
  ];

  for (const tag of fallbackPool.map(normalizeHashtag).filter(Boolean)) {
    if (unique.length >= target) break;
    if (!unique.includes(tag)) unique.push(tag);
  }

  return unique.slice(0, target);
}

function filterModelTags(tags, allowedTagSet) {
  const filtered = (tags || [])
    .map(normalizeHashtag)
    .filter((tag) => tag && tag.length >= 3 && allowedTagSet.has(tag));

  return [...new Set(filtered)];
}

function normalizeItemTags(tags, globalTags) {
  const normalized = [
    ...new Set((tags || []).map(normalizeHashtag).filter(Boolean)),
  ];
  const intersection = normalized.filter((tag) => globalTags.includes(tag));
  return intersection.slice(0, MAX_ITEM_HASHTAGS);
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

function enforceSexyTone(text, isTitle = false) {
  const base = String(text || "").trim();
  const sexyKeywords =
    /(sexy|sensual|erotic|seductive|intimate|alluring|adult|glamour)/i;
  const withTone = sexyKeywords.test(base)
    ? base
    : isTitle
    ? `${base} sensual`
    : `${base} Sensual and seductive mood.`;

  const hasEmoji = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(
    withTone
  );
  return hasEmoji ? withTone : `${withTone} 🔥`;
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

function parseJsonFromText(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("Порожня відповідь моделі");

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

  throw new Error(`Не вдалося розпарсити JSON від моделі: ${raw}`);
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

function extractVideoFrame(videoPath) {
  if (!hasFfmpeg()) return null;

  const tempFile = path.join(
    os.tmpdir(),
    `onlynice-frame-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
  );

  const run = spawnSync(
    "ffmpeg",
    ["-y", "-i", videoPath, "-ss", "00:00:01", "-vframes", "1", tempFile],
    { stdio: "ignore" }
  );

  if (run.status !== 0 || !fs.existsSync(tempFile)) return null;
  return tempFile;
}

async function callVisionModel({
  filePath,
  mediaType,
  env,
  videoDurationSeconds,
  allowedTags,
}) {
  const filename = path.basename(filePath);
  const durationLine =
    mediaType === "video" && Number.isFinite(videoDurationSeconds)
      ? `Video duration seconds: ${Math.round(videoDurationSeconds)}.`
      : "";
  const prompt = [
    `Файл: ${filename}. Тип: ${mediaType}.`,
    durationLine,
    "Ти контент-редактор для сайту з медіафайлами.",
    "Поверни тільки JSON (без markdown):",
    '{"title":"...","description":"...","hashtags":["fashion","lingerie"],"vip":true}',
    "Правила:",
    "- title: only English, short, up to 60 chars, sexual/sensual tone",
    "- description: only English, 1-2 sentences, up to 220 chars, sexual/sensual tone",
    "- emoji are allowed and recommended in title/description",
    "- hashtags: generate 8-12 tags for THIS media only (not one common set for all files)",
    "- hashtags must be sexualized and relevant to visible details in this media",
    "- include at least 3 specific tags that may NOT fit other media files",
    "- avoid neutral tags: holiday, music, style, photo, model, art",
    `- use tags only from allowed list: ${allowedTags.slice(0, 120).join(", ")}`,
    "- vip: boolean true/false",
    "- for images: vip=true if content is highly nude/pornographic, else false",
    "- for videos: vip will be calculated by code using duration only",
    "- не використовуй tag, tag1, tag2 і подібні технічні значення",
    "- без зайвого тексту поза JSON",
  ].join("\n");

  const images = [];

  if (mediaType === "image") {
    const resizedPath = createResizedImageForAi(filePath);
    const imageForAi = resizedPath || filePath;
    images.push(toBase64(imageForAi));

    if (resizedPath) {
      try {
        fs.unlinkSync(resizedPath);
      } catch {}
    }
  }

  if (mediaType === "video") {
    const framePath = extractVideoFrame(filePath);
    if (framePath) {
      images.push(toBase64(framePath));
      try {
        fs.unlinkSync(framePath);
      } catch {}
    }
  }

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
            images,
          },
        ],
      }),
    });
  } catch (err) {
    throw new Error(
      `Немає з'єднання з Ollama (${env.OLLAMA_URL}). Запусти 'ollama serve'. Деталі: ${err.message}`
    );
  }

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Ollama API помилка: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const parsed = parseJsonFromText(data.message?.content);

  const title = sanitizeEnglishText(
    parsed.title,
    sanitizeEnglishText(path.parse(filename).name, "Media Content")
  );
  const description = sanitizeEnglishText(
    parsed.description,
    `Sexy media content ${sanitizeEnglishText(filename, "content")}`
  );
  const sexyTitle = enforceSexyTone(title, true);
  const sexyDescription = enforceSexyTone(description, false);
  const aiVip = Boolean(parsed.vip);
  const allowedTagSet = new Set(allowedTags);
  const hashtags = filterModelTags(parsed.hashtags || [], allowedTagSet);
  const durationVip =
    mediaType === "video" &&
    Number.isFinite(videoDurationSeconds) &&
    videoDurationSeconds > 60;
  const explicitTagHit = hashtags.some((tag) => EXPLICIT_VIP_KEYWORDS.test(tag));
  const explicitTextHit = EXPLICIT_VIP_KEYWORDS.test(
    `${sexyTitle} ${sexyDescription}`
  );
  const imageVip = Boolean(aiVip && (explicitTagHit || explicitTextHit));
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
    throw new Error(`Папка media не знайдена: ${env.MEDIA_FOLDER}`);
  }

  const allFiles = fs
    .readdirSync(env.MEDIA_FOLDER)
    .filter((f) => fs.statSync(path.join(env.MEDIA_FOLDER, f)).isFile())
    .sort((a, b) => a.localeCompare(b));

  const files = allFiles.filter(
    (file) => !file.startsWith(".") && isSupportedMedia(file)
  );

  if (!files.length) {
    throw new Error(
      `У папці ${env.MEDIA_FOLDER} немає підтримуваних media-файлів`
    );
  }

  const items = [];

  for (const file of files) {
    const fullPath = path.join(env.MEDIA_FOLDER, file);
    const mediaType = detectMediaType(fullPath);
    const videoDurationSeconds =
      mediaType === "video" ? getVideoDurationSeconds(fullPath) : null;

    console.log(
      `🔎 Аналізую: ${file} (${mediaType}${
        Number.isFinite(videoDurationSeconds)
          ? `, ${Math.round(videoDurationSeconds)}s`
          : ""
      })`
    );

    let ai;
    try {
      ai = await callVisionModel({
        filePath: fullPath,
        mediaType,
        env,
        videoDurationSeconds,
        allowedTags,
      });
    } catch (err) {
      console.log(`⚠️  AI аналіз не вдався для ${file}: ${err.message}`);
      const fallbackTag =
        normalizeHashtag(path.parse(file).name.split(/[\s._-]/)[0]) || "media";
      const durationVip =
        mediaType === "video" &&
        Number.isFinite(videoDurationSeconds) &&
        videoDurationSeconds > 60;
      ai = {
        title: path.parse(file).name,
        description: `Media file ${file}`,
        hashtags: allowedTagSet.has(fallbackTag) ? [fallbackTag] : [],
        vip: durationVip,
        videoDurationSeconds: Number.isFinite(videoDurationSeconds)
          ? Math.round(videoDurationSeconds)
          : null,
      };
    }

    items.push({
      filePath: fullPath,
      fileName: file,
      mediaType,
      title: ai.title,
      description: ai.description,
      hashtags: ai.hashtags,
      vip: Boolean(ai.vip),
      videoDurationSeconds: ai.videoDurationSeconds,
      uploaded: false,
    });
  }

  const rankedGlobal = rankGlobalHashtags(items).filter((tag) =>
    allowedTagSet.has(tag)
  );
  const hashtags = ensureTagRange(rankedGlobal, TARGET_GLOBAL_HASHTAGS, allowedTags);

  for (const item of items) {
    const itemTags = normalizeItemTags(item.hashtags, hashtags);
    item.hashtags = itemTags.length ? itemTags : hashtags.slice(0, 2);
  }

  return {
    generatedAt: new Date().toISOString(),
    sourceFolder: env.MEDIA_FOLDER,
    hashtags,
    items,
  };
}

async function main() {
  loadDotEnv();
  const env = getEnv();

  const config = await buildConfig(env);
  fs.writeFileSync(
    env.MEDIA_CONFIG_PATH,
    JSON.stringify(config, null, 2),
    "utf8"
  );

  console.log(`\n✅ Конфіг збережено: ${env.MEDIA_CONFIG_PATH}`);
  console.log(`🏷 Глобальних хештегів: ${config.hashtags.length}`);
  console.log(`📦 Елементів для аплоаду: ${config.items.length}`);
}

main().catch((err) => {
  console.error("❌ Не вдалося створити конфіг:", err.message);
  process.exit(1);
});
