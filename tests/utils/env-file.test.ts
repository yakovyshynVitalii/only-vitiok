import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { makeTempDir, removeDir } from "../helpers/fs";

const originalCwd = process.cwd();
const tempDirs: string[] = [];

afterEach(() => {
  process.chdir(originalCwd);
  vi.resetModules();

  while (tempDirs.length) {
    removeDir(tempDirs.pop() as string);
  }
});

async function loadModuleInTempDir() {
  const tempDir = makeTempDir();
  tempDirs.push(tempDir);
  process.chdir(tempDir);

  return import("~/server/utils/env-file");
}

describe("env-file utils", () => {
  test("parseEnvText parses keys and ignores comments", async () => {
    const mod = await loadModuleInTempDir();
    const parsed = mod.parseEnvText(`
# comment
BASE_URL=https://example.com
EMPTY=
 KEY = value with spaces
INVALID_LINE
`);

    expect(parsed).toEqual({
      BASE_URL: "https://example.com",
      EMPTY: "",
      KEY: "value with spaces",
    });
  });

  test("serializeEnv generates newline-terminated content", async () => {
    const mod = await loadModuleInTempDir();
    const content = mod.serializeEnv({
      A: "1",
      B: "two",
    });

    expect(content).toBe("A=1\nB=two\n");
  });

  test("readEnvText and writeEnvText work with .env file", async () => {
    const mod = await loadModuleInTempDir();
    const envPath = path.resolve(process.cwd(), ".env");

    expect(mod.readEnvText()).toBe("");

    mod.writeEnvText("A=1\n");
    expect(fs.readFileSync(envPath, "utf8")).toBe("A=1\n");
    expect(mod.readEnvText()).toBe("A=1\n");
  });
});
