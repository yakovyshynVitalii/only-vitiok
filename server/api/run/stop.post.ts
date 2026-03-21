import { stopRunningTask } from "~/server/utils/process-runner";

export default defineEventHandler(() => {
  const result = stopRunningTask();

  if (!result.stopped) {
    return {
      ok: false,
      message: "No running task to stop.",
    };
  }

  return {
    ok: true,
    message: `Stop signal sent to task: ${result.runningTask}.`,
    runningTask: result.runningTask,
  };
});
