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

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  const createReadStream = vi.fn(() => Readable.from(["stream-data"]));

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

afterEach(() => {
  while (tempDirs.length) {
    removeDir(tempDirs.pop() as string);
  }
});

describe("GET /api/media/asset", () => {
  test("validates query file param", async () => {
    mocks.getQuery.mockReturnValue({});
    const handler = (await import("../../server/api/media/asset.get")).default;
    const event = {} as Parameters<typeof handler>[0];

    expect(() => handler(event)).toThrowError(/Pass file in query/);
  });

  test("returns 404 for absent file", async () => {
    const tmp = makeTempDir();
    tempDirs.push(tmp);
    const mediaDir = path.join(tmp, "media");
    fs.mkdirSync(mediaDir, { recursive: true });

    mocks.getQuery.mockReturnValue({ file: "x.jpg" });
    mocks.readSettings.mockReturnValue({});
    mocks.ensureMediaFolder.mockReturnValue(mediaDir);

    const handler = (await import("../../server/api/media/asset.get")).default;
    const event = {} as Parameters<typeof handler>[0];
    expect(() => handler(event)).toThrowError(/File not found/);
  });

  test("streams existing file and sets content-type", async () => {
    const tmp = makeTempDir();
    tempDirs.push(tmp);
    const mediaDir = path.join(tmp, "media");
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(path.join(mediaDir, "x.jpg"), "bytes", "utf8");

    mocks.getQuery.mockReturnValue({ file: "x.jpg" });
    mocks.readSettings.mockReturnValue({});
    mocks.ensureMediaFolder.mockReturnValue(mediaDir);
    mocks.sendStream.mockImplementation((_event, stream) => stream);

    const handler = (await import("../../server/api/media/asset.get")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = handler(event);

    expect(mocks.setHeader).toHaveBeenCalledWith(
      {},
      "Content-Type",
      "image/jpeg"
    );
    expect(mocks.sendStream).toHaveBeenCalled();
    expect(result).toBeDefined();
  });
});
