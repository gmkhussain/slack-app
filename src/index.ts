import type { ServerResponse } from "node:http";
import type { IncomingMessage } from "node:http";
import { App, LogLevel } from "@slack/bolt";
import { config, isChannelAllowed, useSocketMode } from "./config.js";
import { askWorker } from "./qikoClient.js";
import { isEmptyQuestion, stripMentions } from "./messageUtils.js";
import { resolveListenPort } from "./port.js";
import {
  BOLT_EVENTS_PATH,
  createSlackEventsProxyRoute,
} from "./slackEventsProxy.js";

function healthHandler(message: string) {
  return (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(message);
  };
}

function buildHttpRoutes(listenPort: number) {
  return [
    {
      path: "/",
      method: ["GET"],
      handler: healthHandler(
        "Qiko Slack app OK. Slack POST /slack/events | health /health"
      ),
    },
    {
      path: "/health",
      method: ["GET"],
      handler: healthHandler("OK"),
    },
    {
      path: "/slack/events",
      method: ["GET"],
      handler: healthHandler(
        "Use Slack Retry (POST). Browser GET cannot verify the URL."
      ),
    },
    createSlackEventsProxyRoute(BOLT_EVENTS_PATH, listenPort),
  ];
}

const app = new App({
  token: config.slack.botToken,
  signingSecret: config.slack.signingSecret,
  ...(useSocketMode
    ? { appToken: config.slack.appToken, socketMode: true }
    : {
        socketMode: false,
        endpoints: BOLT_EVENTS_PATH,
        customRoutes: buildHttpRoutes(config.port),
        processBeforeResponse: false,
        signatureVerification: !config.slack.skipSignatureVerify,
      }),
  logLevel: LogLevel.INFO,
});

app.use(async ({ payload, next, logger }) => {
  const body = payload as { type?: string; event?: { type?: string; text?: string } };
  const eventType = body.event?.type ?? body.type ?? "unknown";
  logger.info(`[slack] incoming: ${eventType}`);
  await next();
});

async function resolveUserEmail(
  client: App["client"],
  userId: string | undefined
): Promise<string> {
  if (!userId) return config.qiko.defaultUserEmail;

  try {
    const result = await client.users.info({ user: userId });
    const email = result.user?.profile?.email?.trim();
    if (email) return email;
  } catch {
    // Fall through to default
  }

  return `slack-${userId}@slack.local`;
}

async function handleWorkerQuestion(params: {
  client: App["client"];
  channel: string;
  threadTs: string;
  userId: string | undefined;
  question: string;
  userName?: string;
}): Promise<void> {
  const { client, channel, threadTs, userId, question, userName } = params;

  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: "Thinking…",
  });

  try {
    const email = await resolveUserEmail(client, userId);
    const { reply } = await askWorker({
      message: question,
      email,
      user_name: userName,
    });

    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: reply,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Something went wrong.";
    console.error("[slack] worker error:", message);
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: `Sorry, I could not get an answer from the worker: ${message}`,
    });
  }
}

async function onMentionMessage(params: {
  client: App["client"];
  channel: string;
  threadTs: string;
  userId: string | undefined;
  text: string;
  say?: (msg: { thread_ts: string; text: string }) => Promise<unknown>;
}): Promise<void> {
  const { client, channel, threadTs, userId, text, say } = params;
  if (!isChannelAllowed(channel)) return;

  const question = stripMentions(text);
  console.log(`[slack] mention in ${channel}: "${question}"`);

  if (isEmptyQuestion(question)) {
    const greeting = "Hi! Ask me anything — for example: `tell 2 + 2?`";
    if (say) {
      await say({ thread_ts: threadTs, text: greeting });
    } else {
      await client.chat.postMessage({ channel, thread_ts: threadTs, text: greeting });
    }
    return;
  }

  await handleWorkerQuestion({ client, channel, threadTs, userId, question });
}

