import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTaskStatus: vi.fn(),
}));

vi.mock("~/server/utils/process-runner", () => ({
  getTaskStatus: mocks.getTaskStatus,
}));

describe("GET /api/run/status", () => {
  test("returns runner task status", async () => {
    mocks.getTaskStatus.mockReturnValue({
      runningTask: "analyze",
      isBusy: true,
    });

    const handler = (await import("../../server/api/run/status.get")).default;
    const event = {} as Parameters<typeof handler>[0];
    expect(handler(event)).toEqual({
      runningTask: "analyze",
      isBusy: true,
    });
  });
});
