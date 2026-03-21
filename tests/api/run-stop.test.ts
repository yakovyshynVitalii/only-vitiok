import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stopRunningTask: vi.fn(),
}));

vi.mock("~/server/utils/process-runner", () => ({
  stopRunningTask: mocks.stopRunningTask,
}));

describe("POST /api/run/stop", () => {
  test("returns no-op when no task is running", async () => {
    mocks.stopRunningTask.mockReturnValue({
      stopped: false,
      runningTask: null,
    });

    const handler = (await import("~/server/api/run/stop.post")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = handler(event);

    expect(result).toEqual({
      ok: false,
      message: "No running task to stop.",
    });
  });

  test("returns success when stop signal is sent", async () => {
    mocks.stopRunningTask.mockReturnValue({
      stopped: true,
      runningTask: "analyze",
    });

    const handler = (await import("~/server/api/run/stop.post")).default;
    const event = {} as Parameters<typeof handler>[0];
    const result = handler(event);

    expect(result).toEqual({
      ok: true,
      message: "Stop signal sent to task: analyze.",
      runningTask: "analyze",
    });
  });
});
