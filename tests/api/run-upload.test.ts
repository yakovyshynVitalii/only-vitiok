import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runScriptTask: vi.fn(),
}));

vi.mock("~/server/utils/process-runner", () => ({
  runScriptTask: mocks.runScriptTask,
}));

describe("POST /api/run/upload", () => {
  test("runs upload script and returns output", async () => {
    mocks.runScriptTask.mockResolvedValue({ output: "uploaded" });
    const handler = (await import("../../server/api/run/upload.post")).default;
    const event = {} as Parameters<typeof handler>[0];

    const result = await handler(event);
    expect(mocks.runScriptTask).toHaveBeenCalledWith("upload", "scripts/upload.js");
    expect(result).toEqual({
      ok: true,
      output: "uploaded",
    });
  });
});
