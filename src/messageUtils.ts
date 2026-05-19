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
