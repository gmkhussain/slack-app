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
    const joinErrCode = slackErrorCode(joinError);
    if (joinErrCode === "already_in_channel") return;

    // Private channel — conversations.join not allowed; try invite
    if (joinErrCode === "method_not_supported_for_channel_type" || joinErrCode === "is_private") {
      try {
        await slack.conversations.invite({
          channel: channelId,
          users: botUserId,
        });
        return;
      } catch (inviteError) {
        const inviteErrCode = slackErrorCode(inviteError);
        if (inviteErrCode === "already_in_channel" || inviteErrCode === "cant_invite_self") return;
        throw inviteError;
      }
    }

    // For any other join error, surface it clearly
    throw new Error(
      `Bot could not join channel ${channelId} (${joinErrCode ?? String(joinError)}). ` +
        `For private channels, manually run: /invite @LinkstarBot inside the channel.`
    );
  }
}

export async function joinBotToChannelByName(
  channel: string
): Promise<{ channelId: string; channelName?: string }> {
  const { id, name } = await resolveChannelId(channel);
  await ensureBotInChannel(id);
  return { channelId: id, channelName: name };
}
