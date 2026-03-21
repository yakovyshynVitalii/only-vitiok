import fs from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { makeTempDir, removeDir } from "../helpers/fs";

const originalCwd = process.cwd();

function writeScript(dirPath: string, fileName: string, body: string): string {
  const filePath = path.join(dirPath, fileName);
  fs.writeFileSync(filePath, body, "utf8");
  return filePath;
}

describe("process-runner", () => {
  test("runScriptTask returns merged output on success", async () => {
    const tmp = makeTempDir();
    try {
      const scriptPath = writeScript(
        tmp,
        "ok.js",
        "console.log('hello'); console.error('warn');"
      );
      const { runScriptTask } = await import("~/server/utils/process-runner");

      const result = await runScriptTask("analyze", scriptPath);
      expect(result.output).toContain("hello");
      expect(result.output).toContain("warn");
    } finally {
      removeDir(tmp);
    }
  });

  test("runScriptTask throws h3 error for non-zero exit", async () => {
    const tmp = makeTempDir();
    try {
      const scriptPath = writeScript(
        tmp,
        "fail.js",
        "console.error('boom'); process.exit(1);"
      );
      const { runScriptTask } = await import("~/server/utils/process-runner");

      await expect(runScriptTask("analyze", scriptPath)).rejects.toMatchObject({
        statusCode: 500,
      });
    } finally {
      removeDir(tmp);
    }
  });

  test("runScriptTask blocks concurrent task execution and resets state", async () => {
    const tmp = makeTempDir();
    try {
      const slowScript = writeScript(
        tmp,
        "slow.js",
        "setTimeout(() => { console.log('done'); }, 250);"
      );
      const { getTaskStatus, runScriptTask } = await import(
        "~/server/utils/process-runner"
      );

      const firstTask = runScriptTask("analyze", slowScript);
      await new Promise((resolve) => setTimeout(resolve, 25));

      await expect(runScriptTask("upload", slowScript)).rejects.toMatchObject({
        statusCode: 409,
      });

      await firstTask;
      expect(getTaskStatus()).toEqual({
        runningTask: null,
        isBusy: false,
        stopRequested: false,
      });
    } finally {
      removeDir(tmp);
    }
  });

  test("runScriptTask uses latest CREATE_URL from .env over stale process env", async () => {
    const tmp = makeTempDir();
    const previousCreateUrl = process.env.CREATE_URL;

    try {
      process.chdir(tmp);
      fs.writeFileSync(
        path.join(tmp, ".env"),
        "CREATE_URL=https://collections.only-nice.com/collection/fresh\n",
        "utf8"
      );
      writeScript(tmp, "print-env.js", "console.log(process.env.CREATE_URL || '')");

      process.env.CREATE_URL = "https://collections.only-nice.com/collection/stale";
      vi.resetModules();
      const { runScriptTask } = await import("~/server/utils/process-runner");

      const result = await runScriptTask("add-tags", "print-env.js");
      expect(result.output).toContain(
        "https://collections.only-nice.com/collection/fresh"
      );
    } finally {
      if (previousCreateUrl == null) {
        delete process.env.CREATE_URL;
      } else {
        process.env.CREATE_URL = previousCreateUrl;
      }
      process.chdir(originalCwd);
      vi.resetModules();
      removeDir(tmp);
    }
  });
});
