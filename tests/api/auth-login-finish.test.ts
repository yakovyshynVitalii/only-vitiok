import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  isLoginSessionActive: vi.fn(),
  finishLoginSession: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: mocks.existsSync,
  },
  existsSync: mocks.existsSync,
}));

vi.mock("~/server/utils/login-session", () => ({
  isLoginSessionActive: mocks.isLoginSessionActive,
  finishLoginSession: mocks.finishLoginSession,
}));

describe("POST /api/auth/login-finish", () => {
  test("returns no-op when state exists and no active session", async () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.isLoginSessionActive.mockReturnValue(false);

    const handler = (await import("../../server/api/auth/login-finish.post")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = await handler(event);

    expect(result).toMatchObject({
      finished: false,
      stateExists: true,
    });
  });

  test("throws when no active session and no state", async () => {
    mocks.existsSync.mockReturnValue(false);
    mocks.isLoginSessionActive.mockReturnValue(false);

    const handler = (await import("../../server/api/auth/login-finish.post")).default;
    const event = {} as Parameters<typeof handler>[0];
    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  test("finishes active session and reports state existence", async () => {
    mocks.existsSync
      .mockReturnValueOnce(false) // initial check
      .mockReturnValueOnce(true); // after finish
    mocks.isLoginSessionActive.mockReturnValue(true);

    const handler = (await import("../../server/api/auth/login-finish.post")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = await handler(event);

    expect(mocks.finishLoginSession).toHaveBeenCalled();
    expect(result).toMatchObject({
      finished: true,
      stateExists: true,
    });
  });
});
