import { createError, readBody } from "h3";
import { writeSettings } from "~/server/utils/settings";

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    env?: Record<string, string>;
    collectionId?: string;
    autoUploadAfterAnalyze?: boolean;
    uploadDistributionMode?: "range" | "even";
    uploadCollections?: Array<{
      collectionId?: string;
      createUrl?: string;
      rangeStart?: number | null;
      rangeEnd?: number | null;
      assetCount?: number | null;
    }>;
  }>(event);

  if (body?.env && typeof body.env !== "object") {
    throw createError({
      statusCode: 400,
      statusMessage: "env must be an object with key=value pairs",
    });
  }

  if (
    Object.prototype.hasOwnProperty.call(body || {}, "uploadCollections") &&
    !Array.isArray(body?.uploadCollections)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: "uploadCollections must be an array",
    });
  }

  if (
    body?.uploadDistributionMode &&
    body.uploadDistributionMode !== "range" &&
    body.uploadDistributionMode !== "even"
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: "uploadDistributionMode must be 'range' or 'even'",
    });
  }

  return writeSettings({
    env: body?.env,
    collectionId: body?.collectionId,
    autoUploadAfterAnalyze: body?.autoUploadAfterAnalyze,
    uploadDistributionMode: body?.uploadDistributionMode,
    uploadCollections: body?.uploadCollections,
  });
});
