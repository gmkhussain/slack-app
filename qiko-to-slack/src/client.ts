import { WebClient } from "@slack/web-api";
import { getRuntimeBotToken } from "./runtimeConfig.js";

let client: WebClient | null = null;
let clientToken: string | null = null;

export function getSlackClient(): WebClient {
  const token = getRuntimeBotToken();
  // Reset client if token has changed
  if (!client || clientToken !== token) {
    client = new WebClient(token);
    clientToken = token;
  }
  return client;
}

export function resetSlackClient(): void {
  client = null;
  clientToken = null;
}

export function sanitizeChannelName(name: string): string {
  return name
    .replace(/^#/, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .slice(0, 80);
}

export async function resolveChannelId(
  channel: string
): Promise<{ id: string; name?: string }> {
  const trimmed = channel.trim();
  if (/^[CG][A-Z0-9]+$/i.test(trimmed)) {
    return { id: trimmed.toUpperCase() };
  }

  const target = sanitizeChannelName(trimmed);
  let cursor: string | undefined;

  do {
    const result = await getSlackClient().conversations.list({
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: 200,
      cursor,
    });

    for (const ch of result.channels ?? []) {
      if (ch.id && ch.name?.toLowerCase() === target) {
        return { id: ch.id, name: ch.name };
      }
    }

    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor);

  throw new Error(
    `Channel "${trimmed}" not found. Use channel ID (C…) or add the bot with POST /join.`
  );
}
