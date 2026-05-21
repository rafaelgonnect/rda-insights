// ─── Generic SSE helper ────────────────────────────────────────────────────────

export interface SsePostOpts {
  url: string;
  body: unknown;
  signal?: AbortSignal;
  /** Called for every parsed SSE block. `event` is the named event type,
   *  or `""` for default (no `event:` line) blocks. */
  onEvent: (event: string, data: unknown) => void;
  onClose?: () => void;
}

export async function streamPostSse(opts: SsePostOpts): Promise<void> {
  const { url, body, signal, onEvent, onClose } = opts;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const blocks = buf.split("\n\n");
      buf = blocks.pop() ?? "";
      for (const block of blocks) {
        if (!block.trim()) continue;
        const lines = block.split("\n");
        const eventLine = lines.find((l) => l.startsWith("event: "));
        const dataLine = lines.find((l) => l.startsWith("data: "));
        if (!dataLine) continue;
        const event = eventLine ? eventLine.slice(7) : "";
        const raw = dataLine.slice(6);
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
        if (event === "error") {
          const msg =
            parsed != null && typeof parsed === "object" && "message" in parsed
              ? String((parsed as Record<string, unknown>).message)
              : String(parsed);
          throw new Error(msg);
        }
        onEvent(event, parsed);
      }
    }
  } finally {
    onClose?.();
  }
}

// ─── Legacy narrow helper (kept for any remaining callers) ────────────────────

export async function streamPost(
  url: string,
  body: unknown,
  onDelta: (text: string) => void,
  onDone?: (meta: unknown) => void,
  signal?: AbortSignal
): Promise<void> {
  await streamPostSse({
    url,
    body,
    signal,
    onEvent(event, data) {
      if (event === "done") {
        onDone?.(data);
      } else if (event === "") {
        // default block — check for text delta
        const d = data as Record<string, unknown>;
        if (d && typeof d.text === "string") onDelta(d.text);
      }
    },
  });
}
