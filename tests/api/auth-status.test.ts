import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  isLoginSessionActive: vi.fn(),
  getLoginSessionMeta: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: mocks.existsSync,
    },
    existsSync: mocks.existsSync,
  };
});

vi.mock("~/server/utils/login-session", () => ({
  isLoginSessionActive: mocks.isLoginSessionActive,
  getLoginSessionMeta: mocks.getLoginSessionMeta,
}));

describe("GET /api/auth/status", () => {
  test("returns auth status and session meta", async () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.isLoginSessionActive.mockReturnValue(true);
    mocks.getLoginSessionMeta.mockReturnValue({ startedAt: "x" });

    const handler = (await import("~/server/api/auth/status.get")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = handler(event);

    expect(result).toEqual({
      stateExists: true,
      loginSessionActive: true,
      loginSession: { startedAt: "x" },
    });
  });
});
