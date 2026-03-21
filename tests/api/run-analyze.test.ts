import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readSettings: vi.fn(),
  ensureMediaFolder: vi.fn(),
  runScriptTask: vi.fn(),
  startOllamaServe: vi.fn(),
  warmupOllamaModel: vi.fn(),
  stopOllamaModel: vi.fn(),
  stopOllamaServe: vi.fn(),
}));

vi.mock("~/server/utils/settings", () => ({
  readSettings: mocks.readSettings,
  ensureMediaFolder: mocks.ensureMediaFolder,
}));

vi.mock("~/server/utils/process-runner", () => ({
  runScriptTask: mocks.runScriptTask,
}));

vi.mock("~/server/utils/ollama-runner", () => ({
  startOllamaServe: mocks.startOllamaServe,
  warmupOllamaModel: mocks.warmupOllamaModel,
  stopOllamaModel: mocks.stopOllamaModel,
  stopOllamaServe: mocks.stopOllamaServe,
}));

describe("POST /api/run/analyze", () => {
  test("runs analyze without auto upload", async () => {
    mocks.ensureMediaFolder.mockReturnValue("/tmp/media");
    mocks.readSettings.mockReturnValue({
      env: {
        AUTO_UPLOAD_AFTER_ANALYZE: "false",
        OLLAMA_URL: "http://127.0.0.1:11434",
        OLLAMA_MODEL: "model-a",
      },
    });
    mocks.startOllamaServe.mockResolvedValue({
      logs: ["serve-started"],
      startedByRunner: true,
      child: null,
    });
    mocks.warmupOllamaModel.mockResolvedValue("warmup-ok");
    mocks.runScriptTask.mockResolvedValue({ output: "analyze-done" });
    mocks.stopOllamaModel.mockResolvedValue({ logs: ["model-stopped"] });
    mocks.stopOllamaServe.mockResolvedValue({ logs: ["serve-stopped"] });

    const handler = (await import("../../server/api/run/analyze.post")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = await handler(event);

    expect(mocks.runScriptTask).toHaveBeenCalledTimes(1);
    expect(mocks.runScriptTask).toHaveBeenCalledWith(
      "analyze",
      "scripts/generate-config.js"
    );
    expect(result.autoUpload).toBe(false);
    expect(result.analyzeOutput).toContain("serve-started");
    expect(result.analyzeOutput).toContain("analyze-done");
    expect(result.uploadOutput).toBe("");
  });

  test("runs auto upload when AUTO_UPLOAD_AFTER_ANALYZE is true", async () => {
    mocks.ensureMediaFolder.mockReturnValue("/tmp/media");
    mocks.readSettings.mockReturnValue({
      env: {
        AUTO_UPLOAD_AFTER_ANALYZE: "true",
        OLLAMA_URL: "http://127.0.0.1:11434",
        OLLAMA_MODEL: "model-a",
      },
    });
    mocks.startOllamaServe.mockResolvedValue({
      logs: [],
      startedByRunner: true,
      child: null,
    });
    mocks.warmupOllamaModel.mockResolvedValue("warmup-ok");
    mocks.runScriptTask
      .mockResolvedValueOnce({ output: "analyze-done" })
      .mockResolvedValueOnce({ output: "tags-done" })
      .mockResolvedValueOnce({ output: "upload-done" });
    mocks.stopOllamaModel.mockResolvedValue({ logs: [] });
    mocks.stopOllamaServe.mockResolvedValue({ logs: [] });

    const handler = (await import("../../server/api/run/analyze.post")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = await handler(event);

    expect(mocks.runScriptTask).toHaveBeenNthCalledWith(
      1,
      "analyze",
      "scripts/generate-config.js"
    );
    expect(mocks.runScriptTask).toHaveBeenNthCalledWith(
      2,
      "add-tags",
      "scripts/add-tags.js"
    );
    expect(mocks.runScriptTask).toHaveBeenNthCalledWith(
      3,
      "upload",
      "scripts/upload.js"
    );
    expect(result.autoUpload).toBe(true);
    expect(result.addTagsOutput).toBe("tags-done");
    expect(result.uploadOutput).toBe("upload-done");
  });

  test("stops model and serve in finally block even when analyze fails", async () => {
    mocks.ensureMediaFolder.mockReturnValue("/tmp/media");
    mocks.readSettings.mockReturnValue({
      env: {
        AUTO_UPLOAD_AFTER_ANALYZE: "false",
        OLLAMA_URL: "http://127.0.0.1:11434",
        OLLAMA_MODEL: "model-a",
      },
    });
    mocks.startOllamaServe.mockResolvedValue({
      logs: [],
      startedByRunner: true,
      child: null,
    });
    mocks.warmupOllamaModel.mockResolvedValue("warmup-ok");
    mocks.runScriptTask.mockRejectedValue(new Error("analyze-failed"));
    mocks.stopOllamaModel.mockResolvedValue({ logs: [] });
    mocks.stopOllamaServe.mockResolvedValue({ logs: [] });

    const handler = (await import("../../server/api/run/analyze.post")).default;
    const event = {} as Parameters<typeof handler>[0];
    await expect(handler(event)).rejects.toThrow("analyze-failed");

    expect(mocks.stopOllamaModel).toHaveBeenCalledWith("model-a");
    expect(mocks.stopOllamaServe).toHaveBeenCalled();
  });
});
