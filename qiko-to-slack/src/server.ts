import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { notifyConfig } from "./config.js";
import { readJsonBody } from "./readJsonBody.js";
import { joinBotToChannelByName } from "./joinChannel.js";
import { sendSlackMessage } from "./slackNotifier.js";

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

  const channel = body.channel?.trim() || notifyConfig.defaultChannel;
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

const server = createServer(async (req, res) => {
  const url = req.url?.split("?")[0] ?? "/";

  if (req.method === "GET" && (url === "/" || url === "/health")) {
    json(res, 200, { ok: true, service: "qiko-to-slack" });
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

  json(res, 404, { ok: false, error: "not_found" });
});

server.listen(notifyConfig.port, () => {
  console.log(`qiko-to-slack notify API on http://localhost:${notifyConfig.port}`);
  console.log(`  POST /notify  { "text": "Hello from Qiko", "channel": "general" }`);
  console.log(`  POST /join    { "channel": "general" }  (add bot to channel)`);
  console.log(`  Default channel: ${notifyConfig.defaultChannel}`);
  if (notifyConfig.notifySecret) {
    console.log("  Auth: header X-Notify-Secret or body.secret");
  }
});
