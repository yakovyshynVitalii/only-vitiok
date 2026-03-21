import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { makeTempDir, removeDir } from "../helpers/fs";

const originalCwd = process.cwd();
const tempDirs: string[] = [];

afterEach(() => {
  process.chdir(originalCwd);
  vi.resetModules();

  while (tempDirs.length) {
    removeDir(tempDirs.pop() as string);
  }
});

async function loadSettingsModule(tempDir: string) {
  process.chdir(tempDir);
  return import("~/server/utils/settings");
}

describe("settings utils", () => {
  test("readSettings returns defaults when .env is missing", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const settingsMod = await loadSettingsModule(tempDir);

    const settings = settingsMod.readSettings();
    expect(settings.env.BASE_URL).toBe("");
    expect(settings.env.MEDIA_FOLDER).toBe("./media");
    expect(settings.env.MEDIA_IMPORT_PROJECT_ROOT).toBe("true");
    expect(settings.collectionId).toBe("");
    expect(settings.autoUploadAfterAnalyze).toBe(false);
  });

  test("writeSettings persists normalized env and derives CREATE_URL", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    process.chdir(tempDir);
    fs.writeFileSync(
      path.resolve(tempDir, ".env"),
      "BASE_URL=https://collections.only-nice.com\nAUTO_UPLOAD_AFTER_ANALYZE=false\n",
      "utf8"
    );

    const settingsMod = await import("~/server/utils/settings");

    const next = settingsMod.writeSettings({
      env: { CUSTOM_KEY: " custom ", EXTRA: "x" },
      collectionId: "  abc-123  ",
      autoUploadAfterAnalyze: true,
    });

    expect(next.collectionId).toBe("abc-123");
    expect(next.autoUploadAfterAnalyze).toBe(true);
    expect(next.env.CREATE_URL).toBe(
      "https://collections.only-nice.com/collection/abc-123"
    );
    expect(next.env.CUSTOM_KEY).toBe("custom");
    expect(next.env.EXTRA).toBe("x");

    const persisted = fs.readFileSync(path.resolve(tempDir, ".env"), "utf8");
    expect(persisted).toContain("COLLECTION_ID=abc-123");
    expect(persisted).toContain(
      "CREATE_URL=https://collections.only-nice.com/collection/abc-123"
    );
    expect(persisted).toContain("AUTO_UPLOAD_AFTER_ANALYZE=true");
  });

  test("writeSettings keeps explicit CREATE_URL when collectionId is provided", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    process.chdir(tempDir);
    fs.writeFileSync(
      path.resolve(tempDir, ".env"),
      [
        "BASE_URL=https://collections.only-nice.com",
        "COLLECTION_ID=old-collection",
        "CREATE_URL=https://collections.only-nice.com/collection/old-collection",
      ].join("\n") + "\n",
      "utf8"
    );

    const settingsMod = await import("~/server/utils/settings");

    const next = settingsMod.writeSettings({
      env: {
        CREATE_URL:
          "https://collections.only-nice.com/collection/manual-collection?from=custom",
      },
      collectionId: "new-collection",
    });

    expect(next.env.COLLECTION_ID).toBe("new-collection");
    expect(next.env.CREATE_URL).toBe(
      "https://collections.only-nice.com/collection/manual-collection?from=custom"
    );
  });

  test("getMediaFolder/getConfigPath/ensureMediaFolder resolve paths from root", async () => {
    const tempDir = makeTempDir();
    tempDirs.push(tempDir);
    const settingsMod = await loadSettingsModule(tempDir);

    const settings = {
      env: {
        MEDIA_FOLDER: "./my-media",
        MEDIA_CONFIG_PATH: "./cfg/media-config.json",
      },
      envText: "",
      collectionId: "",
      autoUploadAfterAnalyze: false,
    };

    const mediaFolder = settingsMod.getMediaFolder(settings);
    const configPath = settingsMod.getConfigPath(settings);
    const ensured = settingsMod.ensureMediaFolder(settings);

    expect(mediaFolder).toMatch(/my-media$/);
    expect(configPath).toMatch(/cfg\/media-config\.json$/);
    expect(ensured).toBe(mediaFolder);
    expect(fs.existsSync(mediaFolder)).toBe(true);
  });
});
