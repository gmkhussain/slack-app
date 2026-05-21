import { getSlackClient, resolveChannelId } from "./client.js";

function slackErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("data" in error)) return undefined;
  const data = (error as { data?: { error?: string } }).data;
  return data?.error;
}

/**
 * Ensure the bot is a member of the channel before posting.
 * Public: conversations.join. Private: conversations.invite (bot user).
 */
export async function ensureBotInChannel(channelId: string): Promise<void> {
  const slack = getSlackClient();
  const auth = await slack.auth.test();
  const botUserId = auth.user_id;
  if (!botUserId) throw new Error("Could not resolve bot user id.");

  try {
    await slack.conversations.join({ channel: channelId });
    return;
  } catch (joinError) {
    if (slackErrorCode(joinError) === "already_in_channel") return;

    try {
      await slack.conversations.invite({
        channel: channelId,
        users: botUserId,
      });
    } catch (inviteError) {
      if (slackErrorCode(inviteError) === "already_in_channel") return;
      throw inviteError;
    }
  }
}

export async function joinBotToChannelByName(
  channel: string
): Promise<{ channelId: string; channelName?: string }> {
  const { id, name } = await resolveChannelId(channel);
  await ensureBotInChannel(id);
  return { channelId: id, channelName: name };
}
