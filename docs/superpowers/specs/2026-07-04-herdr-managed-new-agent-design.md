# Herdr-Managed New Agent Design

## Issue

Pi-web currently has two different ways an agent/session can exist:

1. **Pi-web-managed sessions**
   - Created from the sidebar `+ New` flow.
   - The browser sends messages to the Next.js server.
   - The server starts and drives an in-process `AgentSession`.
   - Runtime state comes from pi-web's RPC registry.

2. **Herdr-managed Pi agents**
   - Created by Herdr in a terminal pane.
   - The terminal `pi` process creates or opens its own session file.
   - The Herdr integration reports `idle`, `working`, `blocked`, and session metadata.
   - Runtime state comes from Herdr.

The desired direction is to manage new work through Herdr only. In that model, `+ New` should create a Herdr-managed Pi agent instead of a pi-web-only session.

The blocker is message routing: pi-web can currently discover, focus, and link Herdr agents, but the chat input still primarily drives pi-web's in-process `AgentSession`. If `+ New` is replaced before routing is redesigned, a user could create a Herdr agent and then accidentally start a separate pi-web-managed session by sending a message from the web chat.

## Goal

Make Herdr the default runtime for new sessions, while keeping pi-web as the browser UI for browsing sessions, monitoring status, and sending messages.

The final user experience should be:

1. User clicks `+ New` in pi-web.
2. Pi-web starts a Herdr-managed `pi` agent in the selected project directory.
3. Herdr focuses the new agent.
4. The agent reports its session path/id through Herdr metadata.
5. Pi-web opens the linked session.
6. Messages typed in pi-web go to that Herdr-managed agent, not to a separate in-process `AgentSession`.

## Non-Goals For The First Implementation

- Do not remove the existing pi-web-managed session path until Herdr routing is proven stable.
- Do not infer session binding from cwd.
- Do not add destructive Herdr actions such as stop/close pane.
- Do not expose private deployment, host, or environment details in docs, code, or tests.

## Current State

Implemented pieces:

- Runtime status combines pi-web RPC status and optional Herdr agent status.
- Herdr agent list parsing supports real Herdr JSON output.
- Herdr `agent_session` metadata can bind an agent to a pi-web session by path.
- The Herdr sidebar panel can be made clickable to focus a Herdr agent and open the linked session.

Missing pieces:

- A pi-web API endpoint to start a new Herdr-managed Pi agent.
- A UI flow that exposes Herdr new-agent creation from the existing `+ New` entry point.
- A routing rule for web chat input when the selected session is Herdr-managed.
- A safe fallback when Herdr is unavailable.

## Proposed Phased Plan

### Phase 1: Add Herdr Agent Creation Beside Current `+ New`

Keep the current `+ New` behavior available, but add a Herdr option near the same entry point.

Possible UI:

- Change `+ New` into a split button or small menu:
  - `New Herdr agent`
  - `New web session`
- If Herdr is unavailable, disable `New Herdr agent` and keep `New web session` available.

Server behavior:

- Add `POST /api/runtime/herdr/agents`.
- Input: selected `cwd` and optional display name.
- Validate that `cwd` is an allowed project/session directory using existing cwd validation rules.
- Call Herdr to start a Pi agent, equivalent to:

```bash
herdr agent start <name> --cwd <cwd> -- pi
```

- Return the Herdr agent id and initial status.
- Poll or subscribe until the agent reports `agent_session` metadata, then return or let the existing runtime-status SSE update the UI.

Acceptance:

- Creating a Herdr agent from pi-web shows a new Herdr row.
- The new row transitions from `unknown`/startup to `idle` after Pi is ready.
- Once linked, pi-web opens the corresponding session.

### Phase 2: Mark Sessions By Runtime Owner

Pi-web needs to know whether a selected session is driven by:

- `rpc` / pi-web in-process runtime
- `herdr` / terminal-managed runtime
- `merged` / both sources observe the same session

The existing runtime status model already has `source` and `herdrAgentId`. Build on that rather than adding a separate ownership system.

Acceptance:

- A selected session with `herdrAgentId` is treated as Herdr-managed.
- A selected session without `herdrAgentId` keeps current RPC behavior.

### Phase 3: Route Chat Input To Herdr For Herdr-Managed Sessions

When the selected session is Herdr-managed, pi-web should not start an in-process `AgentSession` for that session.

Instead:

- Send browser input to a new server endpoint that targets the linked Herdr agent.
- The server calls Herdr send/submit operations for that agent.
- Pi-web reads the session file and runtime SSE updates to display progress.

Open design question:

- Whether streaming UI should continue to rely on session-file refresh/runtime status, or whether pi-web should also consume Herdr pane output directly for lower latency.

Acceptance:

- Typing into pi-web on a Herdr-managed session sends the message to the terminal Pi agent.
- No duplicate pi-web-managed `AgentSession` is created for that session.
- Status changes show as `working` and then `idle`/`blocked` through Herdr.

### Phase 4: Make Herdr The Default `+ New`

After creation and message routing are stable:

- Make `+ New` default to `New Herdr agent` when Herdr is healthy.
- Keep `New web session` as a fallback/advanced option.
- If Herdr is unavailable, fall back to the current pi-web-managed flow.

Acceptance:

- Normal users can rely on Herdr for new work.
- Existing pi-web-managed sessions remain readable and usable.
- Herdr downtime does not make pi-web unusable.

## Risks

### Duplicate Sessions

If routing is incomplete, a user might create a Herdr session and then accidentally create a second pi-web-managed session from the same web chat. This is the main reason not to replace `+ New` immediately.

### Ambiguous Binding

Multiple sessions can share the same cwd. Pi-web must continue to bind only by explicit Herdr metadata (`agent_session_id` or `agent_session_path`), never by cwd guessing.

### Mobile UX Complexity

A split button or menu must remain easy to use on mobile. The default action should be clear, and unavailable Herdr actions should show a short reason.

### Optional Herdr Dependency

Pi-web should still work when Herdr is not installed or not running. Herdr features should degrade to disabled/unavailable states instead of breaking the app.

## Recommended Next Step

Implement Phase 1 first: add `New Herdr agent` as an option beside the existing `+ New`, not as a replacement. This validates creation, focus, and linking without changing message routing. After that works reliably, implement Herdr-managed chat routing and only then make Herdr the default `+ New` behavior.
