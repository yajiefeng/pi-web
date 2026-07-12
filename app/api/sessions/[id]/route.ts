import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { existsSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { findBridgeRegistryForSession } from "@/lib/bridge/rpc-bridge-client";
import {
  resolveSessionPath,
  invalidateSessionPathCache,
  buildSessionContext,
  listAllSessions,
} from "@/lib/session-reader";
import type { SessionContext } from "@/lib/types";
import { getRpcSession } from "@/lib/rpc-manager";
import { stopHerdrRuntimesForSessions } from "@/lib/runtime-status/session-lifecycle";

// BranchNavigator still traverses recursively, so keep the response tree shallow.
const MAX_PROJECTED_TREE_DEPTH = 200;

function createdFromSessionFile(sessionFile: string): string | undefined {
  const filename = sessionFile.split(/[\\/]/).pop() ?? "";
  const raw = filename.match(/^(.*?)_[^_\\/]+\.jsonl$/)?.[1];
  return raw ? raw.replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z") : undefined;
}

function readMessageLimit(req: Request): number | null {
  const value = new URL(req.url).searchParams.get("messageLimit");
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function limitSessionContext(context: SessionContext, messageLimit: number | null): SessionContext {
  const totalMessages = context.messages.length;
  if (!messageLimit || totalMessages <= messageLimit) {
    return { ...context, totalMessages, truncated: false };
  }
  return {
    ...context,
    messages: context.messages.slice(-messageLimit),
    entryIds: context.entryIds.slice(-messageLimit),
    totalMessages,
    truncated: true,
  };
}

/**
 * Project the session tree into the shallow navigation tree sent to the client.
 * Keeps roots, branch points, and leaves while contracting single-child chains
 * without recursive traversal. Contracted entry IDs are attached to the next
 * visible node so the UI can still recognize an active leaf inside the chain.
 */
function projectTreeForResponse<T extends { entry: { id: string }; children: T[]; compressedEntryIds?: string[] }>(
  nodes: T[]
): T[] {
  const keep = new Set<T>();
  const roots = new Set(nodes);
  const seen = new Set<T>();
  const stack = [...nodes];

  while (stack.length > 0) {
    const node = stack.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);

    if (
      roots.has(node) ||
      node.children.length !== 1
    ) {
      keep.add(node);
    }

    for (const child of node.children) {
      stack.push(child);
    }
  }

  const cloneNode = (node: T, compressedEntryIds?: string[]): T => ({
    ...node,
    children: [],
    ...(compressedEntryIds?.length ? { compressedEntryIds } : {}),
  });
  const projectedRoots = nodes.map((node) => cloneNode(node));
  const tasks = nodes.map((source, index) => ({
    source,
    projected: projectedRoots[index],
    depth: 1,
  }));

  const appendFlattenedKeptDescendants = (source: T, projectedParent: T) => {
    const pending = [{ node: source, compressedEntryIds: [] as string[] }];
    const flattenedSeen = new Set<T>();

    while (pending.length > 0) {
      const { node, compressedEntryIds } = pending.pop()!;
      if (flattenedSeen.has(node)) continue;
      flattenedSeen.add(node);

      if (keep.has(node)) {
        projectedParent.children.push(cloneNode(node, compressedEntryIds));
      }

      for (let i = node.children.length - 1; i >= 0; i--) {
        pending.push({
          node: node.children[i],
          compressedEntryIds: keep.has(node)
            ? []
            : [...compressedEntryIds, node.entry.id],
        });
      }
    }
  };

  while (tasks.length > 0) {
    const { source, projected, depth } = tasks.pop()!;

    for (const sourceChild of source.children) {
      let child = sourceChild;

      if (depth >= MAX_PROJECTED_TREE_DEPTH) {
        appendFlattenedKeptDescendants(child, projected);
        continue;
      }

      const compressedEntryIds: string[] = [];
      while (!keep.has(child) && child.children.length === 1) {
        compressedEntryIds.push(child.entry.id);
        child = child.children[0];
      }

      if (!keep.has(child)) {
        continue;
      }

      const projectedChild = cloneNode(child, compressedEntryIds);
      projected.children.push(projectedChild);
      tasks.push({ source: child, projected: projectedChild, depth: depth + 1 });
    }
  }

  return projectedRoots;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    let filePath = await resolveSessionPath(id);
    if (!filePath) {
      const bridge = await findBridgeRegistryForSession({ sessionId: id });
      if (!bridge?.sessionFile) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      filePath = bridge.sessionFile;
      if (!existsSync(filePath)) {
        const created = createdFromSessionFile(filePath) ?? bridge.updatedAt ?? new Date().toISOString();
        return NextResponse.json({
          sessionId: id,
          filePath,
          info: {
            path: filePath,
            id,
            cwd: bridge.cwd ?? "",
            created,
            modified: bridge.updatedAt ?? created,
            messageCount: 0,
            firstMessage: "(no messages)",
          },
          leafId: null,
          tree: [],
          context: {
            messages: [],
            entryIds: [],
            thinkingLevel: "off",
            model: null,
          },
        });
      }
    }

    const sm = SessionManager.open(filePath);
    const entries = sm.getEntries() as never;
    const leafId = sm.getLeafId();
    const tree = projectTreeForResponse(sm.getTree());
    const context = limitSessionContext(buildSessionContext(entries, leafId), readMessageLimit(req));

    const header = sm.getHeader();
    let modified = header?.timestamp ?? new Date().toISOString();
    try { modified = statSync(filePath).mtime.toISOString(); } catch { /* use header timestamp */ }
    const allSessions = await listAllSessions();
    const parentSessionId = allSessions.find((s) => s.id === id)?.parentSessionId;
    const info = header ? {
      path: filePath,
      id: header.id,
      cwd: header.cwd ?? "",
      name: sm.getSessionName(),
      created: header.timestamp,
      modified,
      messageCount: context.messages.length,
      firstMessage: context.messages.find((m) => m.role === "user")
        ? (() => {
            const msg = context.messages.find((m) => m.role === "user")!;
            const c = (msg as { content: unknown }).content;
            return typeof c === "string" ? c : (Array.isArray(c) ? (c.find((b: { type: string }) => b.type === "text") as { text: string } | undefined)?.text ?? "" : "") || "(no messages)";
          })()
        : "(no messages)",
      parentSessionId,
    } : null;

    const url = new URL(req.url);
    let agentState: { running: boolean; state?: unknown } | undefined;
    if (url.searchParams.has("includeState")) {
      const rpc = getRpcSession(id);
      if (rpc?.isAlive()) {
        const state = await rpc.send({ type: "get_state" });
        agentState = { running: true, state };
      } else {
        agentState = { running: false };
      }
    }

    return NextResponse.json({
      sessionId: id,
      filePath,
      info,
      leafId,
      tree,
      context,
      ...(agentState !== undefined ? { agentState } : {}),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// PATCH /api/sessions/[id]  body: { name: string }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const { name } = await req.json() as { name?: string };
    if (typeof name !== "string") {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    const sm = SessionManager.open(filePath);
    sm.appendSessionInfo(name.trim());
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

async function stopLocalRpcSession(sessionId: string): Promise<void> {
  const runtime = getRpcSession(sessionId);
  if (!runtime) return;
  if (runtime.isRunning()) await runtime.send({ type: "abort" });
  runtime.destroy();
}

function replaceFileAtomically(filePath: string, content: string): void {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tempPath, content, { mode: statSync(filePath).mode });
    renameSync(tempPath, filePath);
  } finally {
    try { unlinkSync(tempPath); } catch { /* already renamed or never written */ }
  }
}

// DELETE /api/sessions/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Read header before deleting to get parentSession path
    const firstLine = readFileSync(filePath, "utf8").split("\n")[0];
    let parentSessionPath: string | undefined;
    try {
      const header = JSON.parse(firstLine) as { type?: string; parentSession?: string };
      if (header.type === "session") parentSessionPath = header.parentSession;
    } catch { /* ignore */ }

    // Discover every durable file that will be mutated before stopping writers.
    const dir = filePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
    const children: Array<{ id: string; path: string }> = [];
    const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl") && join(dir, f) !== filePath);
    for (const file of files) {
      const childPath = join(dir, file);
      try {
        const header = JSON.parse(readFileSync(childPath, "utf8").split("\n")[0]) as { type?: string; id?: string; parentSession?: string };
        if (header.type === "session" && typeof header.id === "string" && header.parentSession === filePath) {
          children.push({ id: header.id, path: childPath });
        }
      } catch (error) {
        throw new Error(`Cannot safely inspect sibling session ${childPath}: ${String(error)}`);
      }
    }

    // Stop local writers first, then close and verify all Herdr ownership from
    // one final snapshot immediately before the synchronous mutation phase.
    const affectedSessions = [{ sessionId: id, sessionFile: filePath }, ...children.map((child) => ({ sessionId: child.id, sessionFile: child.path }))];
    for (const session of affectedSessions) await stopLocalRpcSession(session.sessionId);
    await stopHerdrRuntimesForSessions(affectedSessions);
    for (const session of affectedSessions) {
      if (getRpcSession(session.sessionId)?.isAlive()) {
        throw new Error(`Local Runtime Owner reappeared during deletion: ${session.sessionId}`);
      }
    }

    // Reread after shutdown so no writes made before the abort can be lost.
    const rewrites = children.map((child) => {
      const original = readFileSync(child.path, "utf8");
      const lines = original.split("\n");
      const header = JSON.parse(lines[0]) as { type?: string; id?: string; parentSession?: string };
      if (header.type !== "session" || header.id !== child.id || header.parentSession !== filePath) {
        throw new Error(`Child session changed while preparing deletion: ${child.path}`);
      }
      header.parentSession = parentSessionPath;
      lines[0] = JSON.stringify(header);
      return { path: child.path, original, updated: lines.join("\n") };
    });

    const written: typeof rewrites = [];
    try {
      for (const rewrite of rewrites) {
        replaceFileAtomically(rewrite.path, rewrite.updated);
        written.push(rewrite);
      }
      unlinkSync(filePath);
    } catch (error) {
      for (const rewrite of written.reverse()) {
        try { replaceFileAtomically(rewrite.path, rewrite.original); } catch { /* best-effort rollback */ }
      }
      throw error;
    }

    invalidateSessionPathCache(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
