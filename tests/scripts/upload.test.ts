import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  isRetryableUploadError,
  isUploadSingleUrl,
} = require("../../scripts/upload.js") as {
  isRetryableUploadError: (err: Error) => boolean;
  isUploadSingleUrl: (url: string) => boolean;
};

describe("upload retry detection", () => {
  test("recognizes upload-single network requests", () => {
    expect(isUploadSingleUrl("https://example.com/api/upload-single")).toBe(true);
    expect(isUploadSingleUrl("https://example.com/api/upload-single?x=1")).toBe(true);
    expect(isUploadSingleUrl("https://example.com/api/upload")).toBe(false);
  });

  test("retries upload-single and rate limit failures", () => {
    expect(
      isRetryableUploadError(new Error("upload-single failed: 429 Too Many Requests"))
    ).toBe(true);
    expect(isRetryableUploadError(new Error("rate limit exceeded"))).toBe(true);
    expect(isRetryableUploadError(new Error("Could not find Done button"))).toBe(false);
  });
});
