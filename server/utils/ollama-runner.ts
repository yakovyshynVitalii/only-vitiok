import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { ROOT_DIR } from "./constants";

interface ManagedOllamaSession {
  child: ChildProcessWithoutNullStreams | null;
  startedByRunner: boolean;
  logs: string[];
}

interface StopResult {
  logs: string[];
}

function normalizeOllamaUrl(url: string): string {
  return String(url || "http://127.0.0.1:11434").replace(/\/+$/, "");
}

function isLocalOllamaUrl(ollamaUrl: string): boolean {
  try {
    const parsed = new URL(ollamaUrl);
    return ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  } catch {
    return true;
  }
}

async function isOllamaReachable(ollamaUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${normalizeOllamaUrl(ollamaUrl)}/api/tags`);
    return response.ok;
  } catch {
    return false;
  }
}

function appendLog(logs: string[], line: string) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return;
  logs.push(trimmed);
  if (logs.length > 120) {
    logs.splice(0, logs.length - 120);
  }
}

export async function startOllamaServe(
  ollamaUrl: string
): Promise<ManagedOllamaSession> {
  const logs: string[] = [];
  const url = normalizeOllamaUrl(ollamaUrl);

  if (await isOllamaReachable(url)) {
    appendLog(logs, `🟢 Ollama is already running: ${url}`);
    return {
      child: null,
      startedByRunner: false,
      logs,
    };
  }

  if (!isLocalOllamaUrl(url)) {
    throw new Error(
      `OLLAMA_URL (${url}) is unreachable and not local. Cannot auto-start 'ollama serve' for remote URLs.`
    );
  }

  appendLog(logs, "🚀 Starting ollama serve...");

  const child = spawn("ollama", ["serve"], {
    cwd: ROOT_DIR,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    for (const line of text.split(/\r?\n/)) {
      appendLog(logs, `[ollama] ${line}`);
    }
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    for (const line of text.split(/\r?\n/)) {
      appendLog(logs, `[ollama] ${line}`);
    }
  });

  child.on("error", (error) => {
    appendLog(logs, `❌ Failed to start ollama serve: ${error.message}`);
  });

  const startupTimeoutMs = 30_000;
  const pollIntervalMs = 400;
  const startedAt = Date.now();

  while (Date.now() - startedAt < startupTimeoutMs) {
    if (await isOllamaReachable(url)) {
      appendLog(logs, "✅ Ollama serve is ready.");
      return {
        child,
        startedByRunner: true,
        logs,
      };
    }

    if (child.exitCode !== null) {
      throw new Error(
        `ollama serve exited unexpectedly (code ${child.exitCode}).`
      );
    }

    await delay(pollIntervalMs);
  }

  if (child.exitCode === null) {
    child.kill("SIGTERM");
  }

  throw new Error("Timed out waiting for ollama serve startup (30s).");
}

export async function warmupOllamaModel(
  ollamaUrl: string,
  model: string
): Promise<string> {
  const url = normalizeOllamaUrl(ollamaUrl);
  const normalizedModel = String(model || "").trim();
  if (!normalizedModel) {
    throw new Error("OLLAMA_MODEL is empty");
  }

  const response = await fetch(`${url}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: normalizedModel,
      prompt: "ready",
      stream: false,
      keep_alive: "30m",
      options: { num_predict: 1, temperature: 0 },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to warm up model ${normalizedModel}: ${response.status} ${text}`
    );
  }

  return `✅ Model warmed up: ${normalizedModel}`;
}

async function runOllamaCommand(args: string[]): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const child = spawn("ollama", args, {
    cwd: ROOT_DIR,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  await Promise.race([
    once(child, "close"),
    once(child, "error").then(([error]) => {
      throw error;
    }),
  ]);

  return {
    code: child.exitCode ?? 0,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  };
}

export async function stopOllamaModel(model: string): Promise<StopResult> {
  const logs: string[] = [];
  const normalizedModel = String(model || "").trim();

  if (!normalizedModel) return { logs };

  const result = await runOllamaCommand(["stop", normalizedModel]);

  if (result.code === 0) {
    appendLog(logs, `🛑 Model stopped: ${normalizedModel}`);
  } else {
    appendLog(
      logs,
      `ℹ️ Failed to stop model ${normalizedModel} (possibly already inactive).`
    );
  }

  if (result.stdout) appendLog(logs, result.stdout);
  if (result.stderr) appendLog(logs, result.stderr);

  return { logs };
}

export async function stopOllamaServe(
  session: ManagedOllamaSession
): Promise<StopResult> {
  const logs: string[] = [];

  if (!session.startedByRunner || !session.child) {
    appendLog(logs, "ℹ️ Ollama serve was not started by this Analyze run.");
    return { logs };
  }

  if (session.child.exitCode !== null) {
    appendLog(logs, "ℹ️ Ollama serve is already stopped.");
    return { logs };
  }

  session.child.kill("SIGTERM");

  const closeResult = await Promise.race([
    once(session.child, "close").then(() => "closed"),
    delay(4_000).then(() => "timeout"),
  ]);

  if (closeResult === "timeout" && session.child.exitCode === null) {
    session.child.kill("SIGKILL");
    await once(session.child, "close");
  }

  appendLog(logs, "🛑 Ollama serve stopped.");
  return { logs };
}
