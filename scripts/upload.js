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
    throw new Error(`Конфіг не знайдено: ${env.MEDIA_CONFIG_PATH}`);
  }

  const config = JSON.parse(fs.readFileSync(env.MEDIA_CONFIG_PATH, "utf8"));
  if (!Array.isArray(config.items)) {
    throw new Error("Невірний формат media-config.json: items не масив");
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
      console.log(`⚠️  Не вдалося видалити файл: ${filePath} (${err.message})`);
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
    console.log("⚠️  Список існуючих хештегів не знайдено");
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

  console.log(`🏷 Прив'язано хештегів: ${clicked}/${wanted.size}`);
}

async function applyVipFlag(page, vip) {
  if (!vip) return;

  const vipCheckbox = page
    .locator('input[type="checkbox"][name="vip"]')
    .first();
  if ((await vipCheckbox.count()) === 0) {
    console.log("⚠️  VIP чекбокс не знайдено");
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
    'input[placeholder*="Назв" i]',
    'input[placeholder*="Title" i]',
    'input[placeholder*="Заголов" i]',
  ];

  const descriptionSelectors = [
    'textarea[name="description"]',
    'textarea[placeholder*="Опис" i]',
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
      `✍️  Metadata заповнено: title=${titleFilled}, description=${descriptionFilled}`
    );
  } else {
    console.log("⚠️  Поля metadata не знайдені, пропускаю заповнення");
  }

  await applyVipFlag(page, item.vip);
  await applyExistingHashtags(page, item.hashtags);
}

async function clickDoneButton(page) {
  const doneButton = page
    .locator(
      'button:has-text("Done"), button:has-text("Готово"), button:has-text("Готов"):visible'
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
    'button:has-text("Add"), button:has-text("Додати"), button:has-text("Upload")',
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

  throw new Error("Не вдалося відкрити модалку завантаження (file input не з'явився).");
}

async function runUploadOnce() {
  loadDotEnv();
  const env = getEnv();

  const config = readConfig(env);
  const pendingItems = config.items.filter((item) => !item.uploaded);

  if (!pendingItems.length) {
    console.log("✅ Усі файли в конфізі вже завантажені");
    const deleted = deleteUploadedFilesIfComplete(config);
    if (deleted > 0) {
      console.log(`🧹 Видалено файлів після повного успішного аплоаду: ${deleted}`);
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
      console.log(`⚠️  Файл відсутній, пропускаю: ${filePath}`);
      item.uploaded = true;
      item.error = "file_missing";
      writeConfig(config, env);
      continue;
    }

    console.log(`\n📂 Наступний файл: ${filePath}`);

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

      console.log(`✅ Завантажено: ${filePath}`);

      await page.waitForTimeout(5000);
    } catch (err) {
      item.error = err.message;
      writeConfig(config, env);
      console.log(`❌ Помилка з файлом: ${filePath}`);
      console.log(err.message);
      lastErrorMessage = err.message || "unknown_upload_error";

      if (isFileInputDetachTimeout(err)) {
        retryRequested = true;
        console.log(
          "⏳ Отримано таймаут detach для file input. Перезапущу upload через 60 секунд."
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
    console.log(`🧹 Видалено файлів після повного успішного аплоаду: ${deleted}`);
  }
  if (finalConfig.items.every((item) => item.uploaded)) {
    console.log("✅ Усі файли в конфізі вже завантажені");
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
        `Upload не вдався після ${maxAttempts} спроб (таймаут на detach file input).`
      );
    }

    const nextAttempt = attempt + 1;
    console.log(
      `🔁 Спроба ${nextAttempt}/${maxAttempts} стартує через ${Math.round(
        retryDelayMs / 1000
      )} сек...`
    );
    await sleep(retryDelayMs);
  }
})().catch((err) => {
  console.error("❌ upload failed:", err.message);
  process.exit(1);
});
