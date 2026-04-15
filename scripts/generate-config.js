const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const googleTrends = (() => { try { return require("google-trends-api"); } catch { return null; } })();

const TARGET_GLOBAL_HASHTAGS = 15;
const MAX_ITEM_HASHTAGS = 12;
const VIDEO_ANALYSIS_FRAME_COUNT = 1;
const TITLE_EMOJIS = ["🔥", "💋", "✨", "😈", "🥵", "🍑", "👅", "🫦", "❤️‍🔥"];
const DESCRIPTION_EMOJIS = [
  "💦", "🌶", "🖤", "💞", "🔞", "🍒", "🍓", "😮‍💨", "🤤",
];
const TITLE_STYLE_GUIDES = [
  "confession style: start with I / I'm / I just and mention the specific mood or action",
  "invitation style: use a playful invite tied to the visible scene, not a generic tease",
  "reveal style: hint at the exact outfit, pose, body part, or action that is visible",
  "setting style: mention the location or situation if it is clearly visible",
  "question style: ask one teasing question based on the actual scene",
  "bratty one-liner style: short, bold, cocky, and scene-specific",
];
const BANNED_TITLE_PHRASES = [
  "come see what's under my",
  "just got out of the shower",
  "i can't stop touching myself",
];
const TITLE_DUPLICATE_FALLBACKS = [
  "Take a closer look at me",
  "I'm teasing you on purpose",
  "You know you want more",
  "I'm in such a naughty mood",
  "Wanna get a little closer",
  "I've been waiting for you",
];
const DESCRIPTION_LEAK_PHRASES = [
  "Just a little leak for you",
  "I'm giving you a teasing leak",
  "This is only a tiny leak of what's next",
  "These naughty leaks are just the start",
];
const PRIORITY_TRIGGER_TAGS = [
  "hot",
  "sexy",
  "boobs",
  "bigtits",
  "ass",
  "pussy",
  "solo",
  "nude",
];
const IMAGE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp",
]);
const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v",
]);

// Noise words to filter out from scraped trends
const NOISE_TERMS = new Set([
  "sign up", "resend", "privacy policy", "cookie use", "contact support",
  "privacy statement", "discover videos", "straight", "gay", "transgender",
  "discover pornstars", "verified amateurs", "pornstars", "male actors",
  "most popular", "most viewed", "top trending", "hot", "sex", "porn",
  "dick", "tits", "ass", "pussy", "boobs", // too generic as standalone trends
  "teen", "teens", "hentai", "cartoon", "anime", // not our niche
  "seks", "retro", "vintage", "celebrity", // irrelevant
  "mom", "granny", "old young", // not matching our content type
]);

// Minimal fallback — used ONLY when ALL internet sources fail
const FALLBACK_TREND_TERMS = [
  "onlyfans", "milf", "amateur", "pov", "anal", "big ass", "big tits",
  "latina", "threesome", "lesbian", "squirt", "creampie", "blowjob",
  "deepthroat", "cowgirl", "bdsm", "close up", "wet pussy", "orgasm",
];

let trendingTermsCache = null;

const DEFAULT_SEXY_TAGS = [
  "hot", "sexy", "sensual", "lingerie", "erotic", "seductive", "intimate",
  "alluring", "provocative", "adult", "glamour", "tempting", "passion",
  "romantic", "nightwear", "bodysuit", "boobs", "big tits", "ass", "blowjob",
  "strapon", "oral", "hardcore", "nsfw", "fetish", "nude", "pussy",
  "sex", "twogirl", "lesbian", "milf", "dildo",
];

/* ------------------------------------------------------------------ */
/*  Live trend fetching from search engines & adult sites               */
/* ------------------------------------------------------------------ */

