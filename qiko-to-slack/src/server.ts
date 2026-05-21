import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { notifyConfig } from "./config.js";
import { readJsonBody } from "./readJsonBody.js";
import { joinBotToChannelByName } from "./joinChannel.js";
import { sendSlackMessage, sendDirectMessage } from "./slackNotifier.js";
import { setRuntimeConfig, getRuntimeConfigSafe, getRuntimeChannel } from "./runtimeConfig.js";

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function unauthorized(res: ServerResponse): void {
  json(res, 401, { ok: false, error: "unauthorized" });
}

function checkSecret(req: IncomingMessage, body: { secret?: string }): boolean {
  const expected = notifyConfig.notifySecret;
  if (!expected) return true;
  const header = req.headers["x-notify-secret"];
  const fromHeader = typeof header === "string" ? header : header?.[0];
  return fromHeader === expected || body.secret === expected;
}

async function handleJoin(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  let body: { channel?: string; secret?: string };
  try {
    body = (await readJsonBody(req)) as typeof body;
  } catch {
    json(res, 400, { ok: false, error: "invalid_json" });
    return;
  }

  if (!checkSecret(req, body)) {
    unauthorized(res);
    return;
  }

  const channel = body.channel?.trim() || getRuntimeChannel();
  try {
    const result = await joinBotToChannelByName(channel);
    json(res, 200, {
      ok: true,
      channel_id: result.channelId,
      channel_name: result.channelName,
      message: "Bot joined channel",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "join_failed";
    json(res, 500, { ok: false, error: message });
  }
}

async function handleNotify(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  let body: { text?: string; channel?: string; thread_ts?: string; secret?: string };
  try {
    body = (await readJsonBody(req)) as typeof body;
  } catch {
    json(res, 400, { ok: false, error: "invalid_json" });
    return;
  }

  if (!checkSecret(req, body)) {
    unauthorized(res);
    return;
  }

  const text = body.text?.trim();
  if (!text) {
    json(res, 400, { ok: false, error: "text_required" });
    return;
  }

  try {
    const result = await sendSlackMessage({
      channel: body.channel,
      text,
      threadTs: body.thread_ts,
    });
    json(res, 200, {
      ok: true,
      channel_id: result.channelId,
      channel_name: result.channelName,
      ts: result.ts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "send_failed";
    console.error("[qiko-to-slack] notify error:", message);
    json(res, 500, { ok: false, error: message });
  }
}

async function handleDm(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  let body: { user?: string; text?: string; secret?: string };
  try {
    body = (await readJsonBody(req)) as typeof body;
  } catch {
    json(res, 400, { ok: false, error: "invalid_json" });
    return;
  }

  if (!checkSecret(req, body)) {
    unauthorized(res);
    return;
  }

  const user = body.user?.trim();
  const text = body.text?.trim();
  if (!user) {
    json(res, 400, { ok: false, error: "user_required: pass Slack User ID (U…) or email" });
    return;
  }
  if (!text) {
    json(res, 400, { ok: false, error: "text_required" });
    return;
  }

  try {
    const result = await sendDirectMessage({ user, text });
    json(res, 200, {
      ok: true,
      user_id: result.userId,
      dm_channel_id: result.dmChannelId,
      ts: result.ts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "dm_failed";
    console.error("[qiko-to-slack] dm error:", message);
    json(res, 500, { ok: false, error: message });
  }
}

async function handleGetConfig(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  json(res, 200, { ok: true, config: getRuntimeConfigSafe() });
}

async function handleSetConfig(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  let body: { bot_token?: string; channel?: string; secret?: string };
  try {
    body = (await readJsonBody(req)) as typeof body;
  } catch {
    json(res, 400, { ok: false, error: "invalid_json" });
    return;
  }

  if (!checkSecret(req, body)) {
    unauthorized(res);
    return;
  }

  if (!body.bot_token && !body.channel) {
    json(res, 400, { ok: false, error: "Provide at least one of: bot_token, channel" });
    return;
  }

  try {
    setRuntimeConfig({ botToken: body.bot_token, channel: body.channel });
    json(res, 200, { ok: true, config: getRuntimeConfigSafe() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "config_error";
    json(res, 400, { ok: false, error: message });
  }
}

const server = createServer(async (req, res) => {
  const url = req.url?.split("?")[0] ?? "/";

  if (req.method === "GET" && (url === "/" || url === "/health")) {
    json(res, 200, { ok: true, service: "qiko-to-slack" });
    return;
  }

  if (req.method === "GET" && url === "/config") {
    await handleGetConfig(req, res);
    return;
  }

  if (req.method === "POST" && url === "/config") {
    await handleSetConfig(req, res);
    return;
  }

  if (req.method === "POST" && url === "/notify") {
    await handleNotify(req, res);
    return;
  }

  if (req.method === "POST" && url === "/join") {
    await handleJoin(req, res);
    return;
  }

  if (req.method === "POST" && url === "/dm") {
    await handleDm(req, res);
    return;
  }

  json(res, 404, { ok: false, error: "not_found" });
});

server.listen(notifyConfig.port, () => {
  console.log(`qiko-to-slack notify API on http://localhost:${notifyConfig.port}`);
  console.log(`  GET  /config  — view current bot_token & channel`);
  console.log(`  POST /config  { "bot_token": "xoxb-...", "channel": "general" }  — save config`);
  console.log(`  POST /notify  { "text": "Hello from Qiko", "channel": "general" }`);
  console.log(`  POST /dm      { "user": "U0B4FAHG4F8" or "user@email.com", "text": "Hello!" }`);
  console.log(`  POST /join    { "channel": "general" }  (add bot to channel)`);
  const cfg = getRuntimeConfigSafe();
  console.log(`  Active channel: ${cfg.channel}  [source: ${cfg.source}]`);
  if (notifyConfig.notifySecret) {
    console.log("  Auth: header X-Notify-Secret or body.secret");
  }
});
