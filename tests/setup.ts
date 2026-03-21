import { afterEach, vi } from "vitest";

const defineEventHandlerMock = <T extends (...args: unknown[]) => unknown>(
  handler: T
) => handler;

(globalThis as unknown as { defineEventHandler: typeof defineEventHandlerMock })
  .defineEventHandler = defineEventHandlerMock;

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
