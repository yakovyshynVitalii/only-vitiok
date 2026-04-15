import { createError, readBody } from "h3";
import { readSettings } from "~/server/utils/settings";

export default defineEventHandler(async (event) => {
  const body = await readBody<{ prompt: string }>(event);
  const userPrompt = String(body?.prompt || "").trim();

  if (!userPrompt) {
    throw createError({ statusCode: 400, statusMessage: "Prompt is required" });
  }

  const settings = readSettings();
  const ollamaUrl = (settings.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
  const ollamaModel = settings.env.OLLAMA_MODEL || "qwen2.5vl:7b";

  const systemPrompt = `You write titles and descriptions for leaked adult content collections on OnlyFans/Fansly.
The user gives you a COLLECTION NAME (a folder with photos or videos of a specific girl).
Your job: rewrite it into a sexualized, provocative, clickbait title and description.

CRITICAL RULES:
- You MUST use the EXACT names, nicknames, and keywords from the user's prompt. Do NOT invent new characters, scenarios, or people.
- If the prompt says "Persian Baby" — the title and description MUST be about "Persian Baby". Do NOT add stepmoms, neighbors, or anything not in the prompt.
- This is a CONTENT COLLECTION (photos/videos), NOT a porn scene script. Do not describe sex acts between multiple people unless the prompt explicitly mentions them.
- Write from the girl's perspective (first person). She is teasing her fans about her leaked/exclusive content.

FORMAT:
- TITLE (max 80 chars): Sexy, clickbait, 1-2 emojis. Must contain the main name/keyword from the prompt. Provocative but relevant.
- DESCRIPTION (max 200 chars): 1-2 sentences, first person, slutty and teasing. She talks about HER content — her body, her photos, her leaks. 1-2 emojis.

GOOD WORDS TO USE: leaked, exposed, uncensored, private, naughty, dirty, explicit, forbidden, slutty, naked, nude, topless, wet, wild, unfiltered, raw, exclusive, XXX.

EXAMPLES:
Input: "Persian Baby photo leaks Part 1"
Output: {"title":"🔥 Persian Baby — Leaked Nudes You Weren't Supposed to See","description":"My private photos got leaked and I don't even care 😈 See all of me, uncensored and unfiltered. You're not ready for this 💦"}

Input: "Selti hot selfies collection"  
Output: {"title":"💋 Selti — Slutty Selfies That'll Make You Lose It","description":"These dirty selfies were for my eyes only... but now they're yours 😈 Every inch of me, exposed and raw 🔥"}

Return ONLY valid JSON, no markdown, no explanation:
{"title":"...","description":"..."}`;

  const prompt = `Rewrite this collection name into a sexy provocative title and description. KEEP THE ORIGINAL NAMES AND KEYWORDS — do not invent new ones:\n\n"${userPrompt}"`;

  let response;
  try {
    response = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaModel,
        format: "json",
        stream: false,
        options: { temperature: 0.8, num_predict: 300 },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
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

  const title = String(parsed.title || "").trim().slice(0, 80);
  const description = String(parsed.description || "").trim().slice(0, 200);

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
    prompt: userPrompt,
  };
});
