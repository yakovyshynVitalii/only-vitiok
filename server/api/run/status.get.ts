import { getTaskStatus } from "~/server/utils/process-runner";

export default defineEventHandler(() => {
  return getTaskStatus();
});
