import { getSlackClient, resolveChannelId } from "./client.js";
import { notifyConfig } from "./config.js";
import { ensureBotInChannel } from "./joinChannel.js";

export { resolveChannelId } from "./client.js";

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
