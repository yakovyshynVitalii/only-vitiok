import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readBody: vi.fn(),
  readSettings: vi.fn(),
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
}));

describe("POST /api/run/generate-collection", () => {
  test("injects model name into description when model omits it", async () => {
    mocks.readBody.mockResolvedValue({ modelName: "LunaFox" });
    mocks.readSettings.mockReturnValue({
      env: {
        OLLAMA_URL: "http://127.0.0.1:11434",
        OLLAMA_MODEL: "qwen2.5vl:7b",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              title: "💋 LunaFox Wants You",
              description: "Hey babe, come get closer and follow for more 😈",
            }),
          },
        }),
      }))
    );

    const handler = (await import("../../server/api/run/generate-collection.post")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = await handler(event);

    expect(result.title).toBe("💋 LunaFox Wants You");
    expect(result.description).toContain("LunaFox");
    expect(result.description).toContain("Hey babe");
  });

  test("injects primary keyword into title when model omits nickname", async () => {
    mocks.readBody.mockResolvedValue({ modelName: "Selti | Seltin_sweety" });
    mocks.readSettings.mockReturnValue({
      env: {
        OLLAMA_URL: "http://127.0.0.1:11434",
        OLLAMA_MODEL: "qwen2.5vl:7b",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const payload = JSON.parse(String(init?.body || "{}"));
        expect(payload.messages[0].content).toContain('Primary SEO keyword: "Selti"');
        expect(payload.messages[0].content).toContain(
          'Supporting SEO keywords: "Selti, Seltin_sweety"'
        );

        return {
          ok: true,
          json: async () => ({
            message: {
              content: JSON.stringify({
                title: "Midnight Temptation",
                description: "Come closer and keep your eyes on me 😈",
              }),
            },
          }),
        };
      })
    );

    const handler = (await import("../../server/api/run/generate-collection.post")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = await handler(event);

    expect(result.title).toContain("Selti");
    expect(result.description).toContain("Selti");
  });

  test("does not duplicate model name when it is already in description", async () => {
    mocks.readBody.mockResolvedValue({ modelName: "NikaStar" });
    mocks.readSettings.mockReturnValue({
      env: {
        OLLAMA_URL: "http://127.0.0.1:11434",
        OLLAMA_MODEL: "qwen2.5vl:7b",
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          message: {
            content: JSON.stringify({
              title: "🔥 NikaStar After Dark",
              description: "I'm NikaStar, and I know how to keep you hooked 😈",
            }),
          },
        }),
      }))
    );

    const handler = (await import("../../server/api/run/generate-collection.post")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = await handler(event);
    const matches = result.description.match(/NikaStar/gi) || [];

    expect(matches).toHaveLength(1);
  });
});
