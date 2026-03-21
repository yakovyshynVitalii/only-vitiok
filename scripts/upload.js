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
    MEDIA_CONFIG_PATH: path.resolve(
      process.env.MEDIA_CONFIG_PATH || "./media-config.json"
    ),
    HEADLESS: String(process.env.HEADLESS || "false").toLowerCase() === "true",
    ACTION_DELAY_MS: Number(process.env.UPLOAD_ACTION_DELAY_MS || 550),
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

function readConfig(env) {
  if (!fs.existsSync(env.MEDIA_CONFIG_PATH)) {
    throw new Error(`Config not found: ${env.MEDIA_CONFIG_PATH}`);
  }

  const config = JSON.parse(fs.readFileSync(env.MEDIA_CONFIG_PATH, "utf8"));
  if (!Array.isArray(config.items)) {
    throw new Error("Invalid media-config.json format: items is not an array");
  }
  return config;
}

function writeConfig(config, env) {
  fs.writeFileSync(
    env.MEDIA_CONFIG_PATH,
    JSON.stringify(config, null, 2),
    "utf8"
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFileInputDetachTimeout(err) {
  const message = String((err && err.message) || "");
  return (
    message.includes("locator.waitFor: Timeout 60000ms exceeded.") &&
    message.includes(
      "waiting for locator('input[type=\"file\"]') to be detached"
    )
  );
}

function notifyUploadFinished() {
  if (!process.stdout.isTTY) return;
  process.stdout.write("\x07");
  setTimeout(() => process.stdout.write("\x07"), 180);
  setTimeout(() => process.stdout.write("\x07"), 360);
}

function deleteUploadedFilesIfComplete(config) {
  const allUploaded =
    Array.isArray(config.items) &&
    config.items.length > 0 &&
    config.items.every((item) => item.uploaded);
  if (!allUploaded) return 0;

  let deleted = 0;
  for (const item of config.items) {
    const filePath = item.filePath;
    if (!filePath || !fs.existsSync(filePath)) continue;

    try {
      fs.unlinkSync(filePath);
      deleted += 1;
    } catch (err) {
      console.log(`⚠️  Failed to delete file: ${filePath} (${err.message})`);
    }
  }
  return deleted;
}

async function fillFieldIfExists(page, selectors, value) {
  if (!value) return false;

  for (const selector of selectors) {
    const field = page.locator(selector).first();
    if ((await field.count()) === 0) continue;

    try {
      await field.fill(value);
      return true;
    } catch {}
  }

  return false;
}

function normalizeTagValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^#/, "");
}

async function applyExistingHashtags(page, hashtags) {
  const wanted = new Set(
    (hashtags || []).map(normalizeTagValue).filter(Boolean)
  );
  if (!wanted.size) return;

  const chips = page.locator("span.inline-flex:has(.i-solar\\:tag-outline)");
  const total = await chips.count();
  if (!total) {
    console.log("⚠️  Existing hashtag list not found");
    return;
  }

  let clicked = 0;

  for (let i = 0; i < total; i += 1) {
    const chip = chips.nth(i);
    const text = normalizeTagValue((await chip.textContent()) || "");
    if (!text || !wanted.has(text)) continue;

    try {
      await chip.click();
      clicked += 1;
      await page.waitForTimeout(80);
    } catch {}
  }

  console.log(`🏷 Hashtags linked: ${clicked}/${wanted.size}`);
}

async function applyVipFlag(page, vip) {
  if (!vip) return;

  const vipCheckbox = page
    .locator('input[type="checkbox"][name="vip"]')
    .first();
  if ((await vipCheckbox.count()) === 0) {
    console.log("⚠️  VIP checkbox not found");
    return;
  }

  const checked = await vipCheckbox.isChecked().catch(() => false);
  if (!checked) {
    await vipCheckbox.check().catch(async () => {
      await vipCheckbox.click().catch(() => {});
    });
  }

  const finalState = await vipCheckbox.isChecked().catch(() => false);
  console.log(`👑 VIP: ${finalState ? "enabled" : "not enabled"}`);
}

async function fillMetadata(page, item) {
  const titleSelectors = [
    'input[name="title"]',
    'input[placeholder*="Title" i]',
  ];

  const descriptionSelectors = [
    'textarea[name="description"]',
    'textarea[placeholder*="Description" i]',
  ];

  const titleFilled = await fillFieldIfExists(page, titleSelectors, item.title);

  const descriptionFilled = await fillFieldIfExists(
    page,
    descriptionSelectors,
    item.description
  );

  if (titleFilled || descriptionFilled) {
    console.log(
      `✍️  Metadata filled: title=${titleFilled}, description=${descriptionFilled}`
    );
  } else {
    console.log("⚠️  Metadata fields not found, skipping");
  }

  await applyVipFlag(page, item.vip);
  await applyExistingHashtags(page, item.hashtags);
}

async function clickDoneButton(page) {
  const doneButton = page
    .locator(
      'button:has-text("Done"):visible'
    )
    .first();

  await doneButton.waitFor({ state: "visible", timeout: 60000 });
  await doneButton.scrollIntoViewIfNeeded().catch(() => {});

  await page.waitForFunction(
    (el) => !!el && !el.disabled,
    await doneButton.elementHandle(),
    {
      timeout: 10 * 60 * 1000,
    }
  );

  try {
    await doneButton.click({ timeout: 5000 });
  } catch {
    await doneButton.click({ force: true, timeout: 5000 });
  }
}

async function openUploadModal(page) {
  const openButtons = [
    "button:has(.i-majesticons\\:plus-line)",
    'button:has-text("Add"), button:has-text("Upload")',
  ];

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    for (const selector of openButtons) {
      const button = page.locator(selector).first();
      if ((await button.count()) === 0) continue;

      try {
        await button.waitFor({ state: "visible", timeout: 7000 });
        await button.scrollIntoViewIfNeeded().catch(() => {});
        await button.click({ timeout: 5000 });
        break;
      } catch {}
    }

    const fileInput = page.locator('input[type="file"]');
    const appeared = await fileInput
      .waitFor({ state: "attached", timeout: 10000 })
      .then(() => true)
      .catch(() => false);

    if (appeared) return;

    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(700);
  }

  throw new Error("Could not open upload modal (file input did not appear).");
}

