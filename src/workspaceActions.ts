import { WebClient } from "@slack/web-api";
import { findChannelByName } from "./channelActions.js";
import { config } from "./config.js";
import { parseInviteToWorkspaceRequest } from "./messageUtils.js";

let adminInviteClient: WebClient | null = null;

function getAdminInviteClient(): WebClient | null {
  const token = config.slack.adminUserToken;
  if (!token) return null;
  if (!adminInviteClient) {
    adminInviteClient = new WebClient(token);
  }
  return adminInviteClient;
}

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

function workspaceInviteErrorMessage(error: unknown): string {
  const { error: code, needed, provided } = slackErrorData(error);

  switch (code) {
    case "invalid_email":
      return "That email address is not valid.";
    case "already_invited":
    case "already_in_team":
      return "That person was already invited or is already in the workspace.";
    case "feature_not_enabled":
    case "not_allowed":
    case "paid_teams_only":
      return (
        "Workspace invite via API is not enabled on this plan. " +
        "Slack requires Enterprise Grid / Business+ and admin.users:write installed by a workspace/org admin."
      );
    case "missing_scope": {
      const need = needed ?? "admin.users:write";
      let msg = `Missing OAuth scope: \`${need}\`. Add admin.users:write (Enterprise/org admin install), reinstall, update SLACK_BOT_TOKEN.`;
      if (provided) msg += ` (token has: ${provided})`;
      return msg;
    }
    case "restricted_action":
      return "Your workspace does not allow this app to invite new members.";
    case "not_allowed_token_type":
      return (
        "Workspace invite cannot use the bot token (xoxb-). " +
        "Add a User OAuth Token with admin.users:write as SLACK_ADMIN_USER_TOKEN in .env (starts with xoxp-), then restart."
      );
    default:
      return error instanceof Error
        ? error.message
        : "Could not send workspace invite.";
  }
}

export async function tryInviteToWorkspaceFromMessage(params: {
  client: WebClient;
  text: string;
  replyChannel: string;
  threadTs: string;
}): Promise<boolean> {
  const parsed = parseInviteToWorkspaceRequest(params.text);
  if (!parsed) return false;

  const { email, channelName } = parsed;
  console.log(
    `[slack] workspace invite: ${email}` +
      (channelName ? ` → #${channelName}` : " → #general")
  );

  const adminClient = getAdminInviteClient();
  if (!adminClient) {
    await params.client.chat.postMessage({
      channel: params.replyChannel,
      thread_ts: params.threadTs,
      text:
        "Workspace invite needs `SLACK_ADMIN_USER_TOKEN` in `.env` (User OAuth Token `xoxp-…` with scope `admin.users:write`). " +
        "Slack does not allow bot tokens (`xoxb-`) to call `admin.users.invite`. " +
        "Slack app → OAuth & Permissions → *User Token Scopes* → add `admin.users:write` → Reinstall → copy *User OAuth Token*.",
    });
    return true;
  }

  try {
    const auth = await adminClient.auth.test();
    const teamId = auth.team_id;
    if (!teamId) {
      await params.client.chat.postMessage({
        channel: params.replyChannel,
        thread_ts: params.threadTs,
        text: "Could not determine workspace ID (auth.test on admin user token failed).",
      });
      return true;
    }

    const lookupName = channelName ?? "general";
    let joinChannel: { id: string; name: string } | null = null;
    try {
      const ch = await findChannelByName(params.client, lookupName);
      joinChannel = ch ? { id: ch.id, name: ch.name } : null;
    } catch (error) {
      console.error("[slack] find channel for workspace invite:", error);
      await params.client.chat.postMessage({
        channel: params.replyChannel,
        thread_ts: params.threadTs,
        text: `Could not look up channel \`${lookupName}\` for the invite.`,
      });
      return true;
    }

    if (!joinChannel) {
      await params.client.chat.postMessage({
        channel: params.replyChannel,
        thread_ts: params.threadTs,
        text: `Channel \`${lookupName}\` not found. Specify one: \`invite people to workspace email@co.com channel my-team\`.`,
      });
      return true;
    }

    await adminClient.admin.users.invite({
      team_id: teamId,
      email,
      channel_ids: [joinChannel.id],
    });

    const channelNote = ` They will be added to #${joinChannel.name} when they accept.`;
    await params.client.chat.postMessage({
      channel: params.replyChannel,
      thread_ts: params.threadTs,
      text: `Workspace invite sent to \`${email}\`.${channelNote}`,
    });
  } catch (error) {
    console.error("[slack] workspace invite error:", error);
    await params.client.chat.postMessage({
      channel: params.replyChannel,
      thread_ts: params.threadTs,
      text: `Could not invite \`${email}\` to the workspace: ${workspaceInviteErrorMessage(error)}`,
    });
  }

  return true;
}
