# slack-to-qiko

Slack **@LinkstarBot** mentions → **Qiko worker** public chat API → reply in the Slack thread.

Outbound posts (Qiko → Slack) are in **[../qiko-to-slack/](../qiko-to-slack/)** — unchanged.

## Flow

```
Slack user → @LinkstarBot question
     ↓
slack-to-qiko (Bolt) → POST /api/avatar/public/{agent}/chat
     ↓
Laravel worker → reply
     ↓
Slack thread
```

## Setup

1. [api.slack.com/apps](https://api.slack.com/apps) → OAuth scopes: `app_mentions:read`, `chat:write`, `channels:join`, `channels:manage`, `channels:read`, etc. (see repo docs).
2. Copy env to **repo root** `.env` or `slack-to-qiko/.env` (see `.env.example`).
3. `cd slack-to-qiko && npm install`
4. Windows: **`_start.bat`** or `npm run dev`

Slack Event URL: `https://<ngrok-host>/slack/events`

## Run

```bash
cd slack-to-qiko
npm install
npm run dev
```

From repo root:

```bash
npm run slack-to-qiko:dev
```

## Examples

```
@LinkstarBot hello, tell 2 + 2?
@LinkstarBot join channel general
@LinkstarBot create channel with name of 'my-team'
@LinkstarBot invite user @jane to channel my-team
```

Full command list was in the previous monolith README; behavior is the same, only the folder moved from repo `src/` to `slack-to-qiko/src/`.

## Project layout

```
slack-to-qiko/
  src/           Bolt app
  scripts/       check-slack.ps1, test-challenge.ps1
  _start.bat     dev + ngrok
```

Shared `.env` at repo root is loaded automatically (`../../.env`).
