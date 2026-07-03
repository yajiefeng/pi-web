# Herdr-backed Agent Runtime Status Design

## Summary

Pi-web should expose a unified runtime-status view that combines the existing in-process `AgentSession` state with optional Herdr agent/pane state. The first implementation is read-only: it shows richer status in the session sidebar and adds a Herdr agents view, without changing how prompts are sent or how Pi agent sessions are created.

The current production web service must not be affected during development. Source changes, tests, and linting are safe. Rebuilding `.next` and restarting `com.voiduplink.pi-web-agegr` are deployment steps and require explicit approval.

## Goals

- Show session runtime status beyond a boolean running flag: `idle`, `working`, `blocked`, `done`, or `unknown`.
- Preserve the existing pi-web `AgentSessionWrapper` behavior and SSE flow.
- Add Herdr as an optional status source, not a required dependency.
- Show all Herdr-managed agents/panes in a read-only UI panel.
- Keep UI code independent from Herdr details by introducing a server-side status module.

## Non-goals

- Do not make Herdr responsible for creating or driving pi-web sessions in the first version.
- Do not add Herdr control actions such as focus, read output, send input, or stop panes in the first version.
- Do not infer a session-agent match from cwd alone, because one cwd can contain multiple sessions.
- Do not remove `/api/agent/running/events` immediately; keep it as a compatibility path while the sidebar migrates.

## Current state

Pi-web already tracks running sessions inside `lib/rpc-manager.ts`:

- `AgentSessionWrapper` wraps the SDK `AgentSession`.
- `isRunning()` returns true when `promptRunning`, `inner.isStreaming`, or `inner.isCompacting` is true.
- `notifyRunningChange()` broadcasts a set of running session ids.
- `/api/agent/running/events` streams that set to the sidebar.

This only covers sessions known to the current Next.js process. It does not expose Herdr pane states, blocked states, or external/independent agent activity.

## Architecture

Add a server-side runtime-status module:

```text
UI
  ↓
/api/runtime/status/events
  ↓
RuntimeStatusProvider
  ├─ RpcSessionStatusAdapter
  └─ HerdrStatusAdapter
```

The UI consumes one unified snapshot. Herdr-specific parsing and availability handling stays inside the Herdr adapter.

## New module layout

```text
lib/runtime-status/
  types.ts
  provider.ts
  rpc-adapter.ts
  herdr-adapter.ts
  broadcaster.ts
```

### `types.ts`

Defines the shared interface:

```ts
export type RuntimeStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export type RuntimeStatusSnapshot = {
  sessions: Record<string, SessionRuntimeStatus>;
  herdrAgents: HerdrAgentRuntimeStatus[];
  health: {
    rpc: "ok";
    herdr: "ok" | "unavailable" | "error";
  };
};
```

### `provider.ts`

Exports the deep module interface used by routes and tests:

```ts
export async function getRuntimeStatusSnapshot(): Promise<RuntimeStatusSnapshot>;
```

It calls both adapters, merges statuses, and normalizes health information. Callers do not need to know whether a status came from RPC, Herdr, or both.

### `rpc-adapter.ts`

Reads a snapshot from the existing in-process session registry. `rpc-manager.ts` should expose a read-only helper such as:

```ts
export function getRpcSessionStatusSnapshot(): RpcSessionRuntimeStatus[];
```

Mapping:

- `promptRunning`, `isStreaming`, or `isCompacting` → `working`
- alive but not running → `idle`

### `herdr-adapter.ts`

Reads Herdr state. First version can call the Herdr CLI with a short timeout. If Herdr later exposes a stable socket/client interface, only this adapter changes.

Requirements:

- Use a short timeout, around 800-1500ms.
- Return `health.herdr = "unavailable"` when the Herdr server is not running.
- Return `health.herdr = "error"` on timeout or parse failure.
- Never make `/api/runtime/status` fail just because Herdr is unavailable.

### `broadcaster.ts`

Owns the unified SSE subscription mechanism:

```ts
export function subscribeRuntimeStatus(listener: (snapshot: RuntimeStatusSnapshot) => void): () => void;
export function notifyRuntimeStatusChange(): void;
```

RPC state changes should trigger `notifyRuntimeStatusChange()`. Herdr state is polled only while there are active subscribers.

## API routes

Add:

