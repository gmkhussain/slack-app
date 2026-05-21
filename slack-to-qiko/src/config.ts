import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoEnv = resolve(here, "../../.env");
const localEnv = resolve(here, "../.env");

if (existsSync(repoEnv)) loadEnv({ path: repoEnv });
else if (existsSync(localEnv)) loadEnv({ path: localEnv });
else loadEnv();

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function validateBotToken(botToken: string): void {
  if (!botToken.startsWith("xoxb-")) {
    throw new Error(
      "SLACK_BOT_TOKEN must be a Bot User OAuth Token starting with xoxb- (Slack app → OAuth & Permissions → Install App)."
    );
  }
}

function resolveAdminUserToken(): string {
  const raw = process.env.SLACK_ADMIN_USER_TOKEN?.trim() ?? "";
  if (!raw) return "";
  if (!raw.startsWith("xoxp-")) {
    console.warn(
      "[slackapp] SLACK_ADMIN_USER_TOKEN should be a User OAuth Token (xoxp-) with admin.users:write — workspace invite may fail."
    );
  }
  return raw;
}

function resolveAppToken(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("xapp-")) return trimmed;

  console.warn(
    "[slackapp] SLACK_APP_TOKEN is set but not a valid xapp- token — ignoring. Running in HTTP mode."
  );
  return "";
}

const botToken = requireEnv("SLACK_BOT_TOKEN");
validateBotToken(botToken);

const socketModeEnv = process.env.SLACK_SOCKET_MODE?.trim().toLowerCase();
const socketModeDisabled =
  socketModeEnv === "false" ||
  socketModeEnv === "0" ||
  process.env.SLACK_USE_HTTP === "true";

const appToken = socketModeDisabled
  ? ""
  : resolveAppToken(process.env.SLACK_APP_TOKEN ?? "");

export const useSocketMode = !socketModeDisabled && appToken.length > 0;

const signingSecret = requireEnv("SLACK_SIGNING_SECRET");
const skipSignatureVerify =
  process.env.SLACK_SKIP_SIGNATURE_VERIFY?.trim().toLowerCase() === "true";

if (skipSignatureVerify) {
  console.warn(
    "[slackapp] SLACK_SKIP_SIGNATURE_VERIFY=true — signature checks disabled (debug only)."
  );
}

const adminUserToken = resolveAdminUserToken();
if (!adminUserToken) {
  console.warn(
    "[slackapp] SLACK_ADMIN_USER_TOKEN not set — workspace invite commands need a user token (xoxp-); bot token cannot call admin.users.invite."
  );
}

export const config = {
  slack: {
    botToken,
    adminUserToken,
    signingSecret,
    skipSignatureVerify,
    appToken,
    allowedChannelIds: (process.env.SLACK_ALLOWED_CHANNEL_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  },
  qiko: {
    apiBaseUrl: optionalEnv(
      "QIKO_API_BASE_URL",
      "https://stage-backend.qiko.ai/api/avatar"
    ).replace(/\/$/, ""),
    agentUniqueId: requireEnv("QIKO_AGENT_UNIQUE_ID"),
    defaultUserEmail: optionalEnv(
      "QIKO_DEFAULT_USER_EMAIL",
      "slack-user@qiko.local"
    ),
  },
  port: Number(process.env.PORT ?? 3001),
};

export function isChannelAllowed(channelId: string): boolean {
  const { allowedChannelIds } = config.slack;
  if (allowedChannelIds.length === 0) return true;
  return allowedChannelIds.includes(channelId);
}
