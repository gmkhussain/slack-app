# qiko-to-slack

Post messages **from this project (Qiko) → Slack channel**.  
Separate from the inbound `@LinkstarBot` app in `src/` (Slack → Qiko).

## Setup

1. Uses the same `.env` as the parent folder (or copy `qiko-to-slack/.env.example`).
2. Required:
   - `SLACK_BOT_TOKEN` (`xoxb-…`) with **`chat:write`**
   - `channels:read` (resolve channel **names** like `general`)
   - `channels:join` (bot joins **public** channels automatically)
   - `channels:manage` (invite bot into **private** channels when possible)
3. Bot must be in the target channel — use any of:
   - In Slack: `/invite @LinkstarBot` inside the channel
   - In Slack: `@LinkstarBot join channel general`
   - API: `POST /join` (see below) — auto-join before each `/notify` if `channels:join` scope is set

```env
SLACK_BOT_TOKEN=xoxb-...
SLACK_NOTIFY_CHANNEL=general
QIKO_SLACK_NOTIFY_PORT=3011
# QIKO_SLACK_NOTIFY_SECRET=optional-shared-secret
```

```bash
cd qiko-to-slack
npm install
```

## 1. CLI — send one message

```bash
cd qiko-to-slack
npm run send -- "Hello from Qiko"
npm run send -- --channel onboarding "New user signed up"
```

## 2. Add bot to a channel (HTTP)

```http
POST http://localhost:3011/join
Content-Type: application/json

{ "channel": "general" }
```

## 3. HTTP API — call from Laravel / Qiko backend

```bash
npm run dev
```

```http
POST http://localhost:3011/notify
Content-Type: application/json

{
  "text": "Worker finished: report ready",
  "channel": "my-team"
}
```

Response:

```json
{ "ok": true, "channel_id": "C…", "channel_name": "my-team", "ts": "…" }
```

With secret (if `QIKO_SLACK_NOTIFY_SECRET` is set):

```http
X-Notify-Secret: your-random-secret
```

Or `"secret": "…"` in the JSON body.

## 4. Import in Node (same repo)

```typescript
import { sendSlackMessage } from "../qiko-to-slack/src/slackNotifier.js";

await sendSlackMessage({
  text: "Alert from Qiko worker",
  channel: "general",
});
```

## Flow

```
Qiko / Laravel / script
        ↓
  POST /notify  or  sendSlackMessage()
        ↓
  chat.postMessage (Slack API)
        ↓
  #your-channel
```

## Parent app

| Folder / app | Direction |
|--------------|-----------|
| `slack-to-qiko/` | Slack @mention → Qiko chat API |
| `qiko-to-slack/` | Qiko → Slack channel message |

Run both: `slack-to-qiko\_start.bat` + `cd qiko-to-slack && npm run dev` (notify API).
