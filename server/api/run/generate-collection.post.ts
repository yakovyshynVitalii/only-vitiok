import { createError, readBody } from "h3";
import { readSettings } from "~/server/utils/settings";

const COLLECTION_DESCRIPTION_LEAK_PHRASES = [
  "Just a teasing leak before I show you more.",
  "Call this your little leak before the real fun starts.",
  "These naughty leaks are only the beginning.",
];

const COLLECTION_SEO_PHRASES = [
  "exclusive tease",
  "after dark",
  "seductive drop",
  "uncensored vibe",
  "private fantasy",
];

function normalizeText(value: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function hashSeed(value: string) {
  const source = String(value || "default");
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) % 2147483647;
  }
  return Math.abs(hash);
}

function pickFromPool(seed: string, pool: string[]) {
  if (!Array.isArray(pool) || pool.length === 0) return "";
  return pool[hashSeed(seed) % pool.length] || "";
}

function appendSentenceIfFits(base: string, sentence: string, maxLength: number) {
  const normalizedBase = normalizeText(base);
  const normalizedSentence = normalizeText(sentence);

  if (!normalizedSentence) return normalizedBase;
  if (!normalizedBase) return normalizedSentence.slice(0, maxLength).trim();

  const separator = /[.!?…]$/.test(normalizedBase) ? " " : ". ";
  const candidate = `${normalizedBase}${separator}${normalizedSentence}`;
  return candidate.length <= maxLength ? candidate : normalizedBase;
}

function escapeRegExp(value: string) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractModelKeywords(modelName: string): string[] {
  const parts = String(modelName || "")
    .split(/[|,/]/)
    .map((part) => normalizeText(part))
    .filter(Boolean);

  return [...new Set(parts.length ? parts : [normalizeText(modelName)])].filter(Boolean);
}

function ensurePrimaryKeywordInTitle(
  title: string,
  primaryKeyword: string,
  maxLength = 80
) {
  const normalizedTitle = normalizeText(title);
  const normalizedKeyword = normalizeText(primaryKeyword);

  if (!normalizedKeyword) return normalizedTitle;
  if (new RegExp(`\\b${escapeRegExp(normalizedKeyword)}\\b`, "i").test(normalizedTitle)) {
    return normalizedTitle;
  }

  const prefixed = `🔥 ${normalizedKeyword} — ${normalizedTitle}`.trim();
  if (prefixed.length <= maxLength) return prefixed;

  const compact = `${normalizedKeyword} — ${normalizedTitle}`.trim();
  if (compact.length <= maxLength) return compact;

  return normalizedKeyword.slice(0, maxLength).trim();
}

function ensureModelNameInDescription(
  description: string,
  keywords: string[],
  maxLength = 200
) {
  const base = normalizeText(description);
  const normalizedKeywords = keywords.map((keyword) => normalizeText(keyword)).filter(Boolean);
  const primaryKeyword = normalizedKeywords[0] || "";

  if (!primaryKeyword) return base;

  const primaryPattern = new RegExp(`\\b${escapeRegExp(primaryKeyword)}\\b`, "i");
  if (primaryPattern.test(base)) return base;

  if (!base) {
    return `I'm ${primaryKeyword}, and I know exactly how to keep you craving more.`;
  }

  const withFullSentence = appendSentenceIfFits(
    base,
    `I'm ${primaryKeyword}, and I'm just getting started.`,
    maxLength
  );
  if (withFullSentence !== base) return withFullSentence;

  return appendSentenceIfFits(base, `I'm ${primaryKeyword}.`, maxLength);
}

function maybeAddSeoPhrase(
  description: string,
  seed: string,
  maxLength = 200
) {
  const base = normalizeText(description);
  if (!base) return base;

  const phrase = pickFromPool(`${seed}:collection-seo`, COLLECTION_SEO_PHRASES);
  if (!phrase) return base;
  if (new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "i").test(base)) return base;

  return appendSentenceIfFits(base, `This is your ${phrase}.`, maxLength);
}

function maybeAddSecondaryKeyword(
  description: string,
  keywords: string[],
  maxLength = 200
) {
  const base = normalizeText(description);
  const secondaryKeyword = normalizeText(keywords[1] || "");
  if (!base || !secondaryKeyword) return base;

  const secondaryPattern = new RegExp(`\\b${escapeRegExp(secondaryKeyword)}\\b`, "i");
  if (secondaryPattern.test(base)) return base;

  return appendSentenceIfFits(base, `You know me as ${secondaryKeyword} too.`, maxLength);
}

