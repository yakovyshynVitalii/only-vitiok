import { createError, readBody } from "h3";
import { writeSettings } from "~/server/utils/settings";

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    env?: Record<string, string>;
    collectionId?: string;
    autoUploadAfterAnalyze?: boolean;
  }>(event);

  if (body?.env && typeof body.env !== "object") {
    throw createError({
      statusCode: 400,
      statusMessage: "env must be an object with key=value pairs",
    });
  }

  return writeSettings({
    env: body?.env,
    collectionId: body?.collectionId,
    autoUploadAfterAnalyze: body?.autoUploadAfterAnalyze,
  });
});
