/** GitHub-style **bold** → Slack mrkdwn *bold* */
export function normalizeMrkdwn(text: string): string {
  return text.replace(/\*\*([^*\n]+)\*\*/g, "*$1*");
}

type Segment =
  | { type: "text"; content: string }
  | { type: "table"; lines: string[] };

function isTableSeparator(line: string): boolean {
  const t = line.trim();
  return /^\|?[\s|:-]+\|?$/.test(t) && t.includes("-");
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.split("|").length >= 3;
}

function parseTableCells(line: string): string[] {
  const parts = line.trim().split("|").map((c) => c.trim());
  if (parts.length && parts[0] === "") parts.shift();
  if (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

/** Split message into plain text and markdown pipe tables */
export function splitTextAndTables(text: string): Segment[] {
  const lines = text.split("\n");
  const segments: Segment[] = [];
  let textBuf: string[] = [];

  const flushText = () => {
    if (textBuf.length) {
      segments.push({ type: "text", content: textBuf.join("\n") });
      textBuf = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    if (isTableRow(lines[i])) {
      flushText();
      const tableLines: string[] = [];
      while (i < lines.length && (isTableRow(lines[i]) || isTableSeparator(lines[i]))) {
        if (!isTableSeparator(lines[i])) tableLines.push(lines[i]);
        i++;
      }
      if (tableLines.length) segments.push({ type: "table", lines: tableLines });
      continue;
    }
    textBuf.push(lines[i]);
    i++;
  }
  flushText();
  return segments.length ? segments : [{ type: "text", content: text }];
}

/** Monospace table inside a Slack code block (works in all workspaces) */
export function formatTableAsCodeBlock(tableLines: string[]): string {
  const rows = tableLines.map(parseTableCells);
  if (!rows.length) return "";

  const colCount = Math.max(...rows.map((r) => r.length));
  const widths: number[] = Array.from({ length: colCount }, (_, c) =>
    Math.max(3, ...rows.map((r) => (r[c] ?? "").length))
  );

  const fmt = (cells: string[]) =>
    cells
      .map((cell, c) => (cell ?? "").padEnd(widths[c] ?? 3))
      .join(" | ");

  const header = fmt(rows[0] ?? []);
  const divider = widths.map((w) => "-".repeat(w)).join("-+-");
  const body = rows.slice(1).map(fmt).join("\n");

  const table = body ? `${header}\n${divider}\n${body}` : header;
  return "```\n" + table + "\n```";
}

export type SlackPreparedMessage = {
  /** Notification fallback + search */
  text: string;
  blocks?: Record<string, unknown>[];
};

export function prepareSlackSegments(segments: Segment[]): SlackPreparedMessage {
  const textParts: string[] = [];
  const blocks: Record<string, unknown>[] = [];

  for (const seg of segments) {
    if (seg.type === "text") {
      const t = normalizeMrkdwn(seg.content).trim();
      if (!t) continue;
      textParts.push(t);
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: t },
      });
    } else {
      const code = formatTableAsCodeBlock(seg.lines);
      if (!code) continue;
      textParts.push(code);
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: code },
      });
    }
  }

  const text = textParts.join("\n\n").trim() || " ";
  return {
    text,
    blocks: blocks.length > 0 ? blocks : undefined,
  };
}