async function fetchWithUA(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

function extractTermsFromHTML(html) {
  const terms = new Map(); // term -> frequency

  // Category links: /categories/some-term
  for (const m of html.matchAll(/\/categories\/([a-z][a-z0-9-]{2,30})/g)) {
    const term = m[1].replace(/-/g, " ").trim();
    if (term.length >= 3) terms.set(term, (terms.get(term) || 0) + 1);
  }

  // Tag links: /tags/some-term
  for (const m of html.matchAll(/\/tags\/([a-z][a-z0-9-]{2,30})/g)) {
    const term = m[1].replace(/-/g, " ").trim();
    if (term.length >= 3) terms.set(term, (terms.get(term) || 0) + 1);
  }

  // Search queries in URLs
  for (const m of html.matchAll(/search[=\/]([a-zA-Z+%20]{3,30})/g)) {
    try {
      const term = decodeURIComponent(m[1].replace(/\+/g, " ")).toLowerCase().trim();
      if (term.length >= 3 && /^[a-z\s]+$/.test(term)) terms.set(term, (terms.get(term) || 0) + 1);
    } catch {}
  }

  return terms;
}

function cleanTrendTerms(termsMap) {
  const cleaned = [];
  // Known pornstar name patterns to filter
  const pornstarNames = /^(aj applegate|sonya blaze|eva soda|sweetie fox|kira noir|cory chase|martina smeraldi|claudia bavel|flexy lover|darko mur|arisha mills|public agent|bratty sis|farfalla)/i;
  for (const [term, count] of termsMap.entries()) {
    const t = term.toLowerCase().trim();
    if (t.length < 3 || t.length > 30) continue;
    if (NOISE_TERMS.has(t)) continue;
    if (!/^[a-z\s]+$/.test(t)) continue;
    if (t.split(" ").length > 4) continue;
    if (pornstarNames.test(t)) continue;
    // Filter single-char or very short meaningless terms
    if (t.length <= 3 && t.split(" ").length === 1) continue;
    cleaned.push({ term: t, score: count });
  }
  return cleaned;
}

async function scrapeXhamsterTrends() {
  const allTerms = new Map();
  const urls = [
    "https://xhamster.com/categories",
    "https://xhamster.com/best/monthly",
  ];

  for (const url of urls) {
    try {
      const resp = await fetchWithUA(url);
      const html = await resp.text();
      const terms = extractTermsFromHTML(html);
      for (const [term, count] of terms) {
        allTerms.set(term, (allTerms.get(term) || 0) + count);
      }
    } catch {}
  }

  return cleanTrendTerms(allTerms);
}

async function scrapePornhubTrends() {
  const allTerms = new Map();
  const urls = [
    "https://www.pornhub.com/categories",
    "https://www.pornhub.com/video?o=tr",
    "https://www.pornhub.com/video?o=mv&t=w",
  ];

  for (const url of urls) {
    try {
      const resp = await fetchWithUA(url);
      const html = await resp.text();
      const terms = extractTermsFromHTML(html);
      for (const [term, count] of terms) {
        allTerms.set(term, (allTerms.get(term) || 0) + count);
      }
    } catch {}
  }

  return cleanTrendTerms(allTerms);
}

async function fetchGoogleTrendsData() {
  if (!googleTrends) return [];

  const results = [];
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const batches = [
    ["onlyfans", "milf", "amateur", "pov", "anal"],
    ["lesbian", "threesome", "blowjob", "creampie", "squirt"],
    ["latina", "asian", "ebony", "redhead", "stepmom"],
  ];

  for (const batch of batches) {
    try {
      const raw = await Promise.race([
        googleTrends.interestOverTime({
          keyword: batch, startTime: oneWeekAgo, geo: "US",
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000)),
      ]);
      const data = JSON.parse(raw);
      const timeline = data?.default?.timelineData || [];
      if (timeline.length > 0) {
        const last = timeline[timeline.length - 1];
        batch.forEach((kw, idx) => {
          const score = Number(last.value?.[idx] || 0);
          if (score > 0) results.push({ term: kw, score });
        });
      }
    } catch {}
  }

  // Fetch related queries for top terms
  const topTerms = results.sort((a, b) => b.score - a.score).slice(0, 3);
  for (const { term } of topTerms) {
    try {
      const raw = await Promise.race([
        googleTrends.relatedQueries({
          keyword: term, startTime: oneWeekAgo, geo: "US",
        }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000)),
      ]);
      const relData = JSON.parse(raw);
      const rising = relData?.default?.rankedList?.[1]?.rankedKeyword || [];
      const top = relData?.default?.rankedList?.[0]?.rankedKeyword || [];
      for (const item of [...rising.slice(0, 5), ...top.slice(0, 5)]) {
        const query = String(item.query || "").toLowerCase().trim();
        if (query && query.split(" ").length <= 3 && /^[a-z\s]+$/.test(query)) {
          results.push({ term: query, score: Number(item.value || 30) });
        }
      }
    } catch {}
  }

  return results;
}

