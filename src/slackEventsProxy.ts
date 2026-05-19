import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

export const BOLT_EVENTS_PATH = "/slack/bolt-events";

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** Slack URL verification needs text/plain challenge; Bolt handles events on BOLT_EVENTS_PATH. */
export function createSlackEventsProxyRoute(
  boltEventsPath: string,
  listenPort: number
) {
  return {
    path: "/slack/events",
    method: ["POST"],
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const raw = await readRawBody(req);
        let body: { type?: string; challenge?: string; event?: { type?: string } };
        try {
          body = JSON.parse(raw.toString("utf8")) as typeof body;
        } catch {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Invalid JSON");
          return;
        }

        if (body.type === "url_verification" && typeof body.challenge === "string") {
          console.log("[slack] url_verification → plain text challenge");
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
          res.end(body.challenge);
          return;
        }

        const eventKind = body.event?.type ?? body.type ?? "unknown";
        console.log(`[slack] POST /slack/events → forward to Bolt (${eventKind})`);

        const proxyReq = http.request(
          {
            hostname: "127.0.0.1",
            port: listenPort,
            path: boltEventsPath,
            method: "POST",
            headers: {
              "content-type": "application/json",
              "content-length": String(raw.length),
              ...(req.headers["x-slack-signature"]
                ? { "x-slack-signature": req.headers["x-slack-signature"] }
                : {}),
              ...(req.headers["x-slack-request-timestamp"]
                ? {
                    "x-slack-request-timestamp":
                      req.headers["x-slack-request-timestamp"],
                  }
                : {}),
            },
          },
          (proxyRes) => {
            const chunks: Buffer[] = [];
            proxyRes.on("data", (c) => chunks.push(c));
            proxyRes.on("end", () => {
              const out = Buffer.concat(chunks).toString("utf8");
              if ((proxyRes.statusCode ?? 500) >= 400) {
                console.error(
                  `[slack] Bolt returned ${proxyRes.statusCode}:`,
                  out.slice(0, 300)
                );
              }
              res.writeHead(proxyRes.statusCode ?? 500, proxyRes.headers);
              res.end(Buffer.concat(chunks));
            });
          }
        );

        proxyReq.on("error", (err) => {
          console.error("[slack] proxy to Bolt failed:", err);
          res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Bolt handler unavailable");
        });

        proxyReq.write(raw);
        proxyReq.end();
      } catch (err) {
        console.error("[slack] /slack/events handler error:", err);
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Internal error");
      }
    },
  };
}
