import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, test, vi } from "vitest";
import { makeTempDir, removeDir } from "../helpers/fs";

const mocks = vi.hoisted(() => ({
  getQuery: vi.fn(),
  setHeader: vi.fn(),
  sendStream: vi.fn((_event, stream) => stream),
  readSettings: vi.fn(),
  ensureMediaFolder: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock("h3", async () => {
  const actual = await vi.importActual<typeof import("h3")>("h3");
  return {
    ...actual,
    getQuery: mocks.getQuery,
    setHeader: mocks.setHeader,
    sendStream: mocks.sendStream,
  };
});

vi.mock("~/server/utils/settings", () => ({
  readSettings: mocks.readSettings,
  ensureMediaFolder: mocks.ensureMediaFolder,
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process"
  );
  return {
    ...actual,
    spawnSync: mocks.spawnSync,
  };
});

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  const createReadStream = vi.fn(() => Readable.from(["poster-stream"]));

  return {
    ...actual,
    default: {
      ...actual,
      createReadStream,
    },
    createReadStream,
  };
});

const tempDirs: string[] = [];
const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
  while (tempDirs.length) {
    removeDir(tempDirs.pop() as string);
  }
});

describe("GET /api/media/poster", () => {
  test("rejects non-video files", async () => {
    mocks.getQuery.mockReturnValue({ file: "a.jpg" });
    const handler = (await import("../../server/api/media/poster.get")).default;
    const event = {} as Parameters<typeof handler>[0];

    expect(() => handler(event)).toThrowError(/only for video files/);
  });

  test("returns 503 when ffmpeg is unavailable", async () => {
    const tmp = makeTempDir();
    tempDirs.push(tmp);
    process.chdir(tmp);
    const mediaDir = path.join(tmp, "media");
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, "a.mp4"), "video");

    mocks.getQuery.mockReturnValue({ file: "a.mp4" });
    mocks.readSettings.mockReturnValue({});
    mocks.ensureMediaFolder.mockReturnValue(mediaDir);
    mocks.spawnSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === "-version") return { status: 1 };
      return { status: 1 };
    });

    const handler = (await import("../../server/api/media/poster.get")).default;
    const event = {} as Parameters<typeof handler>[0];
    expect(() => handler(event)).toThrowError(/ffmpeg is not installed/);
  });

  test("creates poster and streams jpeg", async () => {
    const tmp = makeTempDir();
    tempDirs.push(tmp);
    process.chdir(tmp);
    const mediaDir = path.join(tmp, "media");
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, "a.mp4"), "video");

    mocks.getQuery.mockReturnValue({ file: "a.mp4" });
    mocks.readSettings.mockReturnValue({});
    mocks.ensureMediaFolder.mockReturnValue(mediaDir);
    mocks.sendStream.mockImplementation((_event, stream) => stream);
    mocks.spawnSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === "-version") return { status: 0 };

      const outPath = args[args.length - 1];
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, "poster", "utf8");
      return { status: 0 };
    });

    const handler = (await import("../../server/api/media/poster.get")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = handler(event);

    expect(mocks.setHeader).toHaveBeenCalledWith({}, "Content-Type", "image/jpeg");
    expect(mocks.sendStream).toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
