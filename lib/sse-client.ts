export async function streamPost(
  url: string,
  body: unknown,
  onDelta: (text: string) => void,
  onDone?: (meta: unknown) => void,
  signal?: AbortSignal
): Promise<void> {
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
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const events = buf.split("\n\n");
    buf = events.pop() ?? "";
    for (const block of events) {
      const lines = block.split("\n");
      const event = lines.find((l) => l.startsWith("event: "))?.slice(7);
      const data = lines.find((l) => l.startsWith("data: "))?.slice(6);
      if (!data) continue;
      const parsed = JSON.parse(data);
      if (event === "done") onDone?.(parsed);
      else if (event === "error") throw new Error(parsed.message);
      else if (parsed.text) onDelta(parsed.text);
    }
  }
}
