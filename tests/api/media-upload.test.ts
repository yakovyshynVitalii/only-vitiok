import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { makeTempDir, removeDir } from "../helpers/fs";

const mocks = vi.hoisted(() => ({
  readMultipartFormData: vi.fn(),
  readSettings: vi.fn(),
  ensureMediaFolder: vi.fn(),
  getConfigPath: vi.fn(),
}));

vi.mock("h3", async () => {
  const actual = await vi.importActual<typeof import("h3")>("h3");
  return {
    ...actual,
    readMultipartFormData: mocks.readMultipartFormData,
  };
});

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

describe("POST /api/media/upload", () => {
  test("throws when multipart payload is empty", async () => {
    mocks.readMultipartFormData.mockResolvedValue([]);
    const handler = (await import("~/server/api/media/upload.post")).default;
    const event = {} as Parameters<typeof handler>[0];

    await expect(handler(event)).rejects.toMatchObject({
      cause: {
        statusCode: 400,
        statusMessage: "Files were not provided",
      },
    });
  });

  test("uploads files and synchronizes config items", async () => {
    const tmp = makeTempDir();
    tempDirs.push(tmp);
    const mediaDir = path.join(tmp, "media");
    const configPath = path.join(tmp, "media-config.json");
    fs.mkdirSync(mediaDir, { recursive: true });

    fs.writeFileSync(
      configPath,
      JSON.stringify({
        hashtags: ["old"],
        items: [
          {
            fileName: "existing.mp4",
            filePath: "/x/existing.mp4",
            title: "Existing title",
            description: "Existing desc",
            hashtags: ["x"],
            vip: true,
          },
        ],
      }),
      "utf8"
    );
    fs.writeFileSync(path.join(mediaDir, "existing.mp4"), "old");

    mocks.readSettings.mockReturnValue({});
    mocks.ensureMediaFolder.mockReturnValue(mediaDir);
    mocks.getConfigPath.mockReturnValue(configPath);
    mocks.readMultipartFormData.mockResolvedValue([
      {
        filename: "new file.jpg",
        data: Buffer.from("image-bytes"),
      },
    ]);

    const handler = (await import("~/server/api/media/upload.post")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = await handler(event);

    expect(result.count).toBe(2);
    expect(result.files).toEqual(["existing.mp4", "new_file.jpg"]);
    expect(result.saved[0].name).toBe("new_file.jpg");

    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(cfg.items).toHaveLength(2);
    expect(cfg.items[0]).toMatchObject({
      fileName: "existing.mp4",
      title: "Existing title",
      vip: true,
    });
    expect(cfg.items[1]).toMatchObject({
      fileName: "new_file.jpg",
      title: "",
      description: "",
      hashtags: [],
      vip: false,
      uploaded: false,
    });
  });
});
