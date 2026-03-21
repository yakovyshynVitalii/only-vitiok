import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { makeTempDir, removeDir } from "../helpers/fs";

const mocks = vi.hoisted(() => ({
  readSettings: vi.fn(),
  ensureMediaFolder: vi.fn(),
  getConfigPath: vi.fn(),
}));

vi.mock("~/server/utils/settings", () => ({
  readSettings: mocks.readSettings,
  ensureMediaFolder: mocks.ensureMediaFolder,
  getConfigPath: mocks.getConfigPath,
}));

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) {
    removeDir(tempDirs.pop() as string);
  }
});

describe("DELETE /api/media/clear", () => {
  test("clears media folder and resets config", async () => {
    const tmp = makeTempDir();
    tempDirs.push(tmp);
    const mediaDir = path.join(tmp, "media");
    const configPath = path.join(tmp, "media-config.json");
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, "a.jpg"), "1");
    fs.writeFileSync(path.join(mediaDir, "b.mp4"), "2");
    fs.writeFileSync(configPath, JSON.stringify({ items: [{ x: 1 }] }), "utf8");

    mocks.readSettings.mockReturnValue({});
    mocks.ensureMediaFolder.mockReturnValue(mediaDir);
    mocks.getConfigPath.mockReturnValue(configPath);

    const handler = (await import("../../server/api/media/clear.delete")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = handler(event);

    expect(result.deleted).toBe(2);
    expect(result.files).toEqual([]);
    expect(result.count).toBe(0);
    expect(result.configCleared).toBe(true);

    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(cfg.items).toEqual([]);
    expect(cfg.hashtags).toEqual([]);
    expect(cfg.sourceFolder).toBe(mediaDir);
  });
});
