import fs from "node:fs";
import { ENV_PATH } from "./constants";

export function parseEnvText(raw: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = line.indexOf("=");
    if (index < 0) continue;

    const key = line.slice(0, index).trim();
    if (!key) continue;

    out[key] = line.slice(index + 1).trim();
  }

  return out;
}

export function serializeEnv(env: Record<string, string>): string {
  const lines = Object.entries(env).map(([key, value]) => `${key}=${value}`);
  return `${lines.join("\n")}\n`;
}

export function readEnvText(): string {
  if (!fs.existsSync(ENV_PATH)) return "";
  return fs.readFileSync(ENV_PATH, "utf8");
}

export function writeEnvText(raw: string): void {
  fs.writeFileSync(ENV_PATH, raw, "utf8");
}
