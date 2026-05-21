import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { notifyConfig } from "./config.js";

const here = dirname(fileURLToPath(import.meta.url));
const RUNTIME_CONFIG_FILE = resolve(here, "../runtime-config.json");

interface RuntimeConfigData {
  botToken?: string;
  channel?: string;
}

let runtimeData: RuntimeConfigData = {};

// Load persisted config from file on startup
if (existsSync(RUNTIME_CONFIG_FILE)) {
  try {
    runtimeData = JSON.parse(readFileSync(RUNTIME_CONFIG_FILE, "utf-8")) as RuntimeConfigData;
    console.log("[qiko-to-slack] Loaded runtime config from runtime-config.json");
  } catch {
    console.warn("[qiko-to-slack] Failed to parse runtime-config.json — using env defaults.");
  }
}

function saveToFile(): void {
  try {
    writeFileSync(RUNTIME_CONFIG_FILE, JSON.stringify(runtimeData, null, 2), "utf-8");
  } catch (err) {
    console.error("[qiko-to-slack] Could not save runtime-config.json:", err);
  }
}

export function getRuntimeBotToken(): string {
  return runtimeData.botToken?.trim() || notifyConfig.botToken;
}

export function getRuntimeChannel(): string {
  return runtimeData.channel?.trim() || notifyConfig.defaultChannel;
}

export function setRuntimeConfig(data: {
  botToken?: string;
  channel?: string;
}): { botToken: string; channel: string } {
  if (data.botToken) {
    if (!data.botToken.startsWith("xoxb-")) {
      throw new Error("bot_token must be a Bot User OAuth Token starting with xoxb-");
    }
    runtimeData.botToken = data.botToken.trim();
  }
  if (data.channel) {
    runtimeData.channel = data.channel.trim();
  }
  saveToFile();
  return { botToken: getRuntimeBotToken(), channel: getRuntimeChannel() };
}

export function getRuntimeConfigSafe(): { bot_token_set: boolean; bot_token_hint: string; channel: string; source: string } {
  const token = getRuntimeBotToken();
  const isRuntime = !!runtimeData.botToken;
  return {
    bot_token_set: !!token,
    bot_token_hint: token ? `${token.slice(0, 10)}...${token.slice(-4)}` : "(not set)",
    channel: getRuntimeChannel(),
    source: isRuntime ? "runtime (saved)" : "env (.env file)",
  };
}
