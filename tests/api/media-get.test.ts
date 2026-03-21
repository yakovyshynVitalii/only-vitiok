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

afterEach(() => {
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
});
