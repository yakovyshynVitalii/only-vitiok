import { readSettings } from "~/server/utils/settings";
import { runScriptTask } from "~/server/utils/process-runner";
import {
  startOllamaServe,
  stopOllamaModel,
  stopOllamaServe,
  warmupOllamaModel,
} from "~/server/utils/ollama-runner";

function parseBool(value: string, fallback = false): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export default defineEventHandler(async () => {
  const settings = readSettings();
  const autoUpload = parseBool(settings.env.AUTO_UPLOAD_AFTER_ANALYZE, false);
  const ollamaUrl = settings.env.OLLAMA_URL || "http://127.0.0.1:11434";
  const ollamaModel = settings.env.OLLAMA_MODEL || "qwen2.5vl:3b-q4_K_M";
  const runtimeLogs: string[] = [];

  const session = await startOllamaServe(ollamaUrl);
  runtimeLogs.push(...session.logs);
  runtimeLogs.push(await warmupOllamaModel(ollamaUrl, ollamaModel));

  let analyzeResult: { output: string };

  let addTagsResult: { output: string } | null = null;
  let uploadResult: { output: string } | null = null;
  try {
    analyzeResult = await runScriptTask("analyze", "scripts/generate-config.js");

    if (autoUpload) {
      addTagsResult = await runScriptTask("add-tags", "scripts/add-tags.js");
      uploadResult = await runScriptTask("upload", "scripts/upload.js");
    }
  } finally {
    const stopModel = await stopOllamaModel(ollamaModel);
    runtimeLogs.push(...stopModel.logs);

    const stopServe = await stopOllamaServe(session);
    runtimeLogs.push(...stopServe.logs);
  }

  return {
    ok: true,
    autoUpload,
    analyzeOutput: [runtimeLogs.join("\n"), analyzeResult.output]
      .filter(Boolean)
      .join("\n\n"),
    addTagsOutput: addTagsResult?.output ?? "",
    uploadOutput: uploadResult?.output ?? "",
  };
});
