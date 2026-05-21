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
 * Resolve a Slack user ID from an email address.
 * Requires users:read.email scope.
 */
async function resolveUserId(userRef: string): Promise<string> {
  const trimmed = userRef.trim();
  if (/^U[A-Z0-9]+$/i.test(trimmed)) return trimmed.toUpperCase();

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
    if (code === "users_not_found") {
      throw new Error(`No Slack user found with email "${trimmed}".`);
    }
    if (code === "missing_scope") {
      throw new Error(
        `Cannot look up user by email: missing "users:read.email" scope.\n` +
          `Fix: Slack app → OAuth & Permissions → add "users:read.email" → Reinstall.\n` +
          `Or pass the User ID directly (e.g. "U0B4FAHG4F8").`
      );
    }
    throw err;
  }
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
