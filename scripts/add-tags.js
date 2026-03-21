const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

function getEnv() {
  const createUrl = process.env.CREATE_URL;
  if (!createUrl) {
    throw new Error("CREATE_URL is missing. Add CREATE_URL to .env");
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
    throw new Error(`Config not found: ${configPath}`);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (!Array.isArray(config.items)) {
    throw new Error("Invalid media-config.json format: items is not an array");
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
  const fromGlobal = Array.isArray(config.hashtags)
    ? [...new Set(config.hashtags.map(normalizeTag).filter(Boolean))]
    : [];

  if (fromGlobal.length) {
    return fromGlobal.slice(0, 15);
  }

  const stats = new Map();
  for (const item of config.items || []) {
    for (const tag of Array.isArray(item?.hashtags) ? item.hashtags : []) {
      const normalized = normalizeTag(tag);
      if (!normalized) continue;
      stats.set(normalized, (stats.get(normalized) || 0) + 1);
    }
  }

  return [...stats.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 15)
    .map(([tag]) => tag);
}

async function openTagModal(page) {
  const tagButtons = page.locator('button:has(span[class*="i-solar:tag-outline"]):visible');
  const count = await tagButtons.count();
  if (!count) throw new Error("Tag button not found");

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

  throw new Error("Tag modal did not open (input/add controls not found)");
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
      console.log(`⚠️  Add button is disabled for tag: ${tag}`);
      continue;
    }

    await addBtn.click();
    await page.waitForTimeout(180);
    console.log(`🏷 Tag added: ${tag}`);
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
    console.log("✅ No tags found in config to add");
    return;
  }

  const browser = await chromium.launch({ headless: env.HEADLESS });
  const context = await browser.newContext({ storageState: "state.json" });
  const page = await context.newPage();

  try {
    console.log("1) Opening browser");
    await page.goto(env.CREATE_URL, { waitUntil: "networkidle" });
    console.log("2) Site loaded");

    console.log("3) Clicking tag button");
    await openTagModal(page);
    console.log("4) Tag modal is open");

    console.log(`5-6) Adding tags (${tags.length})`);
    await addAllTagsInModal(page, tags);

    console.log("7) Closing tag modal");
    await closeTagModal(page);
  } finally {
    console.log("8) Closing browser");
    await browser.close();
  }
})();
