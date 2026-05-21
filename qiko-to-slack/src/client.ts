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

  try {
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
  } catch (err: unknown) {
    const code =
      err && typeof err === "object" && "data" in err
        ? (err as { data?: { error?: string } }).data?.error
        : undefined;
    if (code === "missing_scope") {
      throw new Error(
        `Cannot resolve channel name "${trimmed}": bot is missing "channels:read" scope.\n` +
          `Fix: Slack app → OAuth & Permissions → Bot Token Scopes → add "channels:read" → Reinstall App.\n` +
          `Quick workaround: pass the Channel ID directly (e.g. "C0B4P79HLE9") instead of the name.`
      );
    }
    throw err;
  }

  throw new Error(
    `Channel "${trimmed}" not found. ` +
      `Make sure the name is correct and the bot has "channels:read" scope.\n` +
      `Quick workaround: pass the Channel ID directly (e.g. "C0B4P79HLE9") instead of the name.`
  );
}
