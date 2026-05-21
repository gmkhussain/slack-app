import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const rootEnv = resolve(here, "../../.env");
const localEnv = resolve(here, "../.env");

if (existsSync(rootEnv)) loadEnv({ path: rootEnv });
else if (existsSync(localEnv)) loadEnv({ path: localEnv });
else loadEnv();

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

const botToken = requireEnv("SLACK_BOT_TOKEN");
if (!botToken.startsWith("xoxb-")) {
  throw new Error("SLACK_BOT_TOKEN must be a bot token (xoxb-…)");
}

export const notifyConfig = {
  botToken,
  defaultChannel: optionalEnv("SLACK_NOTIFY_CHANNEL", "general"),
  notifySecret: process.env.QIKO_SLACK_NOTIFY_SECRET?.trim() || "",
  port: Number(process.env.QIKO_SLACK_NOTIFY_PORT ?? 3011),
};
