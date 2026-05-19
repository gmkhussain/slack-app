import type { WebClient } from "@slack/web-api";
import { parseCreateChannelRequest } from "./messageUtils.js";

function slackErrorMessage(error: unknown): string {
  const data =
    error && typeof error === "object" && "data" in error
      ? (error as { data?: { error?: string } }).data
      : undefined;
  const code = data?.error;

  switch (code) {
    case "name_taken":
      return "A channel with that name already exists.";
    case "invalid_name":
      return "That channel name is not allowed (use lowercase letters, numbers, hyphens).";
    case "missing_scope":
      return "Bot is missing scope: add `channels:manage` (public) or `groups:write` (private), then reinstall the app.";
    case "restricted_action":
      return "Your workspace does not allow this bot to create channels.";
    default:
      return error instanceof Error ? error.message : "Could not create channel.";
  }
}

export async function tryCreateChannelFromMessage(params: {
  client: WebClient;
  text: string;
  replyChannel: string;
  threadTs: string;
  requesterUserId: string | undefined;
}): Promise<boolean> {
  const parsed = parseCreateChannelRequest(params.text);
  if (!parsed) return false;

  const { name, isPrivate } = parsed;

  try {
    const result = await params.client.conversations.create({
      name,
      is_private: isPrivate,
    });

    const created = result.channel;
    const channelId = created?.id;
    const channelName = created?.name ?? name;

    if (params.requesterUserId && channelId) {
      try {
        await params.client.conversations.invite({
          channel: channelId,
          users: params.requesterUserId,
        });
      } catch {
        // Non-fatal: bot may already include creator depending on workspace
      }
    }

    const kind = isPrivate ? "private channel" : "channel";
    const link = channelId ? `<#${channelId}>` : `#${channelName}`;
    await params.client.chat.postMessage({
      channel: params.replyChannel,
      thread_ts: params.threadTs,
      text: `Created ${kind} ${link} (\`${channelName}\`). You were invited to join.`,
    });
  } catch (error) {
    console.error("[slack] create channel error:", error);
    await params.client.chat.postMessage({
      channel: params.replyChannel,
      thread_ts: params.threadTs,
      text: `Could not create channel \`${name}\`: ${slackErrorMessage(error)}`,
    });
  }

  return true;
}
