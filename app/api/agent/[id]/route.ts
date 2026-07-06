import { NextResponse } from "next/server";
import { resolveSessionPath } from "@/lib/session-reader";
import { startRpcSession, getRpcSession } from "@/lib/rpc-manager";
import { getRuntimeStatusSnapshot } from "@/lib/runtime-status/provider";
import { SessionManager } from "@earendil-works/pi-coding-agent";

async function getHerdrOwnedSession(sessionId: string): Promise<{ herdrAgentId: string; herdrLabel?: string } | null> {
  try {
    const snapshot = await getRuntimeStatusSnapshot();
    const status = snapshot.sessions[sessionId];
    if (!status?.herdrAgentId) return null;
    return { herdrAgentId: status.herdrAgentId, herdrLabel: status.herdrLabel };
  } catch {
    return null;
  }
}

// POST /api/agent/[id] - Send a command to an existing session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const herdrOwned = await getHerdrOwnedSession(id);
    if (herdrOwned) {
      return NextResponse.json(
        {
          error: "This session is Herdr-owned and read-only in pi-web until web command routing is available.",
          herdrAgentId: herdrOwned.herdrAgentId,
          ...(herdrOwned.herdrLabel ? { herdrLabel: herdrOwned.herdrLabel } : {}),
        },
        { status: 409 },
      );
    }

    const body = await req.json() as { type: string; [key: string]: unknown };

    // Fast path: already-running session
    const existing = getRpcSession(id);
    if (existing?.isAlive()) {
      const result = await existing.send(body);
      return NextResponse.json({ success: true, data: result });
    }

    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();

    const { session } = await startRpcSession(id, filePath, cwd);
    const result = await session.send(body);

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// GET /api/agent/[id] - Get current agent state
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const session = getRpcSession(id);
    if (!session || !session.isAlive()) {
      return NextResponse.json({ running: false });
    }

    const state = await session.send({ type: "get_state" });
    return NextResponse.json({ running: true, state });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
