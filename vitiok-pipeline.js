const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

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

function runCommand(command, args, options = {}) {
  const { allowFailure = false } = options;
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
  });

  if (result.error && !allowFailure) {
    throw result.error;
  }

  if ((result.status || 0) !== 0 && !allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} exited with code ${result.status}`
    );
  }

  return result;
}

async function warmupModel(ollamaUrl, model) {
  console.log(`🚀 Запускаю модель для аналізу: ${model}`);

  const response = await fetch(`${ollamaUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: "ready",
      stream: false,
      keep_alive: "30m",
      options: { num_predict: 1, temperature: 0 },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Не вдалося запустити модель ${model}: ${response.status} ${text}`
    );
  }

  console.log(`✅ Модель активна: ${model}`);
}

function stopModel(model) {
  console.log(`🛑 Вимикаю модель після аналізу: ${model}`);
  const result = runCommand("ollama", ["stop", model], { allowFailure: true });

  if ((result.status || 0) !== 0) {
    console.log(
      `ℹ️ Модель ${model} вже не була активна або не знайдена для stop.`
    );
  } else {
    console.log(`✅ Модель вимкнена: ${model}`);
  }
}

async function main() {
  loadDotEnv();

  const ollamaUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
  const model = process.env.OLLAMA_MODEL || "llava:13b";

  await warmupModel(ollamaUrl, model);

  try {
    runCommand("npm", ["run", "generate-config"]);
  } finally {
    stopModel(model);
  }

  // Запускаємо наступні кроки тільки після зупинки моделі.
  runCommand("npm", ["run", "add-tags"]);
  runCommand("npm", ["run", "upload"]);
}

main().catch((err) => {
  console.error("❌ vitiok pipeline failed:", err.message);
  process.exit(1);
});
