import { createServer } from "node:net";

/** First port >= `preferred` that is free to bind. Set STRICT_PORT=true to fail instead of switching. */
export async function resolveListenPort(
  preferred: number,
  maxAttempts = 20
): Promise<number> {
  if (process.env.STRICT_PORT === "true") {
    if (!(await isPortAvailable(preferred))) {
      throw new Error(
        `Port ${preferred} is in use. Stop other processes (taskkill /IM node.exe /F) and retry.`
      );
    }
    return preferred;
  }
  for (let offset = 0; offset < maxAttempts; offset++) {
    const port = preferred + offset;
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(
    `No free port found between ${preferred} and ${preferred + maxAttempts - 1}`
  );
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}
