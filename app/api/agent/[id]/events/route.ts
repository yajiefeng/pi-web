import { randomUUID } from "node:crypto";
import { findBridgeRegistryForSession, subscribeBridgeEvents } from "@/lib/bridge/rpc-bridge-client";
import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { getRuntimeStatusSnapshot } from "@/lib/runtime-status/provider";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

async function getHerdrOwnedSession(sessionId: string): Promise<{ herdrAgentId: string; herdrLabel?: string; sessionFile?: string } | null> {
  try {
    const snapshot = await getRuntimeStatusSnapshot();
    const status = snapshot.sessions[sessionId];
    if (!status?.herdrAgentId) return null;
    return { herdrAgentId: status.herdrAgentId, herdrLabel: status.herdrLabel, sessionFile: status.sessionFile };
  } catch {
    return null;
  }
}

function createSseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function createReadOnlyHerdrStream(req: Request, id: string, herdrOwned: { herdrAgentId: string; herdrLabel?: string }): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      const encode = (data: unknown) => {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      encode({ type: "connected", sessionId: id, herdrOwned: true, bridgeCapable: false });
      encode({
        type: "runtime_readonly",
        message: "This Herdr-owned session is read-only in pi-web until it is restarted as a bridge session.",
        herdrAgentId: herdrOwned.herdrAgentId,
        ...(herdrOwned.herdrLabel ? { herdrLabel: herdrOwned.herdrLabel } : {}),
      });
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);
      const cleanup = () => {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal?.addEventListener("abort", cleanup);
    },
  });
}

function createBridgeEventStream(
  req: Request,
  id: string,
  sessionFile: string | undefined,
  bridge: NonNullable<Awaited<ReturnType<typeof findBridgeRegistryForSession>>>,
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      let closed = false;
      let subscription: Awaited<ReturnType<typeof subscribeBridgeEvents>> | null = null;
      const encode = (data: unknown) => {
        if (closed) return;
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      encode({ type: "connected", sessionId: id, herdrOwned: true, bridgeCapable: true });

      subscribeBridgeEvents(bridge, {
        id: randomUUID(),
        expectedSessionId: id,
        ...(sessionFile ? { expectedSessionFile: sessionFile } : {}),
        command: { type: "subscribe" },
      }, {
        onEvent: (event) => encode(event),
        onError: (error) => encode({ type: "bridge_error", error: error.message }),
        onClose: () => encode({ type: "bridge_closed" }),
      }).then((value) => {
        subscription = value;
      }).catch((error) => {
        encode({ type: "bridge_error", error: error instanceof Error ? error.message : String(error) });
      });

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        subscription?.close();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      req.signal?.addEventListener("abort", cleanup);
    },
  });
}

// GET /api/agent/[id]/events - SSE stream of agent events
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const herdrOwned = await getHerdrOwnedSession(id);
  if (herdrOwned) {
    const sessionFile = herdrOwned.sessionFile ?? await resolveSessionPath(id) ?? undefined;
    const bridge = await findBridgeRegistryForSession({ sessionId: id, sessionFile });
    if (bridge) {
      return createSseResponse(createBridgeEventStream(req, id, sessionFile, bridge));
    }
    return createSseResponse(createReadOnlyHerdrStream(req, id, herdrOwned));
  }

  // Fast path: already-running session
  let session = getRpcSession(id);
  if (!session || !session.isAlive()) {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return new Response("Session not found", { status: 404 });
    }
    const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();
    try {
      ({ session } = await startRpcSession(id, filePath, cwd));
    } catch (error) {
      return new Response(`Failed to start agent: ${error}`, { status: 500 });
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      const encode = (data: unknown) => {
        const text = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(text));
      };

      // Send initial connected event
      encode({ type: "connected", sessionId: id });

      const unsubscribe = session.onEvent((event) => {
        encode(event);
      });

      // Heartbeat every 30s to prevent server/proxy timeout (Next.js default ~120-150s)
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);

      // Cleanup when client disconnects
      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        controller.close();
      };

      // Detect client disconnect via abort signal
      req.signal?.addEventListener("abort", cleanup);
    },
  });

  return createSseResponse(stream);
}
