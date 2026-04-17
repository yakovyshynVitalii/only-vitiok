import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

const require = createRequire(import.meta.url);
const {
  describeUploadSingleFailure,
  isRetryableUploadError,
  isUploadSingleUrl,
} = require("../../scripts/upload.js") as {
  describeUploadSingleFailure: (input: {
    ok: boolean;
    status: number;
    statusText: string;
    bodyText: string;
  }) => string;
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

  test("accepts only confirmed upload-single success payloads", () => {
    expect(
      describeUploadSingleFailure({
        ok: true,
        status: 200,
        statusText: "OK",
        bodyText: JSON.stringify({
          status: "success",
          fileId: "91d7f90f-b22f-4ea1-a34e-b542dab15b6e",
        }),
      })
    ).toBe("");
  });

  test("rejects upload-single rate limit payloads even with HTTP 200", () => {
    const failure = describeUploadSingleFailure({
      ok: true,
      status: 200,
      statusText: "OK",
      bodyText: JSON.stringify({
        status: "error",
        message: "rate limit exceeded",
      }),
    });

    expect(failure).toContain("status=error");
    expect(isRetryableUploadError(new Error(failure))).toBe(true);
  });
});
