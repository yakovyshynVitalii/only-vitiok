import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function makeTempDir(prefix = "only-vitiok-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function removeDir(dirPath: string): void {
  fs.rmSync(dirPath, { recursive: true, force: true });
}
