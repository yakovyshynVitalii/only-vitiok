const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { parseUploadTargets, planUploads } = require("./upload-targets");

function getEnv() {
  const { distributionMode, targets } = parseUploadTargets(process.env);

  return {
    distributionMode,
    uploadTargets: targets,
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

function rankTags(items) {
  const stats = new Map();
  for (const item of items || []) {
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

function getTagsFromConfig(config) {
  const fromGlobal = Array.isArray(config.hashtags)
    ? [...new Set(config.hashtags.map(normalizeTag).filter(Boolean))]
    : [];

  if (fromGlobal.length) {
    return fromGlobal.slice(0, 15);
  }

  return rankTags(config.items || []);
}

function getTagsForPlan(plan, config) {
  const itemTags = rankTags(plan.items || []);
  if (itemTags.length) return itemTags;
  return getTagsFromConfig(config);
}

function getActiveUploadTargets(config, env) {
  const plans = planUploads(
    Array.isArray(config?.items) ? config.items : [],
    env.uploadTargets,
    env.distributionMode
  );
  const uniqueTargets = [];
  const seenUrls = new Set();

  for (const plan of plans.plans) {
    if (!plan.items.length) continue;
    if (!plan.createUrl || seenUrls.has(plan.createUrl)) continue;
    seenUrls.add(plan.createUrl);
    uniqueTargets.push(plan);
  }

  return uniqueTargets;
}

async function findNearestAddButton(page, inputBox) {
  if (!inputBox) return null;

  const buttons = page.locator("button:visible");
  const count = await buttons.count();
  const inputCenterY = inputBox.y + inputBox.height / 2;
  const inputRightX = inputBox.x + inputBox.width;
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    const box = await button.boundingBox().catch(() => null);
    if (!box) continue;

    const buttonCenterY = box.y + box.height / 2;
    const horizontalDistance = box.x - inputRightX;
    const verticalDistance = Math.abs(buttonCenterY - inputCenterY);

    if (horizontalDistance < -4 || horizontalDistance > 220) continue;
    if (verticalDistance > Math.max(inputBox.height, box.height)) continue;

    if (horizontalDistance < bestDistance) {
      bestDistance = horizontalDistance;
      bestIndex = index;
    }
  }

  if (bestIndex >= 0) {
    return buttons.nth(bestIndex);
  }

  return null;
}

async function getComposerControls(page) {
  const inputs = page.locator("input:visible");
  const count = await inputs.count();
  let fallbackInput = null;
  let fallbackButton = null;

  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index);
    const placeholder = String(
      (await input.getAttribute("placeholder").catch(() => "")) || ""
    ).trim();
    const inputBox = await input.boundingBox().catch(() => null);
    if (!inputBox) continue;

    const addButton = await findNearestAddButton(page, inputBox);
    if (!addButton) continue;

    if (!fallbackInput) {
      fallbackInput = input;
      fallbackButton = addButton;
    }

    if (!/поиск|search/i.test(placeholder)) {
      return { input, addButton };
    }
  }

  if (fallbackInput && fallbackButton) {
    return { input: fallbackInput, addButton: fallbackButton };
  }

  return {
    input: inputs.first(),
    addButton: page.locator("button:visible").last(),
  };
}

async function openTagModal(page) {
  const tagButtons = page.locator(
    [
      'button:has(span[class*="tag"]):visible',
      'button:has(i[class*="tag"]):visible',
      'button[aria-label*="tag" i]:visible',
      'button:has-text("Tag"):visible',
      'button:has-text("Tags"):visible',
    ].join(", ")
  );
  const count = await tagButtons.count();
  if (!count) throw new Error("Tag button not found on collection page");

  // The page may have multiple tag icons; try candidates until modal controls appear.
  for (let i = 0; i < Math.min(count, 10); i += 1) {
    const btn = tagButtons.nth(i);
    await btn.click().catch(() => {});
    await page.waitForTimeout(350);

    const { input, addButton: addBtn } = await getComposerControls(page);

    const inputVisible = (await input.count()) > 0;
    const addVisible = (await addBtn.count()) > 0;

    if (inputVisible && addVisible) return;
  }

  throw new Error("Tag modal did not open (input/add controls not found)");
}

async function addAllTagsInModal(page, tags) {
  for (const tag of tags) {
    const { input: tagInput, addButton: addBtn } = await getComposerControls(page);
    await tagInput.waitFor({ state: "visible", timeout: 10000 });
    await addBtn.waitFor({ state: "visible", timeout: 10000 });

    console.log(`   Typing tag: ${tag}`);
    await tagInput.fill(tag);
    await page.waitForTimeout(180);

    const enabled = await addBtn.isEnabled().catch(() => false);
    if (!enabled) {
      console.log(`⚠️  Add button is disabled for tag: ${tag}`);
      continue;
    }

    await addBtn.click({ timeout: 5000 }).catch(async () => {
      await addBtn.click({ force: true, timeout: 5000 });
    });
    await page.waitForTimeout(500);

    const cleared = (await tagInput.inputValue().catch(() => "")) === "";
    if (!cleared) {
      await tagInput.press("Enter").catch(() => {});
      await page.waitForTimeout(350);
    }

    console.log(`🏷 Tag added: ${tag}`);
  }
}

async function closeTagModal(page) {
  const closeBtn = page
    .locator(
      [
        'button:has-text("×")',
        'button:has-text("✕")',
        'button:has(span[class*="x"])',
        'button:has(i[class*="x"])',
        'button[aria-label*="close" i]',
        'button:has-text("Close")',
      ].join(", ")
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

function getStorageStatePath() {
  return path.resolve("state.json");
}

function ensureStorageStateExists() {
  const storageStatePath = getStorageStatePath();

  if (!fs.existsSync(storageStatePath)) {
    throw new Error(
      "state.json is missing. Click Login, sign in in the browser, then click Finish login before running Add tags."
    );
  }

  return storageStatePath;
}

async function ensureCollectionLoaded(page, createUrl) {
  await page.goto(createUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200);
}

(async () => {
  loadDotEnv();
  const env = getEnv();
  const config = readConfig(env.MEDIA_CONFIG_PATH);
  const activeTargets = getActiveUploadTargets(config, env);
  const storageStatePath = ensureStorageStateExists();

  if (!activeTargets.length) {
    console.log("✅ No collections with assigned assets found for tag sync");
    return;
  }

  const browser = await chromium.launch({ headless: env.HEADLESS });
  const context = await browser.newContext({ storageState: storageStatePath });
  const page = await context.newPage();
  const failures = [];

  try {
    console.log("1) Opening browser");

    for (let index = 0; index < activeTargets.length; index += 1) {
      const target = activeTargets[index];

      try {
        const tags = getTagsForPlan(target, config);
        if (!tags.length) {
          console.log(`⚠️  No tags found for collection ${target.createUrl}, skipping`);
          continue;
        }

        console.log(
          `${index + 2}) Opening collection ${index + 1}/${activeTargets.length}: ${target.createUrl}`
        );
        await ensureCollectionLoaded(page, target.createUrl);

        console.log(`   Clicking tag button for collection ${index + 1}`);
        await openTagModal(page);

        console.log(`   Adding tags (${tags.length})`);
        await addAllTagsInModal(page, tags);

        console.log(`   Closing tag modal for collection ${index + 1}`);
        await closeTagModal(page);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({
          createUrl: target.createUrl,
          message,
        });
        console.log(`❌ Failed to add tags for collection ${target.createUrl}`);
        console.log(message);
      }
    }

    if (failures.length) {
      throw new Error(
        failures
          .map(
            (failure, index) =>
              `${index + 1}. ${failure.createUrl} -> ${failure.message}`
          )
          .join("\n")
      );
    }
  } finally {
    console.log("9) Closing browser");
    await browser.close();
  }
})().catch((err) => {
  console.error("❌ add-tags failed:", err.message);
  process.exit(1);
});
