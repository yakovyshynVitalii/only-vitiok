import fs from "node:fs";
import { createError } from "h3";
import { STATE_PATH } from "~/server/utils/constants";
import {
  finishLoginSession,
  isLoginSessionActive,
} from "~/server/utils/login-session";

export default defineEventHandler(async () => {
  const stateExists = fs.existsSync(STATE_PATH);

  if (!isLoginSessionActive()) {
    if (stateExists) {
      return {
        finished: false,
        stateExists: true,
        message: "state.json already exists, no additional finish step needed.",
      };
    }

    throw createError({
      statusCode: 409,
      statusMessage: "No active login session. Click Login first to start.",
    });
  }

  await finishLoginSession(STATE_PATH);

  return {
    finished: true,
    stateExists: fs.existsSync(STATE_PATH),
    message: "state.json saved.",
  };
});
