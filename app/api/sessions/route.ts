import { NextResponse } from "next/server";
import { listBridgeRegistries } from "@/lib/bridge/rpc-bridge-client";
import { listAllSessions } from "@/lib/session-reader";
import { getRunningRpcSessionIds } from "@/lib/rpc-manager";
import type { SessionInfo } from "@/lib/types";

function createdFromSessionFile(sessionFile: string): string | undefined {
  const filename = sessionFile.split(/[\\/]/).pop() ?? "";
  const raw = filename.match(/^(.*?)_[^_\\/]+\.jsonl$/)?.[1];
  return raw ? raw.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z") : undefined;
}

export async function GET() {
  try {
    const sessions = await listAllSessions();
    const seen = new Set(sessions.map((session) => session.id));
    const bridgePlaceholders = (await listBridgeRegistries())
      .filter((registry) => registry.sessionId && registry.sessionFile && !seen.has(registry.sessionId))
      .map((registry): SessionInfo => ({
        path: registry.sessionFile!,
        id: registry.sessionId!,
        cwd: registry.cwd ?? "",
        created: createdFromSessionFile(registry.sessionFile!) ?? registry.updatedAt ?? new Date().toISOString(),
        modified: registry.updatedAt ?? new Date().toISOString(),
        messageCount: 0,
        firstMessage: "(no messages)",
      }));
    return NextResponse.json({ sessions: [...bridgePlaceholders, ...sessions], runningSessionIds: getRunningRpcSessionIds() });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
