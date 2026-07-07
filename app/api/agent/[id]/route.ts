import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { findBridgeRegistryForSession, sendBridgeCommand } from "@/lib/bridge/rpc-bridge-client";
import { resolveSessionPath } from "@/lib/session-reader";
import { startRpcSession, getRpcSession } from "@/lib/rpc-manager";
import { getRuntimeStatusSnapshot } from "@/lib/runtime-status/provider";
import { SessionManager } from "@earendil-works/pi-coding-agent";

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

const BRIDGE_COMMAND_TYPES = new Set([
  "prompt",
  "steer",
  "follow_up",
  "abort",
  "compact",
  "get_state",
  "get_commands",
  "set_model",
  "get_available_models",
  "set_thinking_level",
  "set_steering_mode",
  "set_follow_up_mode",
  "set_auto_compaction",
  "set_auto_retry",
  "abort_retry",
  "abort_bash",
  "get_session_stats",
  "get_fork_messages",
  "get_last_assistant_text",
  "set_session_name",
  "get_messages",
  "extension_ui_response",
]);

function bridgeErrorStatus(errorCode: string | undefined): number {
  if (errorCode === "session_mismatch") return 409;
  if (errorCode === "invalid_token") return 403;
  if (errorCode === "unsupported_command") return 409;
  if (errorCode === "child_exited") return 503;
  return 502;
}

function buildBridgeCommand(body: { type: string; [key: string]: unknown }, capabilities: string[]): { type: string; [key: string]: unknown } | null {
  if (!BRIDGE_COMMAND_TYPES.has(body.type)) return null;
  if (!capabilities.includes(body.type)) return null;

  switch (body.type) {
    case "prompt":
      return {
        type: "prompt",
        message: String(body.message ?? ""),
        ...(Array.isArray(body.images) ? { images: body.images } : {}),
        ...(typeof body.streamingBehavior === "string" ? { streamingBehavior: body.streamingBehavior } : {}),
      };
    case "steer":
    case "follow_up":
      return {
        type: body.type,
        message: String(body.message ?? ""),
        ...(Array.isArray(body.images) ? { images: body.images } : {}),
      };
    default:
      return { ...body };
  }
}

async function sendHerdrBridgeCommand(
  sessionId: string,
  sessionFile: string | undefined,
  body: { type: string; [key: string]: unknown },
) {
  const bridge = await findBridgeRegistryForSession({ sessionId, sessionFile });
  if (!bridge) return { bridge, command: null, response: null };
  const command = buildBridgeCommand(body, bridge.capabilities);
  if (!command) return { bridge, command: null, response: null };

  const response = await sendBridgeCommand(bridge, {
    id: randomUUID(),
    expectedSessionId: sessionId,
    ...(sessionFile ? { expectedSessionFile: sessionFile } : {}),
    command,
  });

  return { bridge, command, response };
}

// POST /api/agent/[id] - Send a command to an existing session
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await req.json() as { type: string; [key: string]: unknown };
    const herdrOwned = await getHerdrOwnedSession(id);
    if (herdrOwned) {
      const sessionFile = herdrOwned.sessionFile ?? await resolveSessionPath(id) ?? undefined;
      const { bridge, command, response } = await sendHerdrBridgeCommand(id, sessionFile, body);

      if (bridge && command && response) {
        if (response.accepted) {
          return NextResponse.json({ success: true, data: response.data ?? response });
        }

        return NextResponse.json(
          {
            error: response.errorMessage ?? "Bridge rejected command",
            errorCode: response.errorCode,
            herdrAgentId: herdrOwned.herdrAgentId,
            ...(herdrOwned.herdrLabel ? { herdrLabel: herdrOwned.herdrLabel } : {}),
          },
          { status: bridgeErrorStatus(response.errorCode) },
        );
      }

      return NextResponse.json(
        {
          error: bridge
            ? "This Herdr-owned bridge session does not support this command yet."
            : "This session is Herdr-owned and read-only in pi-web until bridge command routing is available.",
          herdrAgentId: herdrOwned.herdrAgentId,
          ...(herdrOwned.herdrLabel ? { herdrLabel: herdrOwned.herdrLabel } : {}),
        },
        { status: 409 },
      );
    }

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
    const herdrOwned = await getHerdrOwnedSession(id);
    if (herdrOwned) {
      const sessionFile = herdrOwned.sessionFile ?? await resolveSessionPath(id) ?? undefined;
      const { bridge, response } = await sendHerdrBridgeCommand(id, sessionFile, { type: "get_state" });
      if (bridge && response?.accepted) {
        return NextResponse.json({ running: true, state: response.data ?? response });
      }
      return NextResponse.json({
        running: false,
        herdrOwned: true,
        herdrAgentId: herdrOwned.herdrAgentId,
        ...(herdrOwned.herdrLabel ? { herdrLabel: herdrOwned.herdrLabel } : {}),
      });
    }

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
