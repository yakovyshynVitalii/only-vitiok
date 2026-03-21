import { readSettings } from "~/server/utils/settings";

export default defineEventHandler(() => {
  return readSettings();
});