function registerHandlers(botUserId: string): void {
  /** Requires Event Subscriptions → app_mention */
  app.event("app_mention", async ({ event, client, say }) => {
    console.log("[slack] app_mention event received");
    await onMentionMessage({
      client,
      channel: event.channel,
      threadTs: event.thread_ts ?? event.ts,
      userId: event.user,
      text: event.text ?? "",
      say,
    });
  });

  /**
   * Backup: channel/group messages that @mention the bot.
   * Slack app must also subscribe to message.channels / message.groups
   * and add scopes channels:history, groups:history.
   */
  app.message(async ({ message, client }) => {
    if (message.subtype !== undefined) return;
    if (!("text" in message) || !message.text) return;

    const channelType =
      "channel_type" in message ? message.channel_type : undefined;

    if (channelType === "im") {
      const question = stripMentions(message.text);
      if (isEmptyQuestion(question)) return;
      const userId = "user" in message ? message.user : undefined;
      console.log("[slack] DM message received");
      await handleWorkerQuestion({
        client,
        channel: message.channel,
        threadTs: message.ts,
        userId,
        question,
      });
      return;
    }

    if (botUserId && message.text.includes(`<@${botUserId}>`)) {
      console.log("[slack] channel message with @mention (backup handler)");
      const userId = "user" in message ? message.user : undefined;
      await onMentionMessage({
        client,
        channel: message.channel,
        threadTs: message.ts,
        userId,
        text: message.text,
      });
    }
  });
}

async function warnIfNgrokPortMismatch(listenPort: number): Promise<void> {
  try {
    const data = (await (
      await fetch("http://127.0.0.1:4040/api/tunnels")
    ).json()) as {
      tunnels?: { config?: { addr?: string } }[];
    };
    const addr = data.tunnels?.[0]?.config?.addr ?? "";
    const match = addr.match(/:(\d+)$/);
    if (match && Number(match[1]) !== listenPort) {
      console.error(
        `\n*** PORT MISMATCH: app on ${listenPort} but ngrok forwards to ${match[1]} ***` +
          `\nStop all node/ngrok processes, then:\n` +
          `  ngrok http ${listenPort}\n` +
          `  npm run dev\n`
      );
    }
  } catch {
    console.warn(
      `[slackapp] ngrok not detected. Run: ngrok http ${listenPort} and set Slack Request URL.`
    );
  }
}

async function main(): Promise<void> {
  const auth = await app.client.auth.test();
  const botUserId = auth.user_id ?? "";
  console.log(`[slack] bot: ${auth.user} (${botUserId})`);
  console.log(
    `[slack] signing secret: ${config.slack.signingSecret.length} chars (must match Slack app → Basic Information)`
  );
  registerHandlers(botUserId);

  if (useSocketMode) {
    await app.start();
    console.log("⚡ Qiko Slack app running (Socket Mode)");
  } else {
    const port = await resolveListenPort(config.port);
    if (port !== config.port) {
      console.error(
        `\n*** Port ${config.port} is busy — started on ${port} instead. ***` +
          `\nRun: taskkill /IM node.exe /F  then restart so ngrok and app use the SAME port.\n`
      );
    }
    await app.start(port);
    console.log(`⚡ Qiko Slack app running on port ${port} (HTTP)`);
    console.log(`Slack Request URL: https://<ngrok-host>/slack/events`);
    console.log(`ngrok must forward to: http://localhost:${port}`);
    await warnIfNgrokPortMismatch(port);
  }
  console.log(`Worker: ${config.qiko.agentUniqueId}`);
  console.log(`API: ${config.qiko.apiBaseUrl}`);
  try {
    const tunnels = (await (
      await fetch("http://127.0.0.1:4040/api/tunnels")
    ).json()) as { tunnels?: { public_url?: string }[] };
    const url = tunnels.tunnels?.find((t) => t.public_url?.startsWith("https"))?.public_url;
    if (url) {
      console.log(`\n>>> Slack Request URL: ${url}/slack/events <<<\n`);
    }
  } catch {
    /* ngrok not running */
  }

  console.log(
    "\n>>> If bot does not reply, check Slack app (NOT only OAuth scopes):\n" +
      "  1. Event Subscriptions → Subscribe to bot events → app_mention (required)\n" +
      "  2. /invite @LinkstarBot in the channel\n" +
      "  3. Message: @LinkstarBot hello  (must pick bot from list, not type name)\n" +
      "  4. qiko-slackapp window must show: [slack] POST /slack/events → forward to Bolt (app_mention)\n"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
