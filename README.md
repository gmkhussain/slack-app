# Slack ↔ Qiko

Two apps in one repo (shared `.env` at repo root):

| Folder | Direction | Port |
|--------|-----------|------|
| **[slack-to-qiko/](slack-to-qiko/)** | Slack @mention → Qiko chat API | `3010` |
| **[qiko-to-slack/](qiko-to-slack/)** | Qiko → post message to Slack channel | `3011` |

## Quick start

```bash
# 1. Env (repo root)
cp .env.example .env
# edit SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, QIKO_* ...

# 2. Inbound bot (Slack → Qiko)
cd slack-to-qiko && npm install
# Windows: slack-to-qiko\_start.bat
# Or: npm run slack-to-qiko:dev   (from repo root)

# 3. Outbound notify (Qiko → Slack) — optional
cd qiko-to-slack && npm install
npm run qiko-to-slack:dev
```

## Root scripts

```bash
npm run slack-to-qiko:dev
npm run qiko-to-slack:dev
```

## Docs

- [slack-to-qiko/README.md](slack-to-qiko/README.md) — Bolt bot, channel commands, ngrok
- [qiko-to-slack/README.md](qiko-to-slack/README.md) — `POST /notify`, `POST /join`