async function fetchRealTrends() {
  if (trendingTermsCache !== null) return trendingTermsCache;

  console.log("📡 Fetching real trends from search engines & adult sites...");
  const combinedMap = new Map();
  let sourceCount = 0;

  // Source 1: xHamster (categories + best monthly)
  try {
    const xhTerms = await scrapeXhamsterTrends();
    if (xhTerms.length > 0) {
      sourceCount++;
      console.log(`   ✅ xHamster: ${xhTerms.length} trending terms`);
      for (const { term, score } of xhTerms) {
        combinedMap.set(term, (combinedMap.get(term) || 0) + score * 2); // weight x2
      }
    }
  } catch (e) {
    console.log(`   ❌ xHamster failed: ${e.message}`);
  }

  // Source 2: Pornhub (categories + trending + most viewed)
  try {
    const phTerms = await scrapePornhubTrends();
    if (phTerms.length > 0) {
      sourceCount++;
      console.log(`   ✅ Pornhub: ${phTerms.length} trending terms`);
      for (const { term, score } of phTerms) {
        combinedMap.set(term, (combinedMap.get(term) || 0) + score * 2);
      }
    }
  } catch (e) {
    console.log(`   ❌ Pornhub failed: ${e.message}`);
  }

  // Source 3: Google Trends (if available)
  try {
    const gtTerms = await fetchGoogleTrendsData();
    if (gtTerms.length > 0) {
      sourceCount++;
      console.log(`   ✅ Google Trends: ${gtTerms.length} data points`);
      for (const { term, score } of gtTerms) {
        combinedMap.set(term, (combinedMap.get(term) || 0) + score);
      }
    }
  } catch (e) {
    console.log(`   ❌ Google Trends failed: ${e.message}`);
  }

  // Sort by combined score, take top 60
  const sorted = [...combinedMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 60);

  if (sorted.length < 10) {
    console.log(`   ⚠️  Only ${sorted.length} terms from live sources, using fallback`);
    for (const term of FALLBACK_TREND_TERMS) {
      if (!combinedMap.has(term)) {
        sorted.push([term, 1]);
      }
    }
  }

  const terms = sorted.map(([term]) => term);
  const scoreMap = Object.fromEntries(sorted);

  console.log(`📈 Total: ${terms.length} trending terms from ${sourceCount} live source(s)`);
  console.log(`   Top 10: ${terms.slice(0, 10).join(", ")}`);

  trendingTermsCache = { terms, scoreMap };
  return trendingTermsCache;
}

/* ------------------------------------------------------------------ */
/*  Environment                                                        */
/* ------------------------------------------------------------------ */

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
    OLLAMA_MODEL: process.env.OLLAMA_MODEL || "qwen2.5vl:7b",
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

/* ------------------------------------------------------------------ */
/*  Utility functions                                                   */
/* ------------------------------------------------------------------ */

