import type { WebClient } from "@slack/web-api";
import {
  extractEmailFromText,
  normalizeSlackMessage,
  parseCreateChannelRequest,
  parseDeleteChannelRequest,
  parseInviteUserRequest,
  parseJoinBotChannelRequest,
  parseRenameChannelRequest,
} from "./messageUtils.js";

function slackErrorData(error: unknown): {
  error?: string;
  needed?: string;
  provided?: string;
} {
  if (!error || typeof error !== "object" || !("data" in error)) return {};
  const data = (error as { data?: Record<string, unknown> }).data;
  if (!data || typeof data !== "object") return {};
  return {
    error: typeof data.error === "string" ? data.error : undefined,
    needed: typeof data.needed === "string" ? data.needed : undefined,
    provided: typeof data.provided === "string" ? data.provided : undefined,
  };
}

function slackApiErrorMessage(
  error: unknown,
  context: "create" | "delete" | "find" | "rename" | "invite" | "join"
): string {
  const { error: code, needed, provided } = slackErrorData(error);

  switch (code) {
    case "name_taken":
      return "A channel with that name already exists.";
    case "invalid_name":
      return "That channel name is not allowed (use lowercase letters, numbers, hyphens).";
    case "channel_not_found":
      return context === "find"
        ? "No active channel with that name was found."
        : "Channel not found.";
    case "not_in_channel":
      return context === "join"
        ? "Could not add the bot to that channel. For private channels, a member must run `/invite @LinkstarBot` in Slack."
        : "The bot must be a member of that channel. Say `@LinkstarBot join channel NAME` or `/invite @LinkstarBot` in Slack.";
    case "method_not_supported_for_channel_type":
      return "Cannot auto-join this channel type. In Slack, run `/invite @LinkstarBot` inside that channel.";
    case "missing_scope": {
      const need =
        needed ??
        (context === "find"
          ? "channels:read"
          : context === "join"
            ? "channels:join"
            : context === "delete" ||
                context === "rename" ||
                context === "invite"
              ? "channels:manage"
              : "channels:manage");
      let msg = `Missing OAuth scope: \`${need}\`. Add it at api.slack.com → your app → OAuth & Permissions → Bot Token Scopes, then Reinstall to workspace and update SLACK_BOT_TOKEN in .env.`;
      if (provided) {
        msg += ` (token currently has: ${provided})`;
      }
      msg +=
        " For channel commands on public channels add: channels:read, channels:manage.";
      return msg;
    }
    case "restricted_action":
      return "Your workspace does not allow this bot to manage channels.";
    case "cant_archive_general":
      return "The #general channel cannot be archived.";
    case "already_archived":
      return "That channel is already archived.";
    case "already_in_channel":
      return "That user is already in the channel.";
    case "cant_invite":
      return "That user cannot be invited to this channel.";
    case "users_not_found":
      return "User not found or not in this workspace.";
    case "users_list_not_yet_supported":
    case "user_not_found":
      return "User not found. Use an @mention, workspace email, or user ID (U…).";
    default:
      if (context === "find") {
        return error instanceof Error ? error.message : "Could not find channel.";
      }
      if (context === "delete") {
        return error instanceof Error ? error.message : "Could not archive channel.";
      }
      if (context === "rename") {
        return error instanceof Error ? error.message : "Could not rename channel.";
      }
      if (context === "invite") {
        return error instanceof Error ? error.message : "Could not invite user.";
      }
      if (context === "join") {
        return error instanceof Error ? error.message : "Could not add bot to channel.";
      }
      return error instanceof Error ? error.message : "Could not create channel.";
  }
}

export async function findChannelByName(
  client: WebClient,
  name: string
): Promise<{ id: string; name: string; isPrivate: boolean } | null> {
  const target = name.toLowerCase();
  let cursor: string | undefined;

  do {
    const result = await client.conversations.list({
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: 200,
      cursor,
    });

    for (const ch of result.channels ?? []) {
      if (ch.id && ch.name?.toLowerCase() === target) {
        return {
          id: ch.id,
          name: ch.name,
          isPrivate: ch.is_private ?? false,
        };
      }
    }

    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor);

  return null;
}