async function runUploadOnce() {
  loadDotEnv();
  const env = getEnv();

  const config = readConfig(env);
  const pendingItems = config.items.filter((item) => !item.uploaded);

  if (!pendingItems.length) {
    console.log("✅ All files in config are already uploaded");
    const deleted = deleteUploadedFilesIfComplete(config);
    if (deleted > 0) {
      console.log(`🧹 Deleted files after successful full upload: ${deleted}`);
    }
    notifyUploadFinished();
    return { retryRequested: false };
  }

  const browser = await chromium.launch({
    headless: env.HEADLESS,
    slowMo: env.ACTION_DELAY_MS,
  });
  const context = await browser.newContext({ storageState: "state.json" });
  const page = await context.newPage();
  let retryRequested = false;
  let lastErrorMessage = "";

  await page.goto(env.CREATE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  for (const item of pendingItems) {
    const filePath = item.filePath;

    if (!fs.existsSync(filePath)) {
      console.log(`⚠️  File is missing, skipping: ${filePath}`);
      item.uploaded = true;
      item.error = "file_missing";
      writeConfig(config, env);
      continue;
    }

    console.log(`\n📂 Next file: ${filePath}`);

    try {
      await openUploadModal(page);

      const fileInput = page.locator('input[type="file"]');
      await fileInput.setInputFiles(filePath);

      await fillMetadata(page, item);

      await clickDoneButton(page);

      await page.locator('input[type="file"]').waitFor({
        state: "detached",
        timeout: 60000,
      });

      item.uploaded = true;
      item.uploadedAt = new Date().toISOString();
      delete item.error;
      writeConfig(config, env);

      console.log(`✅ Uploaded: ${filePath}`);

      await page.waitForTimeout(5000);
    } catch (err) {
      item.error = err.message;
      writeConfig(config, env);
      console.log(`❌ File error: ${filePath}`);
      console.log(err.message);
      lastErrorMessage = err.message || "unknown_upload_error";

      if (isFileInputDetachTimeout(err)) {
        retryRequested = true;
        console.log(
          "⏳ File input detach timeout received. Upload will restart in 60 seconds."
        );
      }

      break;
    }
  }

  await browser.close();
  if (retryRequested) {
    return { retryRequested: true };
  }

  if (lastErrorMessage) {
    throw new Error(lastErrorMessage);
  }

  const finalConfig = readConfig(env);
  const deleted = deleteUploadedFilesIfComplete(finalConfig);
  if (deleted > 0) {
    console.log(`🧹 Deleted files after successful full upload: ${deleted}`);
  }
  if (finalConfig.items.every((item) => item.uploaded)) {
    console.log("✅ All files in config are already uploaded");
    notifyUploadFinished();
  }

  return { retryRequested: false };
}

(async () => {
  loadDotEnv();

  const retryDelayMs = Number(process.env.UPLOAD_RETRY_DELAY_MS || 60000);
  const maxAttempts = Number(process.env.UPLOAD_RESTART_ATTEMPTS || 3);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { retryRequested } = await runUploadOnce();
    if (!retryRequested) return;

    if (attempt === maxAttempts) {
      throw new Error(
        `Upload failed after ${maxAttempts} attempts (detach timeout on file input).`
      );
    }

    const nextAttempt = attempt + 1;
    console.log(
      `🔁 Attempt ${nextAttempt}/${maxAttempts} starts in ${Math.round(
        retryDelayMs / 1000
      )} sec...`
    );
    await sleep(retryDelayMs);
  }
})().catch((err) => {
  console.error("❌ upload failed:", err.message);
  process.exit(1);
});
