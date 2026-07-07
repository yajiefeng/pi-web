# Herdr-owned Pi RPC bridge architecture

## Purpose

Pi-web should be the browser/mobile UI for Herdr-owned Pi sessions. Herdr should own process lifetime, pane identity, focus, and status. Pi-web should not maintain a Herdr fork, wait for Herdr core to understand Pi prompt semantics, or fake messages with terminal input.

The architecture is:

```txt
Herdr
  → pi-web-rpc-bridge
      → pi --mode rpc
      → local command socket
      → Herdr status/session reports

pi-web
  → bridge command socket
  → Pi RPC JSON protocol
  → Pi runtime writes the session
```

## Runtime forms

Pi-web must distinguish three runtime forms.

### Pi-web-managed

Pi-web starts and owns its existing in-process/RPC runtime. This path is the explicit web fallback and keeps full current behavior.

### Herdr TUI-owned

Herdr owns a pane running plain Pi TUI. Pi-web may create, focus, bind, and display the session, but it is read-only in pi-web because the only external input path is terminal bytes.

TUI-owned sessions can be inspected through `Focus Herdr agent`. They can be explicitly migrated or restarted as bridge-owned sessions, but pi-web must not silently do that migration.

### Herdr bridge-owned

Herdr owns a `pi-web-rpc-bridge` pane process. The bridge starts `pi --mode rpc`, owns Pi RPC stdin/stdout, exposes a local command socket, and reports status/session binding to Herdr. Pi-web can send supported commands once bridge capability and exact Session Binding are proven.

## Responsibilities

### Herdr

- Start the bridge process in the selected cwd.
- Own pane/process lifecycle.
- Keep the runtime alive independently of the browser.
- Provide terminal id, pane id, tab id, workspace id, and focus/inspect actions.
- Receive status and Session Binding reports from the bridge.

### Pi-web RPC bridge

- Start `pi --mode rpc` as a child process.
- Own JSONL stdin/stdout for Pi RPC.
- Expose a local command socket for pi-web.
- Maintain session metadata: `sessionId`, `sessionFile`, `cwd`, socket path, pid, bridge protocol version, and capabilities.
- Guard every command against the current exact session.
- Report Herdr status and Session Binding when Herdr pane metadata is available.
- Never write directly to the session jsonl.

### Pi-web

- Start Herdr bridge-owned sessions by asking Herdr to start the bridge.
- Resolve sessions only from explicit Herdr `agent_session_id` or `agent_session_path`.
- Route commands to the bridge only when the selected session exactly matches bridge metadata.
- Keep Herdr TUI-owned/no-bridge sessions read-only.
- Keep explicit pi-web-managed fallback sessions working.

## Exact Session Binding

Exact Session Binding remains mandatory. Valid binding inputs are:

- `agent_session_id`
- `agent_session_path`
- bridge registry metadata that matches the selected `sessionId` and/or `sessionFile`

Invalid binding inputs are:

- cwd/latest/timestamp matching
- newest session file in a directory
- focused pane in the same project
- most recently created Herdr agent

If session binding is missing, stale, or mismatched, pi-web must refuse command routing.

## Command routing rules

Bridge command requests should include:

```json
{
  "id": "client-command-id",
  "expectedSessionId": "...",
  "expectedSessionFile": "...jsonl",
  "command": {
    "type": "prompt",
    "message": "hello"
  }
}
```

Bridge responses should be structured enough for pi-web to distinguish accepted, rejected, session mismatch, unsupported command, child exited, and Pi RPC error states.

The first writable slice is `prompt`. Later slices add Steer, Follow-up, Abort, Compact, model/thinking/tools controls, and extension UI forwarding.

## Forbidden paths

Terminal-keystroke fallback remains rejected. Pi-web must not route chat commands through:

- `herdr agent send`
- `pane send-text`
- `pane send-keys`
- `pane send-input`
- `pane run`
- Enter simulation
- direct writes to the session jsonl
- a second pi-web-managed runtime for a Herdr-owned session

These restrictions preserve the single writer invariant.

## Migration from Herdr TUI-owned sessions

Existing Herdr TUI-owned sessions stay read-only by default. A migration must be explicit because the old TUI Pi process and the new bridge-owned Pi RPC process could otherwise write the same session file.

A safe migration flow must:

1. Start from the selected exact session id/path.
2. Identify the exact Herdr agent binding for the old TUI runtime.
3. Require explicit user confirmation before stopping/replacing the old runtime.
4. Start a new bridge-owned Herdr runtime for the same session file only after the old writer is stopped or otherwise proven safe.
5. Wait for the new Herdr agent to report `agent_session_id` or `agent_session_path`.
6. Enable composer only after the new bridge capability and exact binding are present.

Pi-web must not infer migration targets from cwd/latest/timestamp matching.

## Failure behavior

- Herdr unavailable: keep explicit web fallback available.
- Bridge unavailable or stale: keep the Herdr session read-only and offer focus/retry where appropriate.
- Session mismatch: reject the command and do not send.
- Bridge child exited: show bridge unavailable; do not start a pi-web-managed runtime implicitly.
- Unsupported command: disable or hide that control until bridge parity exists.

## Testing seams

Preferred regression seams:

- Source-level architecture checks for forbidden terminal fallback terms.
- Bridge command-runner tests with fake Pi RPC child stdio.
- Herdr creation command construction tests.
- Runtime-status tests for bridge capability and exact binding.
- Route tests for prompt success, no bridge, stale bridge, and session mismatch.
- UI checks for pi-web-managed, Herdr TUI-owned read-only, and Herdr bridge-owned writable states.

## Success criteria

- New Herdr sessions start bridge-owned runtime rather than plain Pi TUI.
- Bridge-owned sessions can accept pi-web prompt commands through Pi RPC.
- Herdr TUI-owned sessions remain read-only unless explicitly migrated.
- Explicit web fallback remains fully functional.
- No command routing uses terminal keystrokes.
- The single writer invariant is preserved for every session.
