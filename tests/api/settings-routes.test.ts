import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readBody: vi.fn(),
  readSettings: vi.fn(),
  writeSettings: vi.fn(),
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
  writeSettings: mocks.writeSettings,
}));

describe("settings routes", () => {
  test("GET /api/settings returns readSettings result", async () => {
    mocks.readSettings.mockReturnValue({ env: { BASE_URL: "x" } });
    const handler = (await import("../../server/api/settings.get")).default;
    const event = {} as Parameters<typeof handler>[0];

    const result = handler(event);
    expect(result).toEqual({ env: { BASE_URL: "x" } });
  });

  test("PUT /api/settings validates env object", async () => {
    mocks.readBody.mockResolvedValue({ env: "bad" });
    const handler = (await import("../../server/api/settings.put")).default;
    const event = {} as Parameters<typeof handler>[0];

    await expect(handler(event)).rejects.toMatchObject({
      cause: {
        statusCode: 400,
        statusMessage: "env must be an object with key=value pairs",
      },
    });
  });

  test("PUT /api/settings validates uploadCollections array", async () => {
    mocks.readBody.mockResolvedValue({ uploadCollections: "bad" });
    const handler = (await import("../../server/api/settings.put")).default;
    const event = {} as Parameters<typeof handler>[0];

    await expect(handler(event)).rejects.toMatchObject({
      cause: {
        statusCode: 400,
        statusMessage: "uploadCollections must be an array",
      },
    });
  });

  test("PUT /api/settings validates uploadDistributionMode value", async () => {
    mocks.readBody.mockResolvedValue({ uploadDistributionMode: "bad" });
    const handler = (await import("../../server/api/settings.put")).default;
    const event = {} as Parameters<typeof handler>[0];

    await expect(handler(event)).rejects.toMatchObject({
      cause: {
        statusCode: 400,
        statusMessage: "uploadDistributionMode must be 'range' or 'even'",
      },
    });
  });

  test("PUT /api/settings forwards body to writeSettings", async () => {
    mocks.readBody.mockResolvedValue({
      env: { A: "1" },
      collectionId: "cid",
      autoUploadAfterAnalyze: true,
      uploadDistributionMode: "range",
      uploadCollections: [
        {
          collectionId: "cid",
          createUrl: "https://collections.only-nice.com/collection/cid",
          rangeStart: 1,
          rangeEnd: 4,
        },
      ],
    });
    mocks.writeSettings.mockReturnValue({ ok: true });

    const handler = (await import("../../server/api/settings.put")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = await handler(event);

    expect(mocks.writeSettings).toHaveBeenCalledWith({
      env: { A: "1" },
      collectionId: "cid",
      autoUploadAfterAnalyze: true,
      uploadDistributionMode: "range",
      uploadCollections: [
        {
          collectionId: "cid",
          createUrl: "https://collections.only-nice.com/collection/cid",
          rangeStart: 1,
          rangeEnd: 4,
        },
      ],
    });
    expect(result).toEqual({ ok: true });
  });
});
