import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rm: vi.fn(),
  isLoginSessionActive: vi.fn(),
  abortLoginSession: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: {
    rm: mocks.rm,
  },
  rm: mocks.rm,
}));

vi.mock("~/server/utils/login-session", () => ({
  isLoginSessionActive: mocks.isLoginSessionActive,
  abortLoginSession: mocks.abortLoginSession,
}));

describe("POST /api/auth/logout", () => {
  test("aborts active session and removes state", async () => {
    mocks.isLoginSessionActive.mockReturnValue(true);
    mocks.rm.mockResolvedValue(undefined);

    const handler = (await import("../../server/api/auth/logout.post")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = await handler(event);

    expect(mocks.abortLoginSession).toHaveBeenCalledTimes(1);
    expect(mocks.rm).toHaveBeenCalled();
    expect(result).toMatchObject({
      loggedOut: true,
      stateRemoved: true,
      hadActiveSession: true,
      stateExists: false,
      loginSessionActive: false,
    });
  });

  test("returns stateRemoved=false when state deletion fails", async () => {
    mocks.isLoginSessionActive.mockReturnValue(false);
    mocks.rm.mockRejectedValue(new Error("no access"));

    const handler = (await import("../../server/api/auth/logout.post")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = await handler(event);

    expect(mocks.abortLoginSession).not.toHaveBeenCalled();
    expect(result.stateRemoved).toBe(false);
    expect(result.loggedOut).toBe(true);
  });
});