function isLowQualityModelOutput({ title, description, hashtags, filename }) {
  const normalizedTitle = String(title || "").trim().toLowerCase();
  const normalizedDescription = String(description || "").trim().toLowerCase();
  const normalizedFile = String(filename || "").trim().toLowerCase();
  const baseName = path.parse(normalizedFile).name;
  const tags = Array.isArray(hashtags) ? hashtags : [];

  if (!normalizedTitle || !normalizedDescription) return true;
  if (tags.length === 0) return true;
  if (normalizedTitle === normalizedFile) return true;
  if (normalizedTitle === baseName) return true;
  const fileWords = baseName.split(/[\s_\-]+/).filter((w) => w.length > 8);
  if (fileWords.some((word) => normalizedTitle.includes(word))) return true;
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

function sortTagsByPriority(tags) {
  const priorityIndex = new Map(
    PRIORITY_TRIGGER_TAGS.map((tag, index) => [normalizeHashtag(tag), index])
  );

  return [...new Set(tags)].sort((a, b) => {
    const normalizedA = normalizeHashtag(a);
    const normalizedB = normalizeHashtag(b);
    const priorityA = priorityIndex.get(normalizedA);
    const priorityB = priorityIndex.get(normalizedB);

    if (priorityA != null && priorityB != null) return priorityA - priorityB;
    if (priorityA != null) return -1;
    if (priorityB != null) return 1;

    return normalizedA.localeCompare(normalizedB);
  });
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
    .replace(/\bsolo\b/gi, " ")
    .replace(/\bvideo\b/gi, " ")
    .replace(/\bcontent\b/gi, " ")
    .replace(/\bclip\b/gi, " ")
    .replace(/\bmedia\b/gi, " ")
    .replace(/\bfootage\b/gi, " ")
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
  return pickFromPool(seed, pool);
}

function hashSeed(value) {
  const source = String(value || "default");
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) % 2147483647;
  }
  return Math.abs(hash);
}

function pickFromPool(seed, pool) {
  if (!Array.isArray(pool) || pool.length === 0) return "";
  return pool[hashSeed(seed) % pool.length];
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

function maybeAddLeakWording(
  text,
  { seed, maxLength = 200, chanceDivisor = 6 } = {}
) {
  const base = String(text || "").replace(/\s+/g, " ").trim();
  if (!base) return base;
  if (/\bleaks?\b/i.test(base)) return base;
  if (hashSeed(`${seed}:description-leak`) % chanceDivisor !== 0) return base;

  const leakPhrase = pickFromPool(`${seed}:description-leak-phrase`, DESCRIPTION_LEAK_PHRASES);
  if (!leakPhrase) return base;

  const separator = /[.!?…]$/.test(base) ? " " : ". ";
  const candidate = `${base}${separator}${leakPhrase}`;
  return candidate.length <= maxLength ? candidate : base;
}

function truncateText(text, maxLength = 60) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd() + "…";
}

function normalizeTitleForComparison(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleUsesBannedTemplate(title) {
  const normalized = normalizeTitleForComparison(title);
  return BANNED_TITLE_PHRASES.some((phrase) => normalized.includes(phrase));
}

function buildTitleCandidateFromDescription(description) {
  const cleaned = sanitizeEnglishText(description, "")
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, " ")
    .trim();
  if (!cleaned) return "";

  const clauses = cleaned
    .split(/(?:\.\.\.|[.!?]|,|;|:)/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 12);

  return truncateText(clauses[0] || cleaned, 52);
}

function finalizeTitleCandidate(title, { emoji }) {
  const sanitized = sanitizeEnglishText(title, "");
  const cleaned = removeOverusedTitleWords(sanitized, "");
  const truncated = truncateText(cleaned, 56);
  return enforceSexyTone(truncated, { isTitle: true, emoji });
}

