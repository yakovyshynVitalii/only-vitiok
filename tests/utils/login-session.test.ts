import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { makeTempDir, removeDir } from "../helpers/fs";

const playwrightMocks = vi.hoisted(() => {
  const goto = vi.fn(async () => {});
  const storageState = vi.fn(async ({ path: filePath }: { path: string }) => {
    fs.writeFileSync(filePath, JSON.stringify({ ok: true }), "utf8");
  });
  const browserClose = vi.fn(async () => {});
  const newPage = vi.fn(async () => ({ goto }));
  const newContext = vi.fn(async () => ({ newPage, storageState }));
  const launch = vi.fn(async () => ({ newContext, close: browserClose }));

  return {
    goto,
    storageState,
    browserClose,
    newPage,
    newContext,
    launch,
  };
});

vi.mock("playwright", () => ({
  chromium: {
    launch: playwrightMocks.launch,
  },
}));

afterEach(async () => {
  vi.resetModules();
  playwrightMocks.goto.mockClear();
  playwrightMocks.storageState.mockClear();
  playwrightMocks.browserClose.mockClear();
  playwrightMocks.newPage.mockClear();
  playwrightMocks.newContext.mockClear();
  playwrightMocks.launch.mockClear();
});

describe("login-session utils", () => {
  test("startLoginSession creates active session and meta", async () => {
    const loginSession = await import("~/server/utils/login-session");

    await loginSession.startLoginSession("https://example.com", true);
    expect(loginSession.isLoginSessionActive()).toBe(true);
    expect(loginSession.getLoginSessionMeta()).toMatchObject({
      baseUrl: "https://example.com",
    });
    expect(playwrightMocks.launch).toHaveBeenCalledWith({ headless: true });
    expect(playwrightMocks.goto).toHaveBeenCalledWith("https://example.com", {
      waitUntil: "networkidle",
    });

    await loginSession.abortLoginSession();
  });

  test("startLoginSession is idempotent while session exists", async () => {
    const loginSession = await import("~/server/utils/login-session");

    await loginSession.startLoginSession("https://example.com", false);
    await loginSession.startLoginSession("https://example.com", true);

    expect(playwrightMocks.launch).toHaveBeenCalledTimes(1);
    await loginSession.abortLoginSession();
  });

  test("finishLoginSession writes storage state and closes browser", async () => {
    const tmp = makeTempDir();
    try {
      const loginSession = await import("~/server/utils/login-session");
      const statePath = path.join(tmp, "state.json");

      await loginSession.startLoginSession("https://example.com", false);
      const finished = await loginSession.finishLoginSession(statePath);

      expect(finished).toBe(true);
      expect(fs.existsSync(statePath)).toBe(true);
      expect(playwrightMocks.storageState).toHaveBeenCalled();
      expect(playwrightMocks.browserClose).toHaveBeenCalled();
      expect(loginSession.isLoginSessionActive()).toBe(false);
    } finally {
      removeDir(tmp);
    }
  });

  test("abortLoginSession closes browser and clears active state", async () => {
    const loginSession = await import("~/server/utils/login-session");

    await loginSession.startLoginSession("https://example.com", false);
    await loginSession.abortLoginSession();

    expect(playwrightMocks.browserClose).toHaveBeenCalled();
    expect(loginSession.isLoginSessionActive()).toBe(false);
    expect(loginSession.getLoginSessionMeta()).toBeNull();
  });
});
