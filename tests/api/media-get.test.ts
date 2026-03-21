import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { makeTempDir, removeDir } from "../helpers/fs";

const mocks = vi.hoisted(() => ({
  readSettings: vi.fn(),
  ensureMediaFolder: vi.fn(),
}));

vi.mock("~/server/utils/settings", () => ({
  readSettings: mocks.readSettings,
  ensureMediaFolder: mocks.ensureMediaFolder,
}));

const tempDirs: string[] = [];
const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
  vi.resetModules();

  while (tempDirs.length) {
    removeDir(tempDirs.pop() as string);
  }
});

describe("GET /api/media", () => {
  test("returns sorted file list and counters", async () => {
    const tmp = makeTempDir();
    const mediaDir = path.join(tmp, "media");
    tempDirs.push(tmp);
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, "b.mp4"), "");
    fs.writeFileSync(path.join(mediaDir, "a.jpg"), "");
    fs.mkdirSync(path.join(mediaDir, "nested"), { recursive: true });

    mocks.readSettings.mockReturnValue({});
    mocks.ensureMediaFolder.mockReturnValue(mediaDir);

    const handler = (await import("../../server/api/media.get")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = handler(event);

    expect(result.mediaFolder).toBe(mediaDir);
    expect(result.files).toEqual(["a.jpg", "b.mp4"]);
    expect(result.count).toBe(2);
    expect(result.relativeMediaFolder).toBe(path.relative(process.cwd(), mediaDir));
  });

  test("imports media files from project root into MEDIA_FOLDER when enabled", async () => {
    const tmp = makeTempDir();
    tempDirs.push(tmp);
    process.chdir(tmp);

    const mediaDir = path.join(tmp, "media");
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(tmp, "in-root.mp4"), "video");
    fs.writeFileSync(path.join(tmp, "ignore.txt"), "text");

    mocks.readSettings.mockReturnValue({
      env: {
        MEDIA_IMPORT_PROJECT_ROOT: "true",
      },
    });
    mocks.ensureMediaFolder.mockReturnValue(mediaDir);

    const handler = (await import("../../server/api/media.get")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = handler(event);

    expect(result.files).toEqual(["in-root.mp4"]);
    expect(fs.existsSync(path.join(mediaDir, "in-root.mp4"))).toBe(true);
  });
});
