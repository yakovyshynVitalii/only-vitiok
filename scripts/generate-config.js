const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const googleTrends = (() => { try { return require("google-trends-api"); } catch { return null; } })();

const TARGET_GLOBAL_HASHTAGS = Number(process.env.GLOBAL_TAG_LIMIT) === 100 ? 100 : 15;
const MAX_ITEM_HASHTAGS = 12;
const MAX_TITLE_LENGTH = 60;
const DEFAULT_AI_IMAGE_MAX_SIZE = 384;
const DEFAULT_VIDEO_ANALYSIS_FRAME_COUNT = 2;
const DEFAULT_OLLAMA_NUM_PREDICT = 360;
const TITLE_EMOJIS = ["🔥", "💋", "✨", "😈", "🥵", "🍑", "👅", "🫦", "❤️‍🔥"];
const DESCRIPTION_EMOJIS = [
  "💦", "🌶", "🖤", "💞", "🔞", "🍒", "🍓", "😮‍💨", "🤤",
];
const TITLE_STYLE_GUIDES = [
  "leaked style: dirty leaked content — 'My ex leaked this and now you see my wet pussy' / 'Someone stole my nudes and I don't even care'",
  "tease style: slutty teasing — 'Ripped off my bra come stare at my tits' / 'Bent over with nothing on wanna see more'",
  "brag style: dirty bragging — 'My fat ass in this thong makes you hard huh' / 'These tits are why you can't stop jerking off'",
  "dare style: slutty dare — 'Bet you cum before you finish scrolling' / 'Try not to get hard looking at my naked ass'",
  "confession style: dirty confession — 'Took these nudes while my roommate slept next door' / 'Couldn't stop touching myself and had to film it'",
  "homemade style: raw slutty amateur — 'Real homemade pussy pic from my bed' / 'Just filmed myself naked in the mirror no filter'",
];
const BANNED_TITLE_PHRASES = [
  "come see what's under my",
  "just got out of the shower",
  "exclusive content",
  "subscribe to see more",
];
const TITLE_DUPLICATE_FALLBACKS = [
  "Wasn't supposed to post this but here we are",
  "Leaked from my private gallery oops",
  "This was just for me but fuck it",
  "Too horny not to share this",
  "My private content just got out",
  "Caught on camera and I don't even care",
  "This wasn't meant for you but enjoy",
  "Someone leaked my private album",
];
const DESCRIPTION_LEAK_PHRASES = [
  "Wasn't supposed to post this but I'm too horny to care",
  "My ex had these saved and now the whole internet sees me naked",
  "Someone found my private album and honestly it's hot that you're looking",
  "This was just for me but why keep this body to myself",
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
  const parseNumber = (value, fallback, min, max) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.round(parsed)));
  };
  const parseBool = (value, fallback = false) => {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!normalized) return fallback;
    return normalized === "1" || normalized === "true" || normalized === "yes";
  };
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
    OLLAMA_KEEP_ALIVE: process.env.OLLAMA_KEEP_ALIVE || "30m",
    OLLAMA_NUM_PREDICT: parseNumber(
      process.env.OLLAMA_NUM_PREDICT,
      DEFAULT_OLLAMA_NUM_PREDICT,
      180,
      800
    ),
    AI_IMAGE_MAX_SIZE: parseNumber(
      process.env.AI_IMAGE_MAX_SIZE,
      DEFAULT_AI_IMAGE_MAX_SIZE,
      256,
      768
    ),
    VIDEO_ANALYSIS_FRAME_COUNT: parseNumber(
      process.env.VIDEO_ANALYSIS_FRAME_COUNT,
      DEFAULT_VIDEO_ANALYSIS_FRAME_COUNT,
      1,
      6
    ),
    VIP_RECHECK: parseBool(process.env.VIP_RECHECK, false),
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

  // Detect clinical/narrator language — model writes like an art critic instead of a real girl
  const clinicalPatterns = [
    /\bshowcasing\b/i,
    /\bon full display\b/i,
    /\bconfidently\b/i,
    /\baccentuat/i,
    /\bhighlighting\b/i,
    /\bnothing more to see\b/i,
    /\ball its glory\b/i,
    /\bthe perfect curve\b/i,
    /\bmaking .{0,20} stand out\b/i,
    /\bintricate design\b/i,
    /\bthe background is\b/i,
    /\bsilhouette\b/i,
  ];
  const clinicalHits = clinicalPatterns.filter(p => p.test(normalizedDescription)).length;
  if (clinicalHits >= 2) return true;

  // Detect narrator-style descriptions that start with pose/action descriptions
  // Real girls don't write "Standing in front of mirror, fully nude..."
  const narratorStartPatterns = [
    /^standing\s+(in|confidently|nude|naked|in front)/i,
    /^sitting\s+(on|in|naked|nude)/i,
    /^lying\s+(on|in|naked|nude|down)/i,
    /^showing\s+(off|her|my|the)/i,
    /^posing\s+(in|with|naked|nude)/i,
    /^wearing\s+(a|her|nothing|black|white|red)/i,
    /^fully\s+(nude|naked)/i,
    /^a\s+(young|beautiful|hot|sexy|stunning)\s+(woman|girl)/i,
    /^the\s+(image|photo|picture|video)\s+(shows|features|depicts)/i,
  ];
  if (narratorStartPatterns.some(p => p.test(normalizedDescription))) return true;
  if (narratorStartPatterns.some(p => p.test(normalizedTitle))) return true;

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
  // Keep model's original order — it picks the most relevant tags first
  return [...new Set(tags)];
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

