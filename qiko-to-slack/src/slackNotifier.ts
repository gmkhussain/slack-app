import { getSlackClient, resolveChannelId } from "./client.js";
import { notifyConfig } from "./config.js";
import { ensureBotInChannel } from "./joinChannel.js";

export { resolveChannelId } from "./client.js";

export interface SendDirectMessageOptions {
  /** Slack User ID (U…) or email address */
  user: string;
  text: string;
}

export interface SendDirectMessageResult {
  userId: string;
  dmChannelId: string;
  ts: string;
}

/**
 * Resolve a Slack user ID from a User ID, @username, display name, or email.
 * - User ID  (U…)       — used directly, no API call
 * - Email    (x@y.z)    — users.lookupByEmail  (requires users:read.email)
 * - @username / name    — users.list scan      (requires users:read)
 */
async function resolveUserId(userRef: string): Promise<string> {
  const trimmed = userRef.trim().replace(/^@/, ""); // strip leading @

  // Already a Slack User ID
  if (/^U[A-Z0-9]+$/i.test(trimmed)) return trimmed.toUpperCase();

  // Email address
  if (trimmed.includes("@")) {
    try {
      const result = await getSlackClient().users.lookupByEmail({ email: trimmed });
      const userId = result.user?.id;
      if (!userId) throw new Error(`User with email "${trimmed}" not found.`);
      return userId;
    } catch (err: unknown) {
      const code =
        err && typeof err === "object" && "data" in err
          ? (err as { data?: { error?: string } }).data?.error
          : undefined;
      if (code === "users_not_found") throw new Error(`No Slack user found with email "${trimmed}".`);
      if (code === "missing_scope") {
        throw new Error(
          `Cannot look up by email: missing "users:read.email" scope.\n` +
            `Fix: Slack app → OAuth & Permissions → add "users:read.email" → Reinstall.\n` +
            `Or pass User ID directly (e.g. "U0B4FAHG4F8").`
        );
      }
      throw err;
    }
  }

  // @username or display name — scan users.list
  const target = trimmed.toLowerCase();
  let cursor: string | undefined;
  try {
    do {
      const result = await getSlackClient().users.list({ limit: 200, cursor });
      for (const member of result.members ?? []) {
        if (member.deleted || member.is_bot) continue;
        const nameMatch = member.name?.toLowerCase() === target;
        const displayMatch = member.profile?.display_name?.toLowerCase() === target;
        const realMatch = member.profile?.real_name?.toLowerCase() === target;
        if (nameMatch || displayMatch || realMatch) {
          if (!member.id) continue;
          return member.id;
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
        `Cannot look up by username: missing "users:read" scope.\n` +
          `Fix: Slack app → OAuth & Permissions → add "users:read" → Reinstall.\n` +
          `Or pass User ID directly (e.g. "U0B4FAHG4F8").`
      );
    }
    throw err;
  }

  throw new Error(
    `No Slack user found with username "@${trimmed}". ` +
      `Try User ID (U…) or email instead.`
  );
}

/**
 * Send a direct message (DM) to a Slack user by User ID or email.
 * Requires im:write scope.
 */
export async function sendDirectMessage(
  options: SendDirectMessageOptions
): Promise<SendDirectMessageResult> {
  const userId = await resolveUserId(options.user);

  // Open (or reuse) the DM channel with this user
  const openResult = await getSlackClient().conversations.open({ users: userId });
  const dmChannelId = openResult.channel?.id;
  if (!dmChannelId) throw new Error(`Could not open DM channel with user "${userId}".`);

  const result = await getSlackClient().chat.postMessage({
    channel: dmChannelId,
    text: options.text,
  });

  if (!result.ok || !result.ts) {
    throw new Error(result.error ?? "chat.postMessage failed for DM");
  }

  return { userId, dmChannelId, ts: result.ts };
}

export interface SendSlackMessageOptions {
  /** Channel ID (C…), or channel name (e.g. general, my-team) */
  channel?: string;
  text: string;
  threadTs?: string;
  /** Try to join the channel before posting (default true) */
  autoJoin?: boolean;
}

export interface SendSlackMessageResult {
  channelId: string;
  ts: string;
  channelName?: string;
}

/**
 * Post a message from this project to a Slack channel.
 */
export async function sendSlackMessage(
  options: SendSlackMessageOptions
): Promise<SendSlackMessageResult> {
  const channelRef = options.channel?.trim() || notifyConfig.defaultChannel;
  if (!channelRef) {
    throw new Error("No channel: set SLACK_NOTIFY_CHANNEL or pass channel in options.");
  }

  const { id: channelId, name: channelName } = await resolveChannelId(channelRef);
  const autoJoin = options.autoJoin !== false;

  if (autoJoin) {
    await ensureBotInChannel(channelId);
  }

  let result = await getSlackClient().chat.postMessage({
    channel: channelId,
    text: options.text,
    ...(options.threadTs ? { thread_ts: options.threadTs } : {}),
  });

  if (!result.ok && result.error === "not_in_channel" && !autoJoin) {
    await ensureBotInChannel(channelId);
    result = await getSlackClient().chat.postMessage({
      channel: channelId,
      text: options.text,
      ...(options.threadTs ? { thread_ts: options.threadTs } : {}),
    });
  }

  if (!result.ok || !result.ts) {
    throw new Error(result.error ?? "chat.postMessage failed");
  }

  return {
    channelId,
    ts: result.ts,
    channelName,
  };
}
