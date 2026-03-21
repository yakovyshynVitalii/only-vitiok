import { runScriptTask } from "~/server/utils/process-runner";

export default defineEventHandler(async () => {
  const result = await runScriptTask("add-tags", "scripts/add-tags.js");

  return {
    ok: true,
    output: result.output,
  };
});
