# Qiko Slack App (`slackapp`)

Slack par jab koi **@LinkstarBot** mention karke sawal puche (jaise `@LinkstarBot hello, tell 2 + 2?`), yeh service us sawal ko **Qiko worker public chat API** par bhejti hai aur jawab **usi Slack thread** mein post karti hai — bilkul waise hi jaise web par `/chat/:workerId` public chat.

## Flow

```
Slack user → @LinkstarBot question
     ↓
slackapp (Bolt) → POST /api/avatar/public/{agent}/chat
     ↓
Laravel worker (RAG + LLM) → reply
     ↓
Slack thread mein answer
```

Yeh wahi endpoint hai jo frontend `sendPublicAvatarMessage` use karta hai (`client/src/pages/PublicChatPage.tsx`).

## Setup

### 1. Slack app banayein

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → From scratch  
2. App name: **LinkstarBot** (ya jo naam chaho)  
3. **OAuth & Permissions** → Bot Token Scopes:
   - `app_mentions:read`
   - `chat:write`
   - `channels:manage` (create public channels — `@LinkstarBot create channel with name of 'abc'`)
   - `groups:write` (only if you use `create private channel ...`)
   - `users:read` (optional, email ke liye)
   - `users:read.email` (optional)
   - `im:history`, `im:write` (agar DM support chahiye)
4. **Event Subscriptions** → ON → Subscribe to bot events:
   - `app_mention`
   - `message.im` (agar DM chahiye)
5. **Socket Mode** → ON → App-Level Token banayein (`connections:write`)
6. **Install App** → workspace → **Bot User OAuth Token** copy karein

### 2. Environment

```bash
cd slackapp
cp .env.example .env
# .env edit karein
```

| Variable | Description |
|----------|-------------|
| `SLACK_BOT_TOKEN` | `xoxb-...` |
| `SLACK_SIGNING_SECRET` | Signing secret |
| `SLACK_APP_TOKEN` | `xapp-...` (Socket Mode) |
| `QIKO_AGENT_UNIQUE_ID` | Worker ka `agent_unique_id` (web `/chat/` URL wala) |
| `QIKO_API_BASE_URL` | e.g. `https://stage-backend.qiko.ai/api/avatar` |

Worker ka status backend par **`ready`** hona chahiye (web public chat jaisa).

### 3. Run

**Without `SLACK_APP_TOKEN` (HTTP mode)** — `SLACK_SOCKET_MODE=false`, then:

```bash
cd slackapp
npm install
npm run dev          # terminal 1
ngrok http 3010      # terminal 2 (update ngrok if version < 3.20: ngrok update)
```

Or double-click **`_start.bat`** (Windows) — starts `npm run dev` + ngrok on `PORT` from `.env`.  
Stop with **`_stop.bat`**.

Optional: place `ngrok.exe` in `slackapp/.ngrok-bin/` (or use Laragon / PATH).

Slack → Event Subscriptions → Request URL: `https://<ngrok-host>/slack/events`

### URL verification failed ("challenge" error)?

1. Run `_start.bat` — keep **both** windows open.
2. Copy **Signing Secret** from Slack → **Basic Information** into `.env` as `SLACK_SIGNING_SECRET` (no quotes/spaces).
3. Click **Retry** in Event Subscriptions (do not open the URL in browser only).
4. If still failing: ngrok free may block Slack — use **`_start-cloudflared.bat`** instead and paste the `trycloudflare.com` URL + `/slack/events`.
5. Debug: set `SLACK_SKIP_SIGNATURE_VERIFY=true` in `.env`, restart, Retry — if Verified, your signing secret was wrong.

**With `SLACK_APP_TOKEN` (Socket Mode)** — paste `xapp-...` token, no ngrok needed:

```bash
npm run dev
```

Production:

```bash
pnpm build
pnpm start
```

## Example

Slack channel:

```
@LinkstarBot hello, tell 2 + 2?
```

Bot thread mein worker ka jawab post karega (e.g. `4` — worker knowledge par depend karta hai).

### Create a channel

In any channel where the bot is invited:

```
@LinkstarBot create channel with name of 'abc'
```

Also works: `create channel named abc`, `create a private channel called my-team`.

The name is normalized for Slack (`My Team` → `my-team`). Requires `channels:manage` (and `groups:write` for private); reinstall the app after adding scopes.

## HTTP mode (production server)

Socket Mode ke bina: `.env` se `SLACK_APP_TOKEN` hata dein, `PORT` set karein, Slack app mein **Request URL** = `https://your-domain.com/slack/events`.

## Security

- `SLACK_ALLOWED_CHANNEL_IDS` se sirf specific channels allow kar sakte ho  
- Secrets `.env` mein rakhein, git mein commit na karein  

## Project relation

| Web (frontend) | Slack (`slackapp`) |
|----------------|-------------------|
| `POST .../public/{id}/chat` | Same |
| `PublicChatPage.tsx` | `src/qikoClient.ts` |
| User email form | Slack user email ya `slack-{userId}@slack.local` |

Backend logic is repo ke bahar hai (Laravel Avatar API); yeh folder sirf Slack ↔ API bridge hai.
