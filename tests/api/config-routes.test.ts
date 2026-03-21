import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { makeTempDir, removeDir } from "../helpers/fs";

const mocks = vi.hoisted(() => ({
  readBody: vi.fn(),
  readSettings: vi.fn(),
  getConfigPath: vi.fn(),
}));

vi.mock("h3", async () => {
  const actual = await vi.importActual<typeof import("h3")>("h3");
  return {
    ...actual,
    readBody: mocks.readBody,
  };
});

vi.mock("~/server/utils/settings", () => ({
  readSettings: mocks.readSettings,
  getConfigPath: mocks.getConfigPath,
}));

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) {
    removeDir(tempDirs.pop() as string);
  }
});

describe("config routes", () => {
  test("GET /api/config returns exists=false when file missing", async () => {
    const tmp = makeTempDir();
    tempDirs.push(tmp);
    const configPath = path.join(tmp, "media-config.json");

    mocks.readSettings.mockReturnValue({});
    mocks.getConfigPath.mockReturnValue(configPath);

    const handler = (await import("../../server/api/config.get")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = handler(event);

    expect(result).toEqual({
      exists: false,
      configPath,
      text: "",
      parsed: null,
    });
  });

  test("GET /api/config returns parsed=null for invalid JSON", async () => {
    const tmp = makeTempDir();
    tempDirs.push(tmp);
    const configPath = path.join(tmp, "media-config.json");
    fs.writeFileSync(configPath, "{invalid", "utf8");

    mocks.readSettings.mockReturnValue({});
    mocks.getConfigPath.mockReturnValue(configPath);

    const handler = (await import("../../server/api/config.get")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = handler(event);

    expect(result.exists).toBe(true);
    expect(result.parsed).toBeNull();
    expect(result.text).toBe("{invalid");
  });

  test("PUT /api/config validates text and JSON format", async () => {
    const handler = (await import("../../server/api/config.put")).default;
    const event = {} as Parameters<typeof handler>[0];

    mocks.readBody.mockResolvedValue({ text: "" });
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 400 });

    mocks.readBody.mockResolvedValue({ text: "{bad" });
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 400 });
  });

  test("PUT /api/config saves JSON and returns item count", async () => {
    const tmp = makeTempDir();
    tempDirs.push(tmp);
    const configPath = path.join(tmp, "media-config.json");
    const payload = {
      items: [{ id: 1 }, { id: 2 }],
      hashtags: ["a"],
    };

    mocks.readBody.mockResolvedValue({ text: JSON.stringify(payload) });
    mocks.readSettings.mockReturnValue({});
    mocks.getConfigPath.mockReturnValue(configPath);

    const handler = (await import("../../server/api/config.put")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = await handler(event);

    expect(result).toEqual({
      saved: true,
      configPath,
      itemCount: 2,
    });

    const saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
    expect(saved).toEqual(payload);
  });
});
