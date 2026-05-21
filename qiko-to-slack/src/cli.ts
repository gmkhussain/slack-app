import { sendSlackMessage } from "./slackNotifier.js";

function usage(): void {
  console.log(`Usage:
  npm run send -- "Your message text"
  npm run send -- --channel my-team "Message to #my-team"
  npm run send -- --channel C01234ABCD "Message by channel ID"
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    usage();
    process.exit(1);
  }

  let channel: string | undefined;
  const textParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--channel" || args[i] === "-c") {
      channel = args[++i];
      if (!channel) {
        console.error("Missing value after --channel");
        process.exit(1);
      }
    } else {
      textParts.push(args[i]!);
    }
  }

  const text = textParts.join(" ").trim();
  if (!text) {
    usage();
    process.exit(1);
  }

  const result = await sendSlackMessage({ channel, text });
  const label = result.channelName ? `#${result.channelName}` : result.channelId;
  console.log(`Posted to ${label} (ts=${result.ts})`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
