export function sseStream(generator: () => AsyncGenerator<{ event?: string; data: string }>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of generator()) {
          const event = ev.event ? `event: ${ev.event}\n` : "";
          controller.enqueue(encoder.encode(`${event}data: ${ev.data}\n\n`));
        }
      } catch (e) {
        controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: String(e) })}\n\n`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "x-accel-buffering": "no",
    },
  });
}