/** Add @LinkstarBot to a channel (public: join; private: invite bot user). */
export async function joinBotToChannel(
  client: WebClient,
  channelName: string
): Promise<{ id: string; name: string; isPrivate: boolean }> {
  const found = await findChannelByName(client, channelName);
  if (!found) {
    throw new Error(`No active channel named "${channelName}" was found.`);
  }

  const auth = await client.auth.test();
  const botUserId = auth.user_id;
  if (!botUserId) {
    throw new Error("Could not resolve bot user id (auth.test).");
  }

  try {
    await client.conversations.join({ channel: found.id });
    return found;
  } catch (joinError) {
    const joinCode = slackErrorData(joinError).error;
    if (joinCode === "already_in_channel") return found;

    try {
      await client.conversations.invite({
        channel: found.id,
        users: botUserId,
      });
      return found;
    } catch (inviteError) {
      const inviteCode = slackErrorData(inviteError).error;
      if (inviteCode === "already_in_channel") return found;
      throw inviteError;
    }
  }
}

export async function tryJoinBotToChannelFromMessage(params: {
  client: WebClient;
  text: string;
  replyChannel: string;
  threadTs: string;
}): Promise<boolean> {
  const parsed = parseJoinBotChannelRequest(params.text);
  if (!parsed) return false;

  const { channelName } = parsed;

  try {
    const joined = await joinBotToChannel(params.client, channelName);
    const link = `<#${joined.id}>`;
    await params.client.chat.postMessage({
      channel: params.replyChannel,
      thread_ts: params.threadTs,
      text: `Joined ${link} (\`#${joined.name}\`). You can post messages there now.`,
    });
  } catch (error) {
    console.error("[slack] join channel error:", error);
    await params.client.chat.postMessage({
      channel: params.replyChannel,
      thread_ts: params.threadTs,
      text: `Could not join channel \`${channelName}\`: ${slackApiErrorMessage(error, "join")}`,
    });
  }

  return true;
}

async function resolveSlackUserId(
  client: WebClient,
  userRef: string
): Promise<{ id: string; label: string } | null> {
  const raw = normalizeSlackMessage(userRef.trim());
  const mention = raw.match(/^<@(U[A-Z0-9]+)>$/i);
  if (mention?.[1]) {
    return { id: mention[1].toUpperCase(), label: `<@${mention[1]}>` };
  }

  const unquoted = raw.replace(/^['"]|['"]$/g, "").trim();
  if (/^U[A-Z0-9]{8,}$/i.test(unquoted)) {
    return { id: unquoted.toUpperCase(), label: unquoted };
  }

  const email = extractEmailFromText(unquoted) ?? extractEmailFromText(raw);
  if (email) {
    try {
      const result = await client.users.lookupByEmail({ email });
      const id = result.user?.id;
      if (id) {
        const label = result.user?.real_name || result.user?.name || email;
        return { id, label };
      }
    } catch {
      return null;
    }
  }

  return null;
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
      text: `Could not create channel \`${name}\`: ${slackApiErrorMessage(error, "create")}`,
    });
  }

  return true;
}

export async function tryDeleteChannelFromMessage(params: {
  client: WebClient;
  text: string;
  replyChannel: string;
  threadTs: string;
}): Promise<boolean> {
  const parsed = parseDeleteChannelRequest(params.text);
  if (!parsed) return false;

  const { name } = parsed;

  try {
    let found: { id: string; name: string; isPrivate: boolean } | null;
    try {
      found = await findChannelByName(params.client, name);
    } catch (error) {
      console.error("[slack] find channel error:", error);
      await params.client.chat.postMessage({
        channel: params.replyChannel,
        thread_ts: params.threadTs,
        text: `Could not look up channel \`${name}\`: ${slackApiErrorMessage(error, "find")}`,
      });
      return true;
    }

    if (!found) {
      await params.client.chat.postMessage({
        channel: params.replyChannel,
        thread_ts: params.threadTs,
        text: `No active channel named \`${name}\` was found.`,
      });
      return true;
    }

    try {
      await params.client.conversations.archive({ channel: found.id });
    } catch (error) {
      console.error("[slack] archive channel error:", error);
      await params.client.chat.postMessage({
        channel: params.replyChannel,
        thread_ts: params.threadTs,
        text: `Found #${found.name} but could not archive it: ${slackApiErrorMessage(error, "delete")}`,
      });
      return true;
    }

    const kind = found.isPrivate ? "private channel" : "channel";
    await params.client.chat.postMessage({
      channel: params.replyChannel,
      thread_ts: params.threadTs,
      text: `Archived ${kind} \`#${found.name}\` (Slack “delete” — channel is archived, not permanently removed).`,
    });
  } catch (error) {
    console.error("[slack] delete channel error:", error);
    await params.client.chat.postMessage({
      channel: params.replyChannel,
      thread_ts: params.threadTs,
      text: `Could not delete channel \`${name}\`: ${slackApiErrorMessage(error, "delete")}`,
    });
  }

  return true;
}