```text
GET /api/runtime/status
GET /api/runtime/status/events
```

- `/api/runtime/status` returns a one-time snapshot.
- `/api/runtime/status/events` streams full `RuntimeStatusSnapshot` values by SSE.
- The SSE route sends an initial snapshot immediately and periodic updates while subscribed.
- Existing `/api/agent/running/events` remains available during migration.

## Session to Herdr matching

Match Herdr agents to pi-web sessions using explicit metadata only, in this priority order:

1. `agent-session-id` matches the pi-web session id.
2. `agent-session-path` matches the pi-web session file path.

Do not match by cwd in the first version. Matching by cwd risks marking the wrong session when multiple sessions share the same project directory.

Unmatched Herdr agents still appear in the Herdr panel as `unlinked`.

## Status merge rules

When RPC and Herdr both describe the same session, the unified status source is `merged`.

Priority:

```text
blocked > working > idle > done > unknown
```

Examples:

- RPC `working` + Herdr `idle` → `working`
- RPC `idle` + Herdr `blocked` → `blocked`
- RPC missing + linked Herdr `working` → `working`
- RPC only → RPC status
- Herdr unlinked → appears only in `herdrAgents`

`blocked` wins because it indicates user attention may be required.

## UI changes

### Session sidebar

Replace internal `runningSessionIds: Set<string>` usage with a map of session statuses:

```ts
sessionStatuses: Map<string, SessionRuntimeStatus>
```

Display behavior:

- `working`: keep the existing running animation.
- `blocked`: show an attention indicator, such as an orange dot or warning state.
- `idle`, `done`, `unknown`: stay visually quiet unless a detail view is open.

### Herdr agents panel

Add a read-only panel that lists Herdr agents/panes:

```text
Herdr
  ● pi-main       working
  ! pi-review     blocked
  ○ terminal-3    idle
```

Each row shows status, label, and any known session link. First version does not send input, focus panes, read output, or close panes.

## Error handling

- Herdr server not running: return `health.herdr = "unavailable"`; pi-web continues to work.
- Herdr timeout: return `health.herdr = "error"`; keep RPC-derived session statuses.
- Herdr parse failure: return `health.herdr = "error"`; do not throw to UI routes.
- SSE disconnect: rely on browser EventSource reconnect behavior.
- RPC adapter failure: treat as a server bug and surface through normal route error handling, because RPC status is local process state.

## Testing strategy

Use pure logic tests where possible. Do not require a real Herdr server in normal tests.

### Merge tests

Test status merge logic:

- RPC `working` + Herdr `idle` returns `working`.
- RPC `idle` + Herdr `blocked` returns `blocked`.
- RPC-only session returns RPC status.
- Linked Herdr-only session creates a session status.
- Unlinked Herdr agent appears only in `herdrAgents`.

### Herdr adapter tests

Test adapter behavior with injected command execution:

- Connection refused / server unavailable returns `health.herdr = "unavailable"`.
- Timeout returns `health.herdr = "error"`.
- Valid Herdr output parses expected agent statuses.
- Unknown Herdr state maps to `unknown`.

### API smoke tests

- `/api/runtime/status` returns 200 when Herdr is unavailable.
- Response contains `health.herdr`.
- SSE route emits an initial snapshot.

## Implementation phases

### Phase 1: Snapshot module and route

- Add `lib/runtime-status/*`.
- Add `/api/runtime/status`.
- Add tests for merge logic and Herdr unavailability.
- No UI changes yet.

### Phase 2: Unified SSE and sidebar migration

- Add `/api/runtime/status/events`.
- Connect RPC notifications to runtime-status broadcasts.
- Migrate `SessionSidebar` from running ids to session status map.
- Keep `/api/agent/running/events` temporarily.

### Phase 3: Read-only Herdr agents panel

- Add a simple Herdr agents panel.
- Show linked/unlinked agent status.
- Do not add control actions.

### Phase 4: Optional future controls

After status-only behavior is stable, consider explicit user actions for focus, read recent output, send input, or stop panes. Those actions require separate design because they are destructive or side-effectful.

## Deployment notes

Development should not affect the current phone web session. Avoid `npm run build` and `launchctl kickstart -k gui/$(id -u)/com.voiduplink.pi-web-agegr` until the user approves deployment. Source edits and verification commands are safe while production continues serving the existing `.next` build.
