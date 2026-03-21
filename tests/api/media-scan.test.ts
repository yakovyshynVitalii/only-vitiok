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

describe("POST /api/media/scan", () => {
  test("synchronizes cards from files in media folder", async () => {
    const tmp = makeTempDir();
    tempDirs.push(tmp);
    const mediaDir = path.join(tmp, "media");
    const configPath = path.join(tmp, "media-config.json");
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, "a.mp4"), "video");
    fs.writeFileSync(path.join(mediaDir, "z.jpg"), "image");
    fs.writeFileSync(path.join(mediaDir, "ignore.txt"), "text");

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        hashtags: ["old"],
        items: [
          {
            fileName: "a.mp4",
            filePath: "/x/a.mp4",
            title: "Existing title",
            description: "Existing description",
            hashtags: ["tag-a"],
            vip: true,
            uploaded: true,
          },
          {
            fileName: "removed.mov",
            filePath: "/x/removed.mov",
            title: "Removed",
          },
        ],
      }),
      "utf8"
    );

    mocks.readSettings.mockReturnValue({});
    mocks.ensureMediaFolder.mockReturnValue(mediaDir);
    mocks.getConfigPath.mockReturnValue(configPath);

    const handler = (await import("../../server/api/media/scan.post")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = handler(event);

    expect(result.files).toEqual(["a.mp4", "z.jpg"]);
    expect(result.count).toBe(2);
    expect(result.itemCount).toBe(2);

    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(cfg.sourceFolder).toBe(mediaDir);
    expect(cfg.items).toHaveLength(2);
    expect(cfg.items[0]).toMatchObject({
      fileName: "a.mp4",
      title: "Existing title",
      hashtags: ["tag-a"],
      vip: true,
      uploaded: true,
    });
    expect(cfg.items[1]).toMatchObject({
      fileName: "z.jpg",
      title: "",
      description: "",
      hashtags: [],
      vip: false,
      uploaded: false,
    });
  });
});
