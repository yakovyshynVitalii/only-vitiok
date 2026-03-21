import fs from "node:fs/promises";
import { STATE_PATH } from "~/server/utils/constants";
import {
  abortLoginSession,
  isLoginSessionActive,
} from "~/server/utils/login-session";

export default defineEventHandler(async () => {
  const hadActiveSession = isLoginSessionActive();
  if (hadActiveSession) {
    await abortLoginSession();
  }

  let stateRemoved = false;

  try {
    await fs.rm(STATE_PATH, { force: true });
    stateRemoved = true;
  } catch {
    stateRemoved = false;
  }

  return {
    loggedOut: true,
    stateRemoved,
    hadActiveSession,
    stateExists: false,
    loginSessionActive: false,
    message: "Logged out. state.json removed and login session closed.",
  };
});
