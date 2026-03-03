const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

function getEnv() {
  const createUrl = process.env.CREATE_URL;
  if (!createUrl) {
    throw new Error("CREATE_URL не задано. Додай CREATE_URL у .env");
  }

  return {
    CREATE_URL: createUrl,
    MEDIA_CONFIG_PATH: path.resolve(process.env.MEDIA_CONFIG_PATH || "./media-config.json"),
    HEADLESS: String(process.env.HEADLESS || "false").toLowerCase() === "true",
  };
}

function loadDotEnv() {
  const envPath = path.resolve(".env");
  if (!fs.existsSync(envPath)) return;

  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key && process.env[key] == null) process.env[key] = value;
  }
}

function readConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`Конфіг не знайдено: ${configPath}`);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (!Array.isArray(config.items)) {
    throw new Error("Невірний формат media-config.json: items не масив");
  }
  return config;
}

function normalizeTag(value) {
  return String(value || "")
    .trim()
    .replace(/^#/, "")
    .toLowerCase();
}

function getTagsFromConfig(config) {
  const fromGlobal = Array.isArray(config.hashtags) ? config.hashtags : [];
  const fromFirstItem = config.items?.[0]?.hashtags || [];
  const source = fromGlobal.length ? fromGlobal : fromFirstItem;
  return [...new Set(source.map(normalizeTag).filter(Boolean))];
}

async function openTagModal(page) {
  const tagButtons = page.locator('button:has(span[class*="i-solar:tag-outline"]):visible');
  const count = await tagButtons.count();
  if (!count) throw new Error("Кнопка тегів не знайдена");

  // The page may have multiple tag icons; try candidates until modal controls appear.
  for (let i = 0; i < Math.min(count, 6); i += 1) {
    const btn = tagButtons.nth(i);
    await btn.click().catch(() => {});
    await page.waitForTimeout(250);

    const input = page.locator('input[type="text"]:visible').first();
    const addBtn = page
      .locator('button:has(span[class*="i-solar:add-circle-outline"]):visible')
      .first();

    const inputVisible = (await input.count()) > 0;
    const addVisible = (await addBtn.count()) > 0;

    if (inputVisible && addVisible) return;
  }

  throw new Error("Модалка тегів не відкрилась (не знайдені input/add controls)");
}

async function addAllTagsInModal(page, tags) {
  const inputByPlaceholder = page
    .locator('input[type="text"][placeholder*="Anal"][placeholder*="plug"]:visible')
    .first();
  const fallbackInput = page.locator('input[type="text"]:visible').first();
  const tagInput = (await inputByPlaceholder.count()) > 0 ? inputByPlaceholder : fallbackInput;
  await tagInput.waitFor({ state: "visible", timeout: 10000 });

  const addBtn = page
    .locator('button:has(span[class*="i-solar:add-circle-outline"]):visible')
    .first();
  await addBtn.waitFor({ state: "visible", timeout: 10000 });

  for (const tag of tags) {
    await tagInput.fill(tag);
    await page.waitForTimeout(120);

    const enabled = await addBtn.isEnabled().catch(() => false);
    if (!enabled) {
      console.log(`⚠️  Кнопка додавання неактивна для тега: ${tag}`);
      continue;
    }

    await addBtn.click();
    await page.waitForTimeout(180);
    console.log(`🏷 Додано тег: ${tag}`);
  }
}

async function closeTagModal(page) {
  const closeBtn = page
    .locator(
      'button:has-text("×"), button:has-text("✕"), button:has(span[class*="i-lucide:x"]), button:has(span[class*="i-heroicons:x-mark"])'
    )
    .first();

  if ((await closeBtn.count()) > 0) {
    await closeBtn.click().catch(() => {});
    await page.waitForTimeout(200);
    return;
  }

  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(200);
}

(async () => {
  loadDotEnv();
  const env = getEnv();
  const config = readConfig(env.MEDIA_CONFIG_PATH);
  const tags = getTagsFromConfig(config);

  if (!tags.length) {
    console.log("✅ Немає тегів у конфізі для додавання");
    return;
  }

  const browser = await chromium.launch({ headless: env.HEADLESS });
  const context = await browser.newContext({ storageState: "state.json" });
  const page = await context.newPage();

  try {
    console.log("1) Відкриваю браузер");
    await page.goto(env.CREATE_URL, { waitUntil: "networkidle" });
    console.log("2) Сайт завантажено");

    console.log("3) Натискаю кнопку тегів");
    await openTagModal(page);
    console.log("4) Модалка тегів відкрита");

    console.log(`5-6) Додаю теги (${tags.length} шт.)`);
    await addAllTagsInModal(page, tags);

    console.log("7) Закриваю модалку тегів");
    await closeTagModal(page);
  } finally {
    console.log("8) Закриваю браузер");
    await browser.close();
  }
})();
