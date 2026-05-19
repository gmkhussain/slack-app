/**
 * Remove Slack bot/user mentions from message text.
 * Example: "<@U123> hello, tell 2 + 2?" -> "hello, tell 2 + 2?"
 */
export function stripMentions(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/gi, "").replace(/\s+/g, " ").trim();
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