export async function tryInviteUserFromMessage(params: {
  client: WebClient;
  text: string;
  replyChannel: string;
  threadTs: string;
}): Promise<boolean> {
  const parsed = parseInviteUserRequest(params.text);
  if (!parsed) return false;

  const { userRef, channelName } = parsed;

  try {
    const slackUser = await resolveSlackUserId(params.client, userRef);
    if (!slackUser) {
      await params.client.chat.postMessage({
        channel: params.replyChannel,
        thread_ts: params.threadTs,
        text:
          "Could not find that user. Mention them in Slack (`@name`), use their workspace email, or a user ID (`U…`).",
      });
      return true;
    }

    let found: { id: string; name: string; isPrivate: boolean } | null;
    try {
      found = await findChannelByName(params.client, channelName);
    } catch (error) {
      console.error("[slack] find channel error:", error);
      await params.client.chat.postMessage({
        channel: params.replyChannel,
        thread_ts: params.threadTs,
        text: `Could not look up channel \`${channelName}\`: ${slackApiErrorMessage(error, "find")}`,
      });
      return true;
    }

    if (!found) {
      await params.client.chat.postMessage({
        channel: params.replyChannel,
        thread_ts: params.threadTs,
        text: `No active channel named \`${channelName}\` was found.`,
      });
      return true;
    }

    try {
      await params.client.conversations.invite({
        channel: found.id,
        users: slackUser.id,
      });

      const link = `<#${found.id}>`;
      await params.client.chat.postMessage({
        channel: params.replyChannel,
        thread_ts: params.threadTs,
        text: `Invited ${slackUser.label} to ${link} (\`#${found.name}\`).`,
      });
    } catch (error) {
      console.error("[slack] invite user error:", error);
      await params.client.chat.postMessage({
        channel: params.replyChannel,
        thread_ts: params.threadTs,
        text: `Could not invite ${slackUser.label} to #${found.name}: ${slackApiErrorMessage(error, "invite")}`,
      });
    }
  } catch (error) {
    console.error("[slack] invite user error:", error);
    await params.client.chat.postMessage({
      channel: params.replyChannel,
      thread_ts: params.threadTs,
      text: `Could not invite user to \`${channelName}\`: ${slackApiErrorMessage(error, "invite")}`,
    });
  }

  return true;
}

export async function tryRenameChannelFromMessage(params: {
  client: WebClient;
  text: string;
  replyChannel: string;
  threadTs: string;
}): Promise<boolean> {
  const parsed = parseRenameChannelRequest(params.text);
  if (!parsed) return false;

  const { fromName, toName } = parsed;

  if (fromName === toName) {
    await params.client.chat.postMessage({
      channel: params.replyChannel,
      thread_ts: params.threadTs,
      text: `Channel is already named \`${toName}\`.`,
    });
    return true;
  }

  try {
    let found: { id: string; name: string; isPrivate: boolean } | null;
    try {
      found = await findChannelByName(params.client, fromName);
    } catch (error) {
      console.error("[slack] find channel error:", error);
      await params.client.chat.postMessage({
        channel: params.replyChannel,
        thread_ts: params.threadTs,
        text: `Could not look up channel \`${fromName}\`: ${slackApiErrorMessage(error, "find")}`,
      });
      return true;
    }

    if (!found) {
      await params.client.chat.postMessage({
        channel: params.replyChannel,
        thread_ts: params.threadTs,
        text: `No active channel named \`${fromName}\` was found.`,
      });
      return true;
    }

    try {
      const result = await params.client.conversations.rename({
        channel: found.id,
        name: toName,
      });
      const updatedName = result.channel?.name ?? toName;
      const link = found.id ? `<#${found.id}>` : `#${updatedName}`;
      const kind = found.isPrivate ? "private channel" : "channel";
      await params.client.chat.postMessage({
        channel: params.replyChannel,
        thread_ts: params.threadTs,
        text: `Renamed ${kind} \`#${found.name}\` → ${link} (\`#${updatedName}\`).`,
      });
    } catch (error) {
      console.error("[slack] rename channel error:", error);
      await params.client.chat.postMessage({
        channel: params.replyChannel,
        thread_ts: params.threadTs,
        text: `Found #${found.name} but could not rename to \`${toName}\`: ${slackApiErrorMessage(error, "rename")}`,
      });
    }
  } catch (error) {
    console.error("[slack] rename channel error:", error);
    await params.client.chat.postMessage({
      channel: params.replyChannel,
      thread_ts: params.threadTs,
      text: `Could not rename channel \`${fromName}\` to \`${toName}\`: ${slackApiErrorMessage(error, "rename")}`,
    });
  }

  return true;
}
