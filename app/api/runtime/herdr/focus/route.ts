import { listAllSessions } from "@/lib/session-reader";
import { focusHerdrAgent, getHerdrStatusSnapshot } from "@/lib/runtime-status/herdr-adapter";
import { focusHerdrAgentById, HerdrFocusError } from "@/lib/runtime-status/herdr-focus";
import type { SessionRuntimeReference } from "@/lib/runtime-status/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const agentId = typeof body === "object" && body !== null && "agentId" in body
    ? (body as { agentId?: unknown }).agentId
    : undefined;

  if (typeof agentId !== "string") {
    return Response.json({ ok: false, error: "agentId is required" }, { status: 400 });
  }

  try {
    const sessionRefs = await getSessionRefs();
    const result = await focusHerdrAgentById({
      agentId,
      getSnapshot: () => getHerdrStatusSnapshot(),
      focus: (id) => focusHerdrAgent(id),
      sessionRefs,
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof HerdrFocusError) {
      return Response.json({ ok: false, error: error.message }, { status: error.status });
    }

    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

async function getSessionRefs(): Promise<SessionRuntimeReference[]> {
  const sessions = await listAllSessions();
  return sessions.map((session) => ({
    sessionId: session.id,
    sessionFile: session.path,
  }));
}
