import { runScriptTask } from "~/server/utils/process-runner";

export default defineEventHandler(async () => {
  const uploadResult = await runScriptTask("upload", "scripts/upload.js");

  return {
    ok: true,
    output: uploadResult.output,
  };
});
