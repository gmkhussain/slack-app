/**
 * Remove Slack bot/user mentions from message text.
 * Example: "<@U123> hello, tell 2 + 2?" -> "hello, tell 2 + 2?"
 */
export function stripMentions(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/gi, "").replace(/\s+/g, " ").trim();
}

/** Remove only the bot mention so other @users in the message are kept (e.g. invite user). */
export function stripBotMention(text: string, botUserId: string): string {
  if (!botUserId) return stripMentions(text);
  const pattern = new RegExp(`<@${botUserId}>`, "gi");
  return text.replace(pattern, "").replace(/\s+/g, " ").trim();
}

/** Unwrap Slack autolinks: <mailto:a@b.com|a@b.com>, <#C123|name>, <@U123|name> */
export function normalizeSlackMessage(text: string): string {
  return text
    .replace(/<mailto:([^|>]+)(?:\|[^>]+)?>/gi, "$1")
    .replace(/<#([A-Z0-9]+)\|([^>]+)>/gi, "#$2")
    .replace(/<@([A-Z0-9]+)\|([^>]+)>/gi, "<@$1>")
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractEmailFromText(text: string): string | null {
  const mailto = text.match(/<mailto:([^|>]+)/i);
  if (mailto?.[1]) return mailto[1].trim();

  const plain = text.match(
    /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i
  );
  return plain?.[1]?.toLowerCase() ?? null;
}

export function isWorkspaceInviteCommand(text: string): boolean {
  const n = normalizeSlackMessage(text);
  return (
    /\binvite\b/i.test(n) &&
    (/\bto\s+workspace\b/i.test(n) || /^workspace\s+invite\b/i.test(n))
  );
}

export function isEmptyQuestion(text: string): boolean {
  return text.length === 0;
}

export interface CreateChannelRequest {
  name: string;
  isPrivate: boolean;
}

/**
 * Slack channel names: lowercase, no spaces, max 80 chars.
 */
export function sanitizeSlackChannelName(raw: string): string {
  const trimmed = raw.trim().replace(/^['"]|['"]$/g, "");
  const slug = trimmed
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");

  return slug.slice(0, 80);
}

/**
 * Matches: "create channel with name of 'abc'", "create private channel named abc", etc.
 */
export function parseCreateChannelRequest(
  text: string
): CreateChannelRequest | null {
  const normalized = text.trim();
  const match = normalized.match(
    /^create\s+(?:a\s+)?(private\s+)?channel(?:\s+with\s+name\s+of|\s+named|\s+called)?\s+(.+)$/i
  );
  if (!match) return null;

  const isPrivate = Boolean(match[1]?.trim());
  const name = sanitizeSlackChannelName(match[2] ?? "");
  if (!name) return null;

  return { name, isPrivate };
}

export interface DeleteChannelRequest {
  name: string;
}

/**
 * Matches: "delete channel with name of 'abc'", "remove channel named abc", etc.
 */
export function parseDeleteChannelRequest(
  text: string
): DeleteChannelRequest | null {
  const normalized = text.trim();
  const match = normalized.match(
    /^(?:delete|remove|archive)\s+(?:a\s+)?channel(?:\s+with\s+name\s+of|\s+named|\s+called)?\s+(.+)$/i
  );
  if (!match) return null;

  const name = sanitizeSlackChannelName(match[1] ?? "");
  if (!name) return null;

  return { name };
}

export interface RenameChannelRequest {
  fromName: string;
  toName: string;
}

/**
 * Matches: "rename channel xyz to abc", "rename channel from xyz to abc", etc.
 */
export function parseRenameChannelRequest(
  text: string
): RenameChannelRequest | null {
  const normalized = text.trim();
  const match = normalized.match(
    /^rename\s+(?:a\s+)?channel\s+(?:(?:from|with\s+name\s+of)\s+)?(.+?)\s+(?:to|as)\s+(.+)$/i
  );
  if (!match) return null;

  const fromName = sanitizeSlackChannelName(match[1] ?? "");
  const toName = sanitizeSlackChannelName(match[2] ?? "");
  if (!fromName || !toName) return null;

  return { fromName, toName };
}

export interface JoinBotChannelRequest {
  channelName: string;
}

/**
 * Matches: "join channel general", "add bot to channel my-team", "invite bot to channel xyz"
 */
export function parseJoinBotChannelRequest(
  text: string
): JoinBotChannelRequest | null {
  const normalized = text.trim();
  const patterns = [
    /^join\s+(?:bot\s+)?(?:channel\s+)?(.+)$/i,
    /^add\s+bot\s+to\s+channel\s+(.+)$/i,
    /^invite\s+bot\s+to\s+channel\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const channelName = sanitizeSlackChannelName(match[1] ?? "");
    if (!channelName) return null;
    return { channelName };
  }

  return null;
}

export interface InviteUserRequest {
  userRef: string;
  channelName: string;
}

/**
 * Matches: "invite user @jane to channel xyz", "invite user jane@co.com to xyz", etc.
 */
export function parseInviteUserRequest(text: string): InviteUserRequest | null {
  const normalized = text.trim();
  if (/\bto\s+workspace\b/i.test(normalized)) return null;

  const match = normalized.match(
    /^invite\s+user\s+(.+?)\s+to\s+channel\s+(.+)$/i
  );
  if (!match) return null;

  const userRef = (match[1] ?? "").trim();
  const channelName = sanitizeSlackChannelName(match[2] ?? "");
  if (!userRef || !channelName) return null;

  return { userRef, channelName };
}

export interface InviteToWorkspaceRequest {
  email: string;
  channelName?: string;
}

/**
 * Matches workspace invites (new people by email), not channel invites.
 */
export function parseInviteToWorkspaceRequest(
  text: string
): InviteToWorkspaceRequest | null {
  const normalized = normalizeSlackMessage(text);
  if (!isWorkspaceInviteCommand(normalized)) return null;

  const email = extractEmailFromText(normalized);
  if (!email) return null;

  const channelMatch = normalized.match(
    /\bchannel\s+([a-z0-9][a-z0-9-_]*)/i
  );
  const channelName = channelMatch
    ? sanitizeSlackChannelName(channelMatch[1])
    : undefined;

  return { email, channelName: channelName || undefined };
}
