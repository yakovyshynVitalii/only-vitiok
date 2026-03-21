import { readSettings } from "~/server/utils/settings";

export default defineEventHandler(async (event) => {
  const body = await readBody<{ modelName: string }>(event);
  const modelName = String(body?.modelName || "").trim();

  if (!modelName) {
    throw createError({ statusCode: 400, statusMessage: "Model name is required" });
  }

  const settings = readSettings();
  const ollamaUrl = (settings.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
  const ollamaModel = settings.env.OLLAMA_MODEL || "qwen2.5vl:7b";

  const prompt = `You are writing a profile for an adult content creator on OnlyFans/Fansly.
The model's name/nickname is: "${modelName}"

Generate a COLLECTION TITLE and DESCRIPTION written in first person from the girl's perspective.
The tone should be flirty, teasing, inviting — like she's talking to her fans.

TITLE: Short (max 80 chars), catchy, with 1-2 emojis. Include the model name naturally.
Example: "🔥 Selti | Seltin_sweety — Your Sweet Temptation"
Example: "💋 Luna_xxx — Come Get Naughty With Me"

DESCRIPTION: 2-3 sentences (max 300 chars), first person, teasing, inviting viewers to subscribe/follow. Use 1-2 emojis.
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

  const title = String(parsed.title || "").trim();
  const description = String(parsed.description || "").trim();

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
