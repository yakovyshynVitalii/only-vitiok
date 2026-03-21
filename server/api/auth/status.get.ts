import fs from "node:fs";
import { STATE_PATH } from "~/server/utils/constants";
import {
  getLoginSessionMeta,
  isLoginSessionActive,
} from "~/server/utils/login-session";

export default defineEventHandler(() => {
  const stateExists = fs.existsSync(STATE_PATH);

  return {
    stateExists,
    loginSessionActive: isLoginSessionActive(),
    loginSession: getLoginSessionMeta(),
  };
});