function removeOverusedTitleWords(title, fallback = "My leaked nudes") {
  const cleaned = String(title || "")
    .replace(/\bsensual\b/gi, " ")
    .replace(/\bvideo\b/gi, " ")
    .replace(/\bcontent\b/gi, " ")
    .replace(/\bclip\b/gi, " ")
    .replace(/\bmedia\b/gi, " ")
    .replace(/\bfootage\b/gi, " ")
    .replace(/\bmoment\b/gi, " ")
    .replace(/\bshowcasing\b/gi, " ")
    .replace(/\baccentuat\w*\b/gi, " ")
    .replace(/\bhighlighting\b/gi, " ")
    .replace(/\bconfidently\b/gi, " ")
    .replace(/\bsilhouette\b/gi, " ")
    .replace(/\bintricate\b/gi, " ")
    .replace(/\bcomplement\w*\b/gi, " ")
    .replace(/\bon full display\b/gi, " ")
    .replace(/\bstand(s|ing)? out\b/gi, " ")
    .replace(/\bfeatures\b/gi, " ")
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

const VIP_NIPPLE_COVER_PATTERNS = [
  /\bwearing\s+(a\s+)?(bra|bikini|bikini\s+top|top|shirt|crop\s+top|dress|corset|bustier|bodysuit|swimsuit)\b/i,
  /\b(in|with)\s+(a\s+)?(bra|bikini|bikini\s+top|top|shirt|crop\s+top|dress|corset|bustier|bodysuit|swimsuit)\b/i,
  /\b(bra|bikini|bikini\s+top|top|shirt|dress|corset|bustier|bodysuit|swimsuit)\s+(is\s+)?(on|covering)\b/i,
  /\bnipples?\s+(are\s+)?(hidden|covered|obscured|not\s+visible)\b/i,
  /\b(no\s+visible\s+nipple|nipples?\s+not\s+visible)\b/i,
  /\bcovering\s+(her\s+)?(nipple|breast|chest)\b/i,
  /\bcovered\s+(nipple|breast|chest)s?\b/i,
  /\b(hands?|arms?)\s+(cover|covering|hide|hiding|obscure|obscuring)\s+(her\s+)?(nipples?|breasts?|chest)\b/i,
];

const VIP_PUSSY_COVER_PATTERNS = [
  /\bwearing\s+(a\s+)?(panties|thong|underwear|bikini|bikini\s+bottoms?|bodysuit|swimsuit|shorts|pants|jeans|skirt)\b/i,
  /\b(in|with)\s+(a\s+)?(panties|thong|underwear|bikini|bikini\s+bottoms?|bodysuit|swimsuit|shorts|pants|jeans|skirt)\b/i,
  /\b(panties|thong|underwear|bikini|bikini\s+bottoms?|bodysuit|swimsuit|shorts|pants|jeans|skirt)\s+(is\s+|are\s+)?(on|covering)\b/i,
  /\b(pussy|vagina|vulva|labia|crotch)\s+(is\s+|are\s+)?(hidden|covered|obscured|not\s+visible)\b/i,
  /\b(no\s+visible\s+(pussy|vagina|vulva|labia|crotch)|(pussy|vagina|vulva|labia|crotch)\s+not\s+visible)\b/i,
  /\bcovering\s+(her\s+)?(pussy|vagina|vulva|labia|crotch)\b/i,
  /\bcovered\s+(pussy|vagina|vulva|labia|crotch)\b/i,
  /\b(hands?|arms?)\s+(cover|covering|hide|hiding|obscure|obscuring)\s+(her\s+)?(pussy|vagina|vulva|labia|crotch)\b/i,
];

function hasPattern(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function deriveVipFromContent(contentSummary) {
  const summary = String(contentSummary || "");
  const summaryLower = summary.toLowerCase();

  const markerNipplesYes = /\bNUDE_NIPPLES\s*=\s*YES\b/i.test(summary);
  const markerPussyYes = /\bNUDE_PUSSY\s*=\s*YES\b/i.test(summary);
  const markerNipplesNo = /\bNUDE_NIPPLES\s*=\s*NO\b/i.test(summary);
  const markerPussyNo = /\bNUDE_PUSSY\s*=\s*NO\b/i.test(summary);

  const keywordNipples = /\b(bare\s+(nipples?|breasts?|boobs?|tits?|chest)|nude\s+(breasts?|boobs?|tits?)|naked\s+(breasts?|boobs?|tits?|chest)|topless|wet\s+nipples?|no\s+bra\s+(visible|present|on)?|no\s+visible\s+clothing.{0,80}\b(nipples?|breasts?|boobs?|tits?|chest)|\b(nipples?|breasts?|boobs?|tits?|chest).{0,80}no\s+visible\s+clothing|(nipples?|breasts?|boobs?|tits?)\s+(are\s+|is\s+)?(visible|exposed|showing|shown|displayed|prominently\s+displayed|bare|wet)|exposed\s+(nipples?|breasts?|boobs?|tits?))\b/i.test(summaryLower);
  const keywordPussy = /\b(wetpussy|bare\s+(pussy|vagina|vulva|labia|crotch)|nude\s+(pussy|vagina|vulva|labia|crotch|lower\s+body)|naked\s+(pussy|vagina|vulva|labia|crotch|lower\s+body)|visible\s+(pussy|vagina|vulva|labia|crotch)|no\s+(panties|thong|underwear|bikini\s+bottoms?)\s+(visible|present|on)?|((pussy|vagina|vulva|labia|crotch)\s+(is\s+|are\s+)?(visible|exposed|showing|shown|displayed|bare|wet))|exposed\s+(pussy|vagina|vulva|labia|crotch)|wet\s+(pussy|vagina|vulva|labia|crotch))\b/i.test(summaryLower);
  const fullNudeBody = /\b(fully\s+(nude|naked)|completely\s+(nude|naked)|nude\s+(woman|girl|body|blonde|brunette)|naked\s+(woman|girl|body|blonde|brunette)|wearing\s+nothing|nothing\s+on|no\s+clothes|without\s+clothes)\b/i.test(summaryLower);
  const explicitlyAssOnly = /\b(bare\s+ass\s+alone|bare\s+buttocks?\s+alone|only\s+(her\s+)?(ass|buttocks?|butt)\s+(is\s+)?visible)\b/i.test(summaryLower);

  const nipplesCovered = hasPattern(summaryLower, VIP_NIPPLE_COVER_PATTERNS);
  const pussyCovered = hasPattern(summaryLower, VIP_PUSSY_COVER_PATTERNS);

  const hasBareNipples = (markerNipplesYes || (!markerNipplesNo && keywordNipples)) && !nipplesCovered;
  const hasBarePussy = (markerPussyYes || (!markerPussyNo && keywordPussy)) && !pussyCovered;
  const hasFullNudeBody = fullNudeBody && !explicitlyAssOnly && (!nipplesCovered || !pussyCovered);

  return hasBareNipples || hasBarePussy || hasFullNudeBody;
}

function shouldRunVipRecheck(contentSummary, hashtags = []) {
  const summary = String(contentSummary || "").toLowerCase();
  const tags = normalizeTags(hashtags);
  const tagSignals = new Set(["nude", "naked", "pussy"]);

  return (
    /\b(nude|naked|topless|bare\s+(body|back|buttocks|ass|breasts?|boobs?|tits?|chest|crotch)|no\s+(bra|panties|thong|underwear))\b/i.test(summary) ||
    tags.some((tag) => tagSignals.has(tag))
  );
}

function deriveVipFromItemEvidence({ contentSummary, title, description, hashtags } = {}) {
  const tagText = normalizeTags(hashtags || []).join(" ");
  return deriveVipFromContent(
    [contentSummary, title, description, tagText].filter(Boolean).join(" ")
  );
}

// Tags that MUST be confirmed by contentSummary keywords — both actions AND body parts
const TAG_CONTENT_REQUIREMENTS = {
  // Body-part tags — MUST be visible in contentSummary
  pussy: /\b(pussy|vagina|vulva|labia|clit|NUDE_PUSSY=YES)\b/i,
  wetpussy: /\b(wet\s+pussy|dripping|soaking|NUDE_PUSSY=YES)\b/i,
  nude: /\b(nude|naked|completely\s+naked|nothing|no\s+cloth|NUDE_NIPPLES=YES|NUDE_PUSSY=YES|NUDE_ASS=YES)\b/i,
  naked: /\b(naked|nude|completely\s+naked|nothing|NUDE_NIPPLES=YES|NUDE_PUSSY=YES|NUDE_ASS=YES)\b/i,
  ass: /\b(ass|butt|booty|buttocks|rear|behind|cheeks)\b/i,
  bigass: /\b(big\s+ass|large\s+ass|big\s+butt|thick\s+ass|round\s+ass|big\s+booty)\b/i,
  bigtits: /\b(big\s+(tits|breasts|boobs)|large\s+(tits|breasts|boobs)|huge\s+(tits|breasts|boobs))\b/i,
  boobs: /\b(boobs|breasts|tits|chest|nipple)\b/i,
  nipples: /\b(nipple|areola|NUDE_NIPPLES=YES)\b/i,
  feet: /\b(feet|foot|toes|sole)\b/i,
  stockings: /\b(stockings|thigh\s+highs|nylons|fishnets)\b/i,
  dildo: /\b(dildo|toy|vibrator|wand)\b/i,
  masturbation: /\b(masturbat|touching\s+(herself|myself)|fingering|playing\s+with\s+(herself|myself|her\s+pussy))\b/i,
  masturbate: /\b(masturbat|touching\s+(herself|myself)|fingering|playing\s+with)\b/i,
  fingering: /\b(finger|fingering|fingers\s+in)\b/i,
  // Action-specific tags
  blowjob: /\b(blowjob|sucking|suck(s|ing)?\s+(cock|dick|penis)|oral\s+sex|giving\s+head|mouth\s+on\s+(cock|dick|penis))\b/i,
  deepthroat: /\b(deepthroat|deep\s+throat|gagging|throat\s+fuck)\b/i,
  anal: /\b(anal|anus|butt\s*(fuck|sex|plug|play))\b/i,
  analsex: /\b(anal\s*sex|anal\s+penetrat|dick\s+in\s+(her\s+)?ass)\b/i,
  analcreampie: /\b(anal\s*creampie|cum\s+in\s+(her\s+)?ass)\b/i,
  strapon: /\b(strap\s*on|pegging|harness)\b/i,
  threesome: /\b(threesome|3some|three\s*(way|some)|two\s+(guys?|girls?|men|women))\b/i,
  "3some": /\b(threesome|3some|three\s*(way|some))\b/i,
  lesbian: /\b(lesbian|girl\s+on\s+girl|two\s+girls|two\s+women|kissing\s+(another\s+)?girl)\b/i,
  interracial: /\b(interracial|bbc|different\s+race)\b/i,
  bbc: /\b(bbc|big\s+black\s+cock)\b/i,
  squirting: /\b(squirt|squirting|gush)\b/i,
  creampie: /\b(creampie|cum\s+inside|cum\s+in\s+(her\s+)?pussy)\b/i,
  cumshot: /\b(cumshot|cum\s+shot|cum\s+on|facial|cum\s+dripping)\b/i,
  facial: /\b(facial|cum\s+on\s+(her\s+)?face)\b/i,
  cuminmouth: /\b(cum\s+in\s+(her\s+)?mouth|swallow)\b/i,
  cunnilingus: /\b(cunnilingus|licking\s+pussy|eating\s+(her\s+)?(out|pussy))\b/i,
  facesitting: /\b(facesit|face\s*sit|sitting\s+on\s+(his\s+)?face)\b/i,
  rimjob: /\b(rimjob|rim\s+job|rimming|licking\s+(his|her)?\s*ass)\b/i,
  rimming: /\b(rimjob|rimming|licking\s+(his|her)?\s*ass)\b/i,
  titfuck: /\b(titfuck|tit\s*fuck|titjob|tit\s*job|between\s+(her\s+)?breasts)\b/i,
  titjob: /\b(titfuck|tit\s*fuck|titjob|tit\s*job)\b/i,
  ridingcock: /\b(riding\s+(cock|dick|him)|cowgirl|reverse\s+cowgirl)\b/i,
  ridingdick: /\b(riding\s+(cock|dick|him)|cowgirl|reverse\s+cowgirl)\b/i,
  publicsex: /\b(public\s*(sex|fuck)|outdoor\s*(sex|fuck)|outside)\b/i,
  outdoorsex: /\b(outdoor\s*(sex|fuck)|outside|public\s+park)\b/i,
  showersex: /\b(shower\s*(sex|fuck)|bathroom\s*(sex|fuck))\b/i,
  kitchensex: /\b(kitchen\s*(sex|fuck))\b/i,
  doggystyle: /\b(dogg(y|ie)\s*style|from\s+behind|bent\s+over.*penetrat)\b/i,
  missionary: /\b(missionary|on\s+her\s+back.*penetrat)\b/i,
  cowgirl: /\b(cowgirl|riding\s+(on\s+top|him|cock|dick))/i,
  reversecowgirl: /\b(reverse\s+cowgirl)/i,
  girlongirl: /\b(girl\s+on\s+girl|lesbian|two\s+girls)\b/i,
  twogirl: /\b(two\s*girl|girl\s+on\s+girl|lesbian|both\s+girls)\b/i,
};

function validateTagsFromContent(tags, contentSummary) {
  const summary = String(contentSummary || "").toLowerCase();
  return tags.filter((tag) => {
    const normalizedTag = normalizeHashtag(tag);
    const requirement = TAG_CONTENT_REQUIREMENTS[normalizedTag];
    // If no requirement defined, keep the tag (it's a descriptive tag like "blonde", "busty")
    if (!requirement) return true;
    // Action tag — must be confirmed by content summary
    return requirement.test(summary);
  });
}

function splitGraphemes(value) {
  const text = String(value || "");
  if (typeof Intl !== "undefined" && Intl.Segmenter) {
    return Array.from(
      new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text),
      (part) => part.segment
    );
  }
  return Array.from(text);
}

function trimToLength(text, maxLength) {
  const limit = Math.max(0, Number(maxLength) || 0);
  let out = "";
  for (const part of splitGraphemes(text)) {
    if (out.length + part.length > limit) break;
    out += part;
  }
  return out.trimEnd();
}

function truncateText(text, maxLength = MAX_TITLE_LENGTH) {
  const limit = Math.max(0, Number(maxLength) || 0);
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  if (limit === 0) return "";
  if (limit === 1) return "…";
  return `${trimToLength(normalized, limit - 1)}…`;
}

function appendEmoji(text, emoji, maxLength) {
  const base = String(text || "").trim();
  const suffix = emoji ? ` ${emoji}` : "";
  const hasEmoji = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(
    base
  );

  if (!Number.isFinite(maxLength)) {
    return hasEmoji || !suffix ? base : `${base}${suffix}`;
  }

  if (hasEmoji || !suffix) {
    return truncateText(base, maxLength);
  }

  const bodyLimit = Math.max(0, maxLength - suffix.length);
  const trimmedBase = truncateText(base, bodyLimit);
  const candidate = `${trimmedBase}${suffix}`.trim();
  return truncateText(candidate, maxLength);
}

function enforceSexyTone(
  text,
  { isTitle = false, emoji = "🔥", maxLength } = {}
) {
  let base = String(text || "").trim();

  // Strip narrator-style openings (model loves starting with "Standing...", "Sitting...", etc.)
  base = base
    .replace(/^Standing\s+(in\s+front\s+of\s+\w+\s*,?\s*)?/i, "")
    .replace(/^Sitting\s+(on\s+\w+\s*,?\s*)?/i, "")
    .replace(/^Lying\s+(on\s+\w+\s*,?\s*)?/i, "")
    .replace(/^Showing\s+(off\s+)?/i, "")
    .replace(/^Posing\s+(in\s+)?/i, "")
    .replace(/^Wearing\s+/i, "Got on ")
    .replace(/^Fully\s+(nude|naked)\s*,?\s*/i, "Naked and ")
    .trim();

  // Strip clinical/narrator phrases that the model keeps inserting
  base = base
    .replace(/\bshowcasing\b/gi, "showing")
    .replace(/\bon full display\b/gi, "out")
    .replace(/\bconfidently\b/gi, "")
    .replace(/\baccentuat\w*\b/gi, "")
    .replace(/\bhighlighting\b/gi, "")
    .replace(/\bnothing more to see here,?\s*/gi, "")
    .replace(/\ball its glory\b/gi, "")
    .replace(/\bthe perfect curve of\b/gi, "")
    .replace(/\bmaking\s+\w+\s+stand out\s*(even more)?\b/gi, "")
    .replace(/\bintricate design of\b/gi, "")
    .replace(/\bthe background is\b/gi, "")
    .replace(/\bsilhouette\b/gi, "body")
    .replace(/\bcomplement\w*\b/gi, "")
    .replace(/\bstanding\s+confidently\b/gi, "")
    .replace(/\bmy\s+features\b/gi, "me")
    .replace(/\bwith\s+hands?\s+behind\s+(her|my)\s+head\b/gi, "")
    .replace(/\barms?\s+crossed\s+over\s+(her|my)\s+(chest|breasts?)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!base) {
    base = isTitle ? "My leaked nudes are out" : "This was supposed to stay private but here we are.";
  }

  return appendEmoji(base, emoji, maxLength);
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
  return enforceSexyTone(cleaned, {
    isTitle: true,
    emoji,
    maxLength: MAX_TITLE_LENGTH,
  });
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
  frameCount = DEFAULT_VIDEO_ANALYSIS_FRAME_COUNT
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
  frameCount = DEFAULT_VIDEO_ANALYSIS_FRAME_COUNT,
  maxSize = DEFAULT_AI_IMAGE_MAX_SIZE
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
        "-vf", `scale='min(${maxSize},iw)':'min(${maxSize},ih)':force_original_aspect_ratio=decrease`,
        "-q:v", "4",
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

async function recheckVipWithVision({ env, mediaType, base64Images, durationInfo }) {
  const prompt = `Strict VIP classifier. Look at this ${mediaType}${mediaType === "video" ? " across all supplied frames" : ""}.${durationInfo}

VIP=true ONLY if at least one is clearly visible:
- bare nipples / bare breasts with nipples exposed, no bra/top/bikini covering them
- bare pussy/vagina/vulva/labia/crotch exposed, no panties/thong/bikini/underwear covering it

For rear views, inspect between the legs carefully. If the bare vulva/crotch area is visible with no panties, nudePussy=true.
VIP=false for bra, bikini, lingerie, panties, thong, covered nipples, covered crotch, implied nudity, cleavage, sideboob, or bare ass alone.

JSON only:
{"contentSummary":"short clinical VIP evidence","nudeNipples":false,"nudePussy":false,"vip":false}`;

  const response = await fetch(`${env.OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.OLLAMA_MODEL,
      format: "json",
      stream: false,
      keep_alive: env.OLLAMA_KEEP_ALIVE,
      options: {
        temperature: 0.1,
        repeat_penalty: 1.1,
        num_predict: 180,
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

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`VIP recheck failed: ${response.status} ${errText}`);
  }

  const data = await response.json();
  return parseJsonFromText(data.message?.content);
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
      env.VIDEO_ANALYSIS_FRAME_COUNT,
      env.AI_IMAGE_MAX_SIZE
    );
    tempFiles.push(...framePaths);
  } else {
    const resized = createResizedImageForAi(filePath, env.AI_IMAGE_MAX_SIZE);
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
  const trendTermsList = (trendingTerms || []).slice(0, 20).join(", ");
  const titleStyleGuide = pickFromPool(`${filename}:title-style`, TITLE_STYLE_GUIDES);
  const durationInfo =
    mediaType === "video" && Number.isFinite(videoDurationSeconds)
      ? `\nVideo duration: ${Math.round(videoDurationSeconds)} seconds.`
      : "";

  const systemMessage = `Return compact JSON only. Write title/description as dirty first-person creator copy, not narrator photo description. Mention only visible things.`;

  const prompt = `Analyze this ${mediaType}${mediaType === "video" ? " across all frames" : ""}.${durationInfo}

contentSummary: max 35 words. Include clothing, visible body parts, pose/setting, and append exact markers:
NUDE_NIPPLES=YES/NO NUDE_PUSSY=YES/NO NUDE_ASS=YES/NO.
NUDE_NIPPLES=YES only for bare nipples/no bra. NUDE_PUSSY=YES only for bare vagina/vulva/labia/crotch/no panties; check rear views between legs. Bare ass alone is not VIP.

vip: true only if NUDE_NIPPLES=YES or NUDE_PUSSY=YES.
hashtags: 5-10 only from: ${allowedTagsList}
Visible tags only. Trends if relevant: ${trendTermsList}
title: max 60 chars, ${titleStyleGuide}, dirty talk, 1 emoji, no filename "${filename}".
description: max 170 chars, dirty/flirty, scene-specific, 1 emoji, don't repeat title.

JSON: {"contentSummary":"","vip":false,"hashtags":[],"title":"","description":"","trendTerms":[],"trendScore":0}`;

  let response;
  try {
    response = await fetch(`${env.OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: env.OLLAMA_MODEL,
        format: "json",
        stream: false,
        keep_alive: env.OLLAMA_KEEP_ALIVE,
        options: {
          temperature: 0.45,
          repeat_penalty: 1.08,
          num_predict: env.OLLAMA_NUM_PREDICT,
        },
        messages: [
          {
            role: "system",
            content: systemMessage,
          },
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
  const title = enforceSexyTone(cleanedTitle, {
    isTitle: true,
    emoji: titleEmoji,
    maxLength: MAX_TITLE_LENGTH,
  });

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

  // Content summary — must be parsed before validation uses it
  let contentSummary = String(parsed.contentSummary || "").trim();

  // Validate tags against content summary — remove action tags not supported by visual analysis
  hashtags = validateTagsFromContent(hashtags, contentSummary);

  // VIP is derived from visual evidence in contentSummary only.
  // Do not trust parsed.vip by itself: bra/panties must stay non-VIP.
  let vip = deriveVipFromItemEvidence({
    contentSummary,
    title,
    description,
    hashtags,
  });

  if (env.VIP_RECHECK && !vip && shouldRunVipRecheck(contentSummary, hashtags)) {
    try {
      const recheck = await recheckVipWithVision({
        env,
        mediaType,
        base64Images,
        durationInfo,
      });
      const recheckSummary = String(recheck.contentSummary || "").trim();
      const recheckEvidence = [
        recheckSummary,
        `NUDE_NIPPLES=${recheck.nudeNipples === true ? "YES" : "NO"}`,
        `NUDE_PUSSY=${recheck.nudePussy === true ? "YES" : "NO"}`,
      ].join(" ");

      if (deriveVipFromContent(recheckEvidence)) {
        vip = true;
        contentSummary = [contentSummary, `VIP recheck: ${recheckSummary}`]
          .filter(Boolean)
          .join(" ");
      }
    } catch (err) {
      console.warn(`⚠️  VIP recheck skipped for ${filename}: ${err.message}`);
    }
  }

  // Trend terms
  const trendTerms = Array.isArray(parsed.trendTerms)
    ? parsed.trendTerms.filter((t) => typeof t === "string" && t.trim()).slice(0, 5)
    : [];
  const trendScore = Math.max(0, Math.min(100, Math.round(Number(parsed.trendScore) || 0)));

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
      const existingTitle = String(existing.title || "").trim();
      const existingDescription = String(existing.description || "").trim();
      const existingHashtags = normalizeTags(existing.hashtags || []);
      const existingContentSummary = String(existing.contentSummary || "").trim();
      const evidenceVip = deriveVipFromItemEvidence({
        contentSummary: existingContentSummary,
        title: existingTitle,
        description: existingDescription,
        hashtags: existingHashtags,
      });

      return {
        filePath: fullPath,
        fileName: file,
        mediaType,
        title: existingTitle,
        description: existingDescription,
        hashtags: existingHashtags,
        trendTermsUsed: Array.isArray(existing.trendTermsUsed)
          ? existing.trendTermsUsed
          : [],
        trendScore: Number(existing.trendScore || 0),
        vip: Boolean(existing.vip) || evidenceVip,
        contentSummary: existingContentSummary,
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
      contentSummary: "",
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

  if (completed > 0) {
    console.log(
      `↩️  Resume: keeping ${completed}/${total} already analyzed item(s), ${total - completed} pending.`
    );
  } else {
    console.log("🆕 Resume: no completed items found, starting analysis from the first file.");
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
    const analysisStartedAt = Date.now();
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
        logInfo(`   ⏱️  Analysis time: ${formatDuration((Date.now() - analysisStartedAt) / 1000)}`);
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
        contentSummary: "",
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
      contentSummary: ai.contentSummary || "",
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
      current.contentSummary = result.contentSummary || "";
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

if (require.main === module) {
  main().catch((err) => {
    console.error("❌ Failed:", err.message);
    process.exit(1);
  });
}

module.exports = {
  deriveVipFromContent,
  deriveVipFromItemEvidence,
  enforceSexyTone,
  finalizeTitleCandidate,
  truncateText,
};