function maybeAddLeakWording(
  description: string,
  seed: string,
  maxLength = 200,
  chanceDivisor = 6
) {
  const base = normalizeText(description);
  if (!base) return base;
  if (/\bleaks?\b/i.test(base)) return base;
  if (hashSeed(`${seed}:collection-leak`) % chanceDivisor !== 0) return base;

  const leakPhrase = pickFromPool(
    `${seed}:collection-leak-phrase`,
    COLLECTION_DESCRIPTION_LEAK_PHRASES
  );
  if (!leakPhrase) return base;

  return appendSentenceIfFits(base, leakPhrase, maxLength);
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ modelName: string }>(event);
  const modelName = String(body?.modelName || "").trim();

  if (!modelName) {
    throw createError({ statusCode: 400, statusMessage: "Model name is required" });
  }

  const settings = readSettings();
  const ollamaUrl = (settings.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
  const ollamaModel = settings.env.OLLAMA_MODEL || "qwen2.5vl:7b";

  const modelKeywords = extractModelKeywords(modelName);
  const primaryKeyword = modelKeywords[0] || modelName;
  const keywordList = modelKeywords.join(", ");

  const prompt = `You are writing a profile for an adult content creator on OnlyFans/Fansly.
The model's name/nickname is: "${modelName}"
Primary SEO keyword: "${primaryKeyword}"
Supporting SEO keywords: "${keywordList}"

Generate a COLLECTION TITLE and DESCRIPTION written in first person from the girl's perspective.
The tone should be bold, provocative, seductive, teasing, and click-enticing like she's talking to her fans.
Keep it spicy and high-converting, but avoid graphic sexual descriptions or explicit anatomy.

TITLE: Short (max 80 chars), catchy, with 1-2 emojis. Include the primary SEO nickname naturally.
Make it feel high-intent for search: seductive, addictive, after-dark, exclusive.
Example: "🔥 Selti | Seltin_sweety — Your Sweet Temptation"
Example: "💋 Luna_xxx — Come Get Naughty With Me"

DESCRIPTION: 2-3 sentences (max 200 chars), first person, teasing, inviting viewers to subscribe/follow. Use 1-2 emojis.
Include the primary nickname naturally at least once in the description, and if possible weave in one supporting nickname naturally for SEO without keyword stuffing.
You may occasionally use the word "leak" or "leaks" once if it sounds natural, but do not force it into every output.
Aim for language like: teasing, obsessed, crave more, after dark, exclusive, private, forbidden, addictive.
Example: "Hey babe, I'm your naughty little secret 😈 Follow me for exclusive content you won't find anywhere else... I promise to make it worth your while 💦"

Return ONLY valid JSON, no markdown:
{"title":"...","description":"..."}`;

  let response;
  try {
    response = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel,
        format: "json",
        stream: false,
        options: { temperature: 0.7, num_predict: 256 },
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw createError({
      statusCode: 502,
      statusMessage: `Cannot connect to Ollama (${ollamaUrl}). Start 'ollama serve'. ${msg}`,
    });
  }

  if (!response.ok) {
    const errText = await response.text();
    throw createError({
      statusCode: 502,
      statusMessage: `Ollama error: ${response.status} ${errText}`,
    });
  }

  const data = await response.json();
  const rawContent = data.message?.content || "{}";

  let parsed: { title?: string; description?: string };
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    // Try extracting JSON from text
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        parsed = {};
      }
    } else {
      parsed = {};
    }
  }

  const title = ensurePrimaryKeywordInTitle(
    String(parsed.title || "").trim(),
    primaryKeyword
  );
  const description = maybeAddSeoPhrase(
    maybeAddLeakWording(
      maybeAddSecondaryKeyword(
        ensureModelNameInDescription(
          String(parsed.description || "").trim(),
          modelKeywords
        ),
        modelKeywords
      ),
      primaryKeyword
    ),
    primaryKeyword
  );

  if (!title) {
    throw createError({
      statusCode: 500,
      statusMessage: "Model returned empty title. Try again.",
    });
  }

  return {
    ok: true,
    title,
    description,
    modelName,
  };
});
