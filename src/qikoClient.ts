import { config } from "./config.js";

export interface WorkerChatRequest {
  message: string;
  email: string;
  user_name?: string;
  agent_unique_id?: string;
}

export interface WorkerChatResult {
  reply: string;
}

function extractReply(data: unknown): string | null {
  console.log("extractReply", data);

  if (!data || typeof data !== "object") return null;
  const root = data as Record<string, unknown>;

  const nested = root.data;
  if (nested && typeof nested === "object") {
    const dataObj = nested as Record<string, unknown>;
    if (typeof dataObj.reply === "string") return dataObj.reply;
    if (Array.isArray(nested) && nested.length > 0) {
      const first = nested[0] as Record<string, unknown>;
      if (typeof first.reply === "string") return first.reply;
    }
  }

  if (typeof root.reply === "string") return root.reply;

  return null;
}

function extractErrorMessage(data: unknown, fallback: string): string {
  console.log("extractErrorMessage", data);
  
  if (!data || typeof data !== "object") return fallback;
  const obj = data as Record<string, unknown>;
  if (typeof obj.message === "string") return obj.message;
  return fallback;
}

/**
 * Same public chat endpoint as PublicChatPage / sendPublicAvatarMessage.
 * POST {base}/public/{agent_unique_id}/chat
 */
export async function askWorker(
  payload: WorkerChatRequest
): Promise<WorkerChatResult> {
  console.log("askWorker", payload);
  const { apiBaseUrl, agentUniqueId } = config.qiko;
  const url = `${apiBaseUrl}/public/${encodeURIComponent(agentUniqueId)}/chat`;

  const body = {
    agent_unique_id: payload.agent_unique_id ?? agentUniqueId,
    message: payload.message,
    email: payload.email,
    ...(payload.user_name ? { user_name: payload.user_name } : {}),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data: unknown = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(
      extractErrorMessage(
        data,
        `Worker API error (${res.status}). Is the agent status "ready"?`
      )
    );
  }

  const reply = extractReply(data);
  if (!reply) {
    throw new Error("Worker API returned no reply.");
  }

  return { reply };
}
