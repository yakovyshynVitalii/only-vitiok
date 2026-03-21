const { chromium } = require("playwright");
require("dotenv").config();

(async () => {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    throw new Error("BASE_URL is missing. Add BASE_URL to .env");
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(baseUrl, {
    waitUntil: "networkidle",
  });

  console.log("🔐 Sign in if required.");
  console.log("Press Enter after login...");

  process.stdin.resume();
  await new Promise((res) => process.stdin.once("data", res));

  await context.storageState({ path: "state.json" });
  console.log("✅ state.json saved");

  await browser.close();
})();
