import { statSync } from "node:fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { allowFileRoot } from "@/lib/file-access";
import { listAllSessions } from "@/lib/session-reader";
import { getHerdrStatusSnapshot } from "@/lib/runtime-status/herdr-adapter";
import { closeHerdrAgentPane, startHerdrAgent } from "@/lib/runtime-status/herdr-control";
import {
  HerdrRecoveryError,
  recoverHerdrRuntime,
  type HerdrRecoveryAction,
} from "@/lib/runtime-status/herdr-recovery";

export const dynamic = "force-dynamic";

function resolveValidSessionFile(path: string): string | undefined {
  try {
    if (!path.endsWith(".jsonl") || !statSync(path).isFile()) return undefined;
    const header = SessionManager.open(path).getHeader();
    return header?.id ? path : undefined;
  } catch {
    return undefined;
  }
}

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
  const action = typeof body === "object" && body !== null && "action" in body
    ? (body as { action?: unknown }).action
    : undefined;
  if (typeof agentId !== "string" || (action !== "retry_binding" && action !== "cleanup")) {
    return Response.json({ ok: false, error: "agentId and a valid action are required" }, { status: 400 });
  }

  try {
    const sessions = await listAllSessions();
    const result = await recoverHerdrRuntime(
      { agentId, action: action as HerdrRecoveryAction },
      {
        getSnapshot: getHerdrStatusSnapshot,
        sessionRefs: sessions.map((session) => ({ sessionId: session.id, sessionFile: session.path })),
        close: closeHerdrAgentPane,
        start: startHerdrAgent,
        resolveValidSessionFile,
        authorizeCwd: allowFileRoot,
      },
    );
    return Response.json(result);
  } catch (error) {
    if (error instanceof HerdrRecoveryError) {
      return Response.json({ ok: false, error: error.message }, { status: error.status });
    }
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
