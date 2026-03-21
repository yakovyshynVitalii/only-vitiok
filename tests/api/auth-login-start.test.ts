import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  isLoginSessionActive: vi.fn(),
  getLoginSessionMeta: vi.fn(),
  startLoginSession: vi.fn(),
  readSettings: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: mocks.existsSync,
  },
  existsSync: mocks.existsSync,
}));

vi.mock("~/server/utils/login-session", () => ({
  isLoginSessionActive: mocks.isLoginSessionActive,
  getLoginSessionMeta: mocks.getLoginSessionMeta,
  startLoginSession: mocks.startLoginSession,
}));

vi.mock("~/server/utils/settings", () => ({
  readSettings: mocks.readSettings,
}));

describe("POST /api/auth/login-start", () => {
  test("returns already logged in when state exists", async () => {
    mocks.existsSync.mockReturnValue(true);
    const handler = (await import("../../server/api/auth/login-start.post")).default;
    const event = {} as Parameters<typeof handler>[0];

    const result = await handler(event);
    expect(result).toMatchObject({
      started: false,
      stateExists: true,
    });
  });

  test("returns active session info when login session exists", async () => {
    mocks.existsSync.mockReturnValue(false);
    mocks.isLoginSessionActive.mockReturnValue(true);
    mocks.getLoginSessionMeta.mockReturnValue({ startedAt: "now" });

    const handler = (await import("../../server/api/auth/login-start.post")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = await handler(event);

    expect(result).toMatchObject({
      started: false,
      loginSessionActive: true,
      loginSession: { startedAt: "now" },
    });
  });

  test("throws when BASE_URL is missing", async () => {
    mocks.existsSync.mockReturnValue(false);
    mocks.isLoginSessionActive.mockReturnValue(false);
    mocks.readSettings.mockReturnValue({ env: { BASE_URL: "" } });

    const handler = (await import("../../server/api/auth/login-start.post")).default;
    const event = {} as Parameters<typeof handler>[0];
    await expect(handler(event)).rejects.toMatchObject({
      cause: {
        statusCode: 400,
        statusMessage: "BASE_URL is not set in .env",
      },
    });
  });

  test("starts login session with HEADLESS flag", async () => {
    mocks.existsSync.mockReturnValue(false);
    mocks.isLoginSessionActive.mockReturnValue(false);
    mocks.readSettings.mockReturnValue({
      env: { BASE_URL: "https://example.com", HEADLESS: "true" },
    });
    mocks.getLoginSessionMeta.mockReturnValue({ startedAt: "t1" });

    const handler = (await import("../../server/api/auth/login-start.post")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = await handler(event);

    expect(mocks.startLoginSession).toHaveBeenCalledWith("https://example.com", true);
    expect(result).toMatchObject({
      started: true,
      loginSessionActive: true,
    });
  });
});
