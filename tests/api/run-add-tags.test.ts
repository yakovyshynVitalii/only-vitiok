import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runScriptTask: vi.fn(),
}));

vi.mock("~/server/utils/process-runner", () => ({
  runScriptTask: mocks.runScriptTask,
}));

describe("POST /api/run/add-tags", () => {
  test("runs add-tags script and returns output", async () => {
    mocks.runScriptTask.mockResolvedValue({ output: "tags-added" });
    const handler = (await import("../../server/api/run/add-tags.post")).default;
    const event = {} as Parameters<typeof handler>[0];

    const result = await handler(event);
    expect(mocks.runScriptTask).toHaveBeenCalledWith(
      "add-tags",
      "scripts/add-tags.js"
    );
    expect(result).toEqual({
      ok: true,
      output: "tags-added",
    });
  });
});
