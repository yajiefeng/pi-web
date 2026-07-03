import { subscribeRuntimeStatus } from "@/lib/runtime-status/broadcaster";
import { getRuntimeStatusSnapshot } from "@/lib/runtime-status/provider";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const encode = (data: unknown) => {
        if (closed) return;
        const text = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(text));
      };

      const unsubscribe = subscribeRuntimeStatus((snapshot) => {
        try {
          encode({ type: "runtime_status", snapshot });
        } catch {
          // controller already closed
        }
      });

      void getRuntimeStatusSnapshot()
        .then((snapshot) => encode({ type: "runtime_status", snapshot }))
        .catch((error) => encode({ type: "runtime_status_error", error: error instanceof Error ? error.message : String(error) }));

      const heartbeat = setInterval(() => {
        try {
          if (!closed) controller.enqueue(new TextEncoder().encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try { controller.close(); } catch { /* already closed */ }
      };

      req.signal?.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
