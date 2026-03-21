import fs from "node:fs";
import { createError } from "h3";
import { STATE_PATH } from "~/server/utils/constants";
import {
  getLoginSessionMeta,
  isLoginSessionActive,
  startLoginSession,
} from "~/server/utils/login-session";
import { readSettings } from "~/server/utils/settings";

function parseBool(value: string, fallback = false): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export default defineEventHandler(async () => {
  const stateExists = fs.existsSync(STATE_PATH);
  if (stateExists) {
    return {
      started: false,
      stateExists: true,
      loginSessionActive: false,
      message: "state.json already exists, user is considered logged in.",
    };
  }

  if (isLoginSessionActive()) {
    return {
      started: false,
      stateExists: false,
      loginSessionActive: true,
      loginSession: getLoginSessionMeta(),
      message: "Login session is already active. Click 'Finish login' after signing in.",
    };
  }

  const settings = readSettings();
  const baseUrl = settings.env.BASE_URL;

  if (!baseUrl) {
    throw createError({
      statusCode: 400,
      statusMessage: "BASE_URL is not set in .env",
    });
  }

  await startLoginSession(baseUrl, parseBool(settings.env.HEADLESS, false));

  return {
    started: true,
    stateExists: false,
    loginSessionActive: true,
    loginSession: getLoginSessionMeta(),
    message: "Browser opened. Sign in and click 'Finish login'.",
  };
});
