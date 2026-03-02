const { chromium } = require("playwright");

(async () => {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    throw new Error("BASE_URL не задано. Додай BASE_URL у .env");
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(baseUrl, {
    waitUntil: "networkidle",
  });

  console.log("🔐 Залогінься якщо потрібно.");
  console.log("Після логіну натисни Enter...");

  process.stdin.resume();
  await new Promise((res) => process.stdin.once("data", res));

  await context.storageState({ path: "state.json" });
  console.log("✅ state.json збережено");

  await browser.close();
})();
