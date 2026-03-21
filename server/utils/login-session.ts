import type { Browser, BrowserContext, Page } from "playwright";

interface LoginSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  baseUrl: string;
  startedAt: string;
}

let session: LoginSession | null = null;

export function isLoginSessionActive(): boolean {
  return Boolean(session);
}

export function getLoginSessionMeta() {
  if (!session) return null;

  return {
    baseUrl: session.baseUrl,
    startedAt: session.startedAt,
  };
}

export async function startLoginSession(baseUrl: string, headless: boolean): Promise<void> {
  if (session) return;

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(baseUrl, { waitUntil: "networkidle" });

  session = {
    browser,
    context,
    page,
    baseUrl,
    startedAt: new Date().toISOString(),
  };
}

export async function finishLoginSession(storageStatePath: string): Promise<boolean> {
  if (!session) return false;

  const current = session;
  session = null;

  try {
    await current.context.storageState({ path: storageStatePath });
  } finally {
    await current.browser.close();
  }

  return true;
}

export async function abortLoginSession(): Promise<void> {
  if (!session) return;
  const current = session;
  session = null;
  await current.browser.close();
}
