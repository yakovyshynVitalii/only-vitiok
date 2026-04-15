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
  test("generates provocative title and description from prompt", async () => {
    mocks.readBody.mockResolvedValue({ prompt: "Persian Baby photo leaks Part 1" });
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
              title: "🔥 Persian Baby Exposed — Forbidden Leaks",
              description: "These leaked pics were never meant for your eyes 😈 But here I am, dripping and begging you to see more 💦",
            }),
          },
        }),
      }))
    );

    const handler = (await import("../../server/api/run/generate-collection.post")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = await handler(event);

    expect(result.title).toBe("🔥 Persian Baby Exposed — Forbidden Leaks");
    expect(result.description).toContain("leaked");
    expect(result.prompt).toBe("Persian Baby photo leaks Part 1");
  });

  test("sends system prompt for provocative generation", async () => {
    mocks.readBody.mockResolvedValue({ prompt: "Hot blonde selfies collection" });
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
        expect(payload.messages).toHaveLength(2);
        expect(payload.messages[0].role).toBe("system");
        expect(payload.messages[0].content).toContain("provocative");
        expect(payload.messages[1].role).toBe("user");
        expect(payload.messages[1].content).toContain("Hot blonde selfies collection");

        return {
          ok: true,
          json: async () => ({
            message: {
              content: JSON.stringify({
                title: "💋 Hot Blonde Uncensored Selfies",
                description: "These selfies are way too hot for Instagram 😈",
              }),
            },
          }),
        };
      })
    );

    const handler = (await import("../../server/api/run/generate-collection.post")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = await handler(event);

    expect(result.title).toContain("Blonde");
  });

  test("truncates title and description to max length", async () => {
    mocks.readBody.mockResolvedValue({ prompt: "test prompt" });
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
              title: "A".repeat(100),
              description: "B".repeat(250),
            }),
          },
        }),
      }))
    );

    const handler = (await import("../../server/api/run/generate-collection.post")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = await handler(event);

    expect(result.title.length).toBeLessThanOrEqual(80);
    expect(result.description.length).toBeLessThanOrEqual(200);
  });
});