function ensureUniqueGeneratedTitle({ title, description, fileName }, usedTitles) {
  const emoji = pickEmoji(`${fileName}:title`, TITLE_EMOJIS);
  const candidates = [
    title,
    buildTitleCandidateFromDescription(description),
    pickFromPool(`${fileName}:title-fallback`, TITLE_DUPLICATE_FALLBACKS),
  ];

  for (const candidate of candidates) {
    const finalized = finalizeTitleCandidate(candidate, { emoji });
    const normalized = normalizeTitleForComparison(finalized);
    if (!normalized) continue;
    if (usedTitles.has(normalized)) continue;
    if (titleUsesBannedTemplate(finalized)) continue;
    return finalized;
  }

  const lastResort = finalizeTitleCandidate(
    `${pickFromPool(`${fileName}:title-fallback`, TITLE_DUPLICATE_FALLBACKS)} tonight`,
    { emoji }
  );
  return lastResort;
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

/* ------------------------------------------------------------------ */
/*  FFmpeg / media helpers                                              */
/* ------------------------------------------------------------------ */

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

function createResizedImageForAi(imagePath, maxSize = 512) {
  if (!hasSips()) return null;

  const tempFile = path.join(
    os.tmpdir(),
    `onlynice-ai-image-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
  );

  const run = spawnSync(
    "sips",
    [
      "-s", "format", "jpeg",
      "-Z", String(maxSize),
      imagePath,
      "--out", tempFile,
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
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
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
  const safeCount = Math.max(1, Math.min(10, Math.round(frameCount || 4)));

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
        "-ss", String(timestamp),
        "-i", videoPath,
        "-vframes", "1",
        "-vf", "scale='min(512,iw)':'min(512,ih)':force_original_aspect_ratio=decrease",
        "-q:v", "2",
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

/* ------------------------------------------------------------------ */
/*  Ollama Vision Analysis — the core                                   */
/* ------------------------------------------------------------------ */

async function analyzeWithVision({
  filePath,
  mediaType,
  env,
  videoDurationSeconds,
  allowedTags,
  trendingTerms,
}) {
  const filename = path.basename(filePath);

  // Extract frames (video) or prepare image
  let framePaths = [];
  const tempFiles = [];

  if (mediaType === "video") {
    framePaths = extractVideoFrames(
      filePath,
      videoDurationSeconds,
      VIDEO_ANALYSIS_FRAME_COUNT
    );
    tempFiles.push(...framePaths);
  } else {
    const resized = createResizedImageForAi(filePath);
    if (resized) {
      framePaths = [resized];
      tempFiles.push(resized);
    } else {
      framePaths = [filePath];
    }
  }

  if (!framePaths.length) {
    throw new Error("No frames available for vision analysis");
  }

  // Convert to base64 for Ollama vision API
  const base64Images = framePaths.map((fp) => toBase64(fp));

  // Cleanup temp files immediately
  for (const fp of tempFiles) {
    try { fs.unlinkSync(fp); } catch {}
  }

  const allowedTagsList = allowedTags.join(", ");
  const trendTermsList = (trendingTerms || []).join(", ");
  const titleStyleGuide = pickFromPool(`${filename}:title-style`, TITLE_STYLE_GUIDES);
  const durationInfo =
    mediaType === "video" && Number.isFinite(videoDurationSeconds)
      ? `\nVideo duration: ${Math.round(videoDurationSeconds)} seconds.`
      : "";

  const prompt = `Adult content SEO analyst. Analyze this ${mediaType} frame.${durationInfo}

Describe what you SEE: body parts, actions, nudity level, setting.

VIP RULE (IMPORTANT): Set "vip" to true ONLY if at least one of these is clearly visible:
- Naked pussy/vagina (uncovered, no panties)
- Naked breasts/boobs with nipples visible (no bra or covering)
- No panties / bare crotch clearly visible
Otherwise vip=false.
Examples of vip=false: bra on, panties on, lingerie/swimsuit that still covers nipples or pussy, hands/pose/angle covering intimate parts, sideboob/cleavage only, implied nudity, transparent clothes without clear direct visibility.

Title (max 60 chars): Write as if the GIRL HERSELF is posting this. First person, flirty, teasing tone. 1 emoji at end, English.
Make it scene-specific and fresh, based on what is actually visible. Mention the real action, pose, setting, outfit, or body part if relevant.
Use this title approach for THIS file: ${titleStyleGuide}
Avoid generic titles that could fit any file.
Never use these exact phrases: "Come see what's under my...", "Just got out of the shower...", "I can't stop touching myself..."
NO filename "${filename}", NO generic/boring words (sexy/hot/video/content/showcase).

Description (max 200 chars): Also first person from the girl's perspective. Teasing, inviting the viewer. 1 emoji, English.
Keep it specific to the visible scene. Do not reuse the title wording.

Hashtags: pick 5-12 ONLY from: ${allowedTagsList}
Prioritize direct trigger tags first when they clearly match what is visible, especially: hot, sexy, boobs, big tits, ass, pussy, solo, nude.
Put the strongest click-driving tags first, then add scene/action tags.
Trending terms from adult sites: ${trendTermsList}
Pick 1-5 matching terms. Rate relevance 0-100.

JSON only:
{"title":"...","description":"...","hashtags":[],"vip":true,"trendTerms":[],"trendScore":0,"contentSummary":"what you see"}`;

  let response;
  try {
    response = await fetch(`${env.OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.OLLAMA_MODEL,
        format: "json",
        stream: false,
        options: {
          temperature: 0.75,
          repeat_penalty: 1.15,
          num_predict: 512,
        },
        messages: [
          {
            role: "user",
            content: prompt,
            images: base64Images,
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

  // Process title
  const rawTitle = sanitizeEnglishText(parsed.title, "");
  const cleanedTitle = removeOverusedTitleWords(rawTitle, "");
  const titleEmoji = pickEmoji(`${filename}:title`, TITLE_EMOJIS);
  const title = enforceSexyTone(cleanedTitle, { isTitle: true, emoji: titleEmoji });

  // Process description
  const rawDescription = sanitizeEnglishText(parsed.description, "");
  const leakReadyDescription = maybeAddLeakWording(rawDescription, {
    seed: filename,
    maxLength: 200,
  });
  const descriptionEmoji = pickEmoji(`${filename}:description`, DESCRIPTION_EMOJIS);
  const description = enforceSexyTone(leakReadyDescription, {
    isTitle: false,
    emoji: descriptionEmoji,
  });

  // Process hashtags — filter to allowed only
  const allowedTagSet = new Set(allowedTags);
  let hashtags = normalizeTags(parsed.hashtags || []).filter(
    (tag) => allowedTagSet.has(tag)
  );
  if (hashtags.length < 3) {
    // If model returned too few valid tags, keep what we got
    const modelTags = normalizeTags(parsed.hashtags || []);
    hashtags = [...new Set([...hashtags, ...modelTags])].slice(0, MAX_ITEM_HASHTAGS);
  }
  hashtags = sortTagsByPriority(hashtags).slice(0, MAX_ITEM_HASHTAGS);

  // VIP — directly from model's vision analysis
  const vip = Boolean(parsed.vip);

  // Trend terms
  const trendTerms = Array.isArray(parsed.trendTerms)
    ? parsed.trendTerms.filter((t) => typeof t === "string" && t.trim()).slice(0, 5)
    : [];
  const trendScore = Math.max(0, Math.min(100, Math.round(Number(parsed.trendScore) || 0)));

  // Content summary for logging
  const contentSummary = String(parsed.contentSummary || "").trim();

  // Quality check
  if (
    isLowQualityModelOutput({ title, description, hashtags, filename })
  ) {
    throw new Error(
      `Vision model returned low quality output for ${filename}`
    );
  }

  return {
    title,
    description,
    hashtags,
    vip,
    trendTermsUsed: trendTerms,
    trendScore,
    contentSummary,
    videoDurationSeconds: Number.isFinite(videoDurationSeconds)
      ? Math.round(videoDurationSeconds)
      : null,
  };
}

/* ------------------------------------------------------------------ */
/*  Config building — orchestrator                                      */
/* ------------------------------------------------------------------ */

function rankGlobalHashtags(mediaItems) {
  const stats = new Map();

  for (const item of mediaItems) {
    for (const tag of item.hashtags) {
      stats.set(tag, (stats.get(tag) || 0) + 1);
    }
  }

  return [...stats.entries()]
    .sort((a, b) => {
      const orderedPair = sortTagsByPriority([a[0], b[0]]);
      const isPriorityOrderDifferent =
        orderedPair.length === 2 &&
        (orderedPair[0] !== a[0] || orderedPair[1] !== b[0]);

      if (isPriorityOrderDifferent) {
        return orderedPair[0] === a[0] ? -1 : 1;
      }

      return b[1] - a[1] || a[0].localeCompare(b[0]);
    })
    .slice(0, TARGET_GLOBAL_HASHTAGS)
    .map(([tag]) => tag);
}

async function buildConfig(env) {
  const allowedTags = loadAllowedTags(env.TAG_CATEGORIES_PATH);
  const allowedTagSet = new Set(allowedTags);

  console.log(`🏷️  ${allowedTags.length} allowed tags loaded`);

  // Fetch real trends from internet
  const trendsData = await fetchRealTrends();
  const trendingTerms = trendsData.terms;
  console.log(`📈 ${trendingTerms.length} real trending terms loaded`);

  if (!fs.existsSync(env.MEDIA_FOLDER)) {
    throw new Error(`Media folder not found: ${env.MEDIA_FOLDER}`);
  }

  const allFiles = fs
    .readdirSync(env.MEDIA_FOLDER)
    .filter((f) => fs.statSync(path.join(env.MEDIA_FOLDER, f)).isFile())
    .sort((a, b) => a.localeCompare(b));

  const MAX_FILE_SIZE = 1 * 1024 * 1024 * 1024; // 1 GB
  const files = allFiles.filter((file) => {
    if (file.startsWith(".") || !isSupportedMedia(file)) return false;
    const size = fs.statSync(path.join(env.MEDIA_FOLDER, file)).size;
    if (size > MAX_FILE_SIZE) {
      console.log(`⚠️  Skipping ${file} — too large (${(size / (1024 * 1024)).toFixed(0)} MB > 1 GB)`);
      return false;
    }
    return true;
  });

  if (!files.length) {
    throw new Error(`No supported media files found in ${env.MEDIA_FOLDER}`);
  }

  let existingConfig = null;
  if (fs.existsSync(env.MEDIA_CONFIG_PATH)) {
    try {
      existingConfig = JSON.parse(
        fs.readFileSync(env.MEDIA_CONFIG_PATH, "utf8")
      );
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
        trendTermsUsed: Array.isArray(existing.trendTermsUsed)
          ? existing.trendTermsUsed
          : [],
        trendScore: Number(existing.trendScore || 0),
        vip: Boolean(existing.vip),
        videoDurationSeconds: Number.isFinite(existing.videoDurationSeconds)
          ? Math.round(existing.videoDurationSeconds)
          : null,
        uploaded: Boolean(existing.uploaded),
        analysisAttempted:
          Boolean(existing.analysisAttempted) || isItemAnalyzed(existing),
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
      analysisAttempted: false,
    };
  });

  /* ---------- Progress tracking ---------- */

  const completedMap = new Array(files.length).fill(false);
  const concurrency = 1; // Force sequential — vision model can't handle parallel on MacBook Air
  const total = files.length;
  const startedAt = Date.now();
  let completed = 0;
  let fallbackCount = 0;
  let lastProgressLineLength = 0;
  let spinnerIndex = 0;
  const spinnerFrames = [
    "⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏",
  ];

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
      items[index].analysisAttempted = true;
      completed += 1;
    }
  }

  const usedGeneratedTitles = new Set(
    items
      .filter((item, index) => completedMap[index])
      .map((item) => normalizeTitleForComparison(item.title))
      .filter(Boolean)
  );

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

  /* ---------- Per-file analysis ---------- */

  async function analyzeFile(file) {
    const fullPath = path.join(env.MEDIA_FOLDER, file);
    const mediaType = detectMediaType(fullPath);
    const videoDurationSeconds =
      mediaType === "video" ? getVideoDurationSeconds(fullPath) : null;

    const FILE_TIMEOUT_MS = 300000; // 5 min per file for vision model

    let ai;
    let usedFallback = false;
    let lastModelError = null;
    const attempts = Math.max(1, Number(env.MODEL_RETRY_COUNT || 0) + 1);

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        ai = await Promise.race([
          analyzeWithVision({
            filePath: fullPath,
            mediaType,
            env,
            videoDurationSeconds,
            allowedTags,
            trendingTerms,
          }),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Vision analysis timed out (3 min)")),
              FILE_TIMEOUT_MS
            )
          ),
        ]);

        // Log results
        const durLabel = videoDurationSeconds
          ? " " + formatDuration(videoDurationSeconds)
          : "";
        const trendTerms = ai.trendTermsUsed || [];
        const scoreLabel =
          ai.trendScore > 0 ? `${ai.trendScore}/100` : "n/a";

        logInfo(
          `\n🎬 ${file} (${mediaType}${durLabel})`
        );
        if (ai.contentSummary) {
          logInfo(`   👁️  Saw: ${ai.contentSummary}`);
        }
        logInfo(`   📝 Title: ${ai.title}`);
        logInfo(`   📄 Desc: ${ai.description}`);
        logInfo(`   🏷️  Tags: ${(ai.hashtags || []).join(", ")}`);
        if (trendTerms.length > 0) {
          logInfo(
            `   📈 Trends: ${trendTerms.join(", ")} (score: ${scoreLabel})`
          );
        }
        logInfo(`   ${ai.vip ? "🔞 VIP: YES (explicit nudity)" : "✅ VIP: no"}`);

        lastModelError = null;
        break;
      } catch (err) {
        lastModelError = err;
        if (attempt < attempts) {
          logInfo(
            `⚠️  Retry ${attempt}/${attempts - 1} for ${file}: ${err.message}`
          );
        }
      }
    }

    if (!ai) {
      usedFallback = true;
      logInfo(
        `⚠️  Failed for ${file}: ${lastModelError?.message || "Unknown error"}`
      );
      ai = {
        title: "",
        description: "",
        hashtags: [],
        vip: false,
        trendTermsUsed: [],
        trendScore: 0,
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
      trendTermsUsed: ai.trendTermsUsed || [],
      trendScore: ai.trendScore || 0,
      vip: Boolean(ai.vip),
      videoDurationSeconds: ai.videoDurationSeconds,
      uploaded: false,
      analysisAttempted: true,
      usedFallback,
    };
  }

  /* ---------- Run workers ---------- */

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
      logInfo(`\u23f3 Analyzing ${file}...`);
      const result = await analyzeFile(file);

      const current = items[index];
      current.mediaType = result.mediaType;
      current.title = ensureUniqueGeneratedTitle(result, usedGeneratedTitles);
      current.description = result.description;
      current.hashtags = result.hashtags;
      current.trendTermsUsed = result.trendTermsUsed || [];
      current.trendScore = result.trendScore || 0;
      current.vip = Boolean(result.vip);
      current.videoDurationSeconds = result.videoDurationSeconds;
      current.uploaded = false;
      current.analysisAttempted = Boolean(result.analysisAttempted);

      const normalizedTitle = normalizeTitleForComparison(current.title);
      if (normalizedTitle) {
        usedGeneratedTitles.add(normalizedTitle);
      }

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

/* ------------------------------------------------------------------ */
/*  Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  loadDotEnv();
  const env = getEnv();
  console.log("🧠 Vision pipeline: Ollama qwen2.5vl → analyze + SEO + VIP");
  console.log(`🔗 Ollama: ${env.OLLAMA_URL} | Model: ${env.OLLAMA_MODEL}`);
  console.log(`⚡ Concurrency: ${env.AI_ANALYSIS_CONCURRENCY} | Retries: ${env.MODEL_RETRY_COUNT}`);

  const config = await buildConfig(env);

  console.log(`\n✅ Config saved: ${env.MEDIA_CONFIG_PATH}`);
  console.log(`🏷  Global hashtags: ${config.hashtags.length}`);
  console.log(`📦 Items ready: ${config.items.length}`);

  const vipCount = config.items.filter((i) => i.vip).length;
  const analyzedCount = config.items.filter(
    (i) => String(i.title || "").trim().length > 0
  ).length;
  console.log(`🔞 VIP items: ${vipCount}`);
  console.log(`🎯 Analyzed: ${analyzedCount}/${config.items.length}`);
}

main().catch((err) => {
  console.error("❌ Failed:", err.message);
  process.exit(1);
});
