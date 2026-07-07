# pi-web voice + Herdr bridge acceptance checklist

Use this checklist to accept the completed pi-web voice input and Herdr-owned Pi RPC bridge work.

Do not run `npm run build`, restart production services, or deploy unless explicitly approved.

## Scope under acceptance

- Browser/mobile voice input in the chat composer.
- Server-side transcription with Doubao/Volcengine first and OpenAI fallback.
- New pi-web sessions defaulting to Herdr-owned bridge runtimes.
- Bridge-owned sessions supporting prompt routing, command parity, and extension UI.
- Existing Herdr TUI-owned sessions staying read-only until explicit migration.
- Explicit TUI-to-bridge migration with single-writer safety.

## Current code state

Latest pushed commits on `origin/main`:

- `c2aad5d` Harden Herdr bridge migration release checks
- `6d29592` Add explicit Herdr bridge migration
- `120897f` Add bridge command parity and extension UI
- `7841863` Enable composer for bridge-owned Herdr sessions
- `8f11c90` Route Herdr prompts through RPC bridge
- `a306af6` Start Herdr sessions through RPC bridge

GitHub issue status at handoff: no open issues in `yajiefeng/pi-web`.

## Automated verification already run

These checks passed locally before this document was written:

- `npm run test:herdr-agent-creation`
- `npm run test:herdr-bridge-migration`
- `npm run test:herdr-readonly-ui`
- `npm run test:herdr-pending-ui`
- `npm run test:herdr-pending-resolution`
- `npm run test:herdr-pending-timeout`
- `npm run test:herdr-rpc-bridge-architecture`
- `npm run test:herdr-bridge-routing`
- `npm run test:herdr-bridge-ui`
- `npm run test:pi-web-rpc-bridge`
- `npm run test:runtime-status`
- `npm run test:transcribe-api`
- `npm run test:voice-input-helpers`
- `npm run test:voice-input-recorder`
- `npm run test:voice-input-ui`
- `npm run test:mobile-input-font-size`
- `node_modules/.bin/tsc --noEmit`
- `npm run lint`

## Manual acceptance: voice input

### Mobile browser smoke test

- [ ] Open pi-web on a mobile browser.
- [ ] Confirm the microphone control is visible in the chat composer.
- [ ] Tap the microphone control and allow browser microphone permission.
- [ ] Confirm recording state shows clearly with stop control, elapsed timer, and active visual feedback.
- [ ] Speak a short prompt and stop recording.
- [ ] Confirm the composer enters a transcribing state.
- [ ] Confirm transcript text is appended to the draft and is not sent automatically.
- [ ] Edit the transcript and send it normally.
- [ ] Confirm normal text input still works after voice input.

### Voice failure modes

- [ ] Deny microphone permission and confirm the error explains how to recover.
- [ ] Try a silent or empty recording and confirm no blank prompt is inserted.
- [ ] Simulate transcription/network failure and confirm the existing draft is preserved.
- [ ] Confirm upload limit errors are clear.
- [ ] If testing credentials is safe, confirm Doubao/Volcengine is tried first and OpenAI fallback still works when Doubao is unavailable.

## Manual acceptance: new Herdr bridge sessions

- [ ] Select a project cwd in the sidebar.
- [ ] Click `+ New`.
- [ ] Confirm pi-web enters `Pending Herdr Session` instead of creating a fake local session id.
- [ ] Confirm the pending state shows Herdr creation and waits for Session Binding.
- [ ] Confirm Herdr starts a bridge-owned runtime, not plain Pi TUI.
- [ ] Confirm the bridge launches Pi RPC with `pi --mode rpc`.
- [ ] Once Session Binding appears, confirm pi-web opens the exact bound session.
- [ ] Confirm composer is enabled only after bridge capability/exact binding is present.
- [ ] Send a normal prompt from pi-web and confirm the agent responds.
- [ ] Confirm no terminal-keystroke fallback is involved.

## Manual acceptance: bridge command parity

In a bridge-owned Herdr session:

- [ ] Send a normal prompt.
- [ ] While the prompt is running, send a steer message.
- [ ] While the prompt is running, queue a follow-up message.
- [ ] Abort an active turn and confirm it stops safely.
- [ ] Run manual compaction and confirm result/error is shown.
- [ ] Open slash command palette and confirm `get_commands` data loads.
- [ ] Change model and confirm the command routes through the bridge.
- [ ] Change thinking level and confirm the command routes through the bridge.
- [ ] Toggle auto-compaction / auto-retry if visible and confirm no error.
- [ ] Trigger an extension UI request (`notify`, `select`, `confirm`, `input`, or `editor`) and confirm it appears in pi-web.
- [ ] Answer an extension UI request in pi-web and confirm the Pi RPC process continues.
- [ ] Trigger or simulate an unsupported extension UI method and confirm pi-web shows a clear error and cancels when possible instead of hanging.

## Manual acceptance: existing Herdr TUI-owned sessions

- [ ] Open an existing Herdr TUI-owned session in pi-web.
- [ ] Confirm it is read-only by default.
- [ ] Confirm the normal composer is not available.
- [ ] Confirm `Focus Herdr agent` is still available.
- [ ] Confirm command POSTs to that session are rejected instead of starting a second pi-web-managed runtime.
- [ ] Confirm pi-web does not infer ownership or routing from cwd/latest/timestamp matching.

## Manual acceptance: explicit migration to bridge

Use a non-critical session first.

- [ ] Open a read-only Herdr TUI-owned session.
- [ ] Confirm `Restart as bridge session` is visible.
- [ ] Click it and cancel the browser confirmation.
- [ ] Confirm no pane is closed and no bridge runtime is started.
- [ ] Click it again and read the confirmation copy.
- [ ] Confirm the copy explicitly says pi-web will stop the existing TUI runtime and preserve the single-writer rule.
- [ ] Confirm migration request includes the selected exact `sessionId`, selected exact `sessionFile`, exact old Herdr agent id, and `confirmStopOldAgent: true`.
- [ ] Confirm the server closes the exact old Herdr pane only after confirmation.
- [ ] Confirm the server refuses to start the bridge if the old writer still appears active.
- [ ] Confirm the server refuses to treat Herdr status unavailable/error as proof that the old writer is released.
- [ ] Confirm the new bridge runtime starts with `pi --mode rpc --session <selected-session-file>`.
- [ ] Confirm pending state waits for the new Herdr agent's exact Session Binding.
- [ ] Confirm composer is enabled only after the new bridge binding/capability is present.
- [ ] Send a prompt after migration and confirm the same session continues under bridge control.

## Failure-mode acceptance

- [ ] Herdr unavailable: pi-web should keep explicit web fallback available and show clear failure copy.
- [ ] Bridge registry missing/stale: Herdr-owned session should remain read-only.
- [ ] Session id/path mismatch: command/migration should fail with conflict-style error and must not forward to Pi RPC.
- [ ] Bridge child exited: pi-web should show bridge unavailable and must not silently start a second runtime.
- [ ] Migration old pane close failure: bridge must not start.
- [ ] Migration release timeout: bridge must not start.

## Production deployment gate

Only after explicit approval:

- [ ] Run the approved build command.
- [ ] Restart the approved pi-web service.
- [ ] Verify the deployed URL loads.
- [ ] Re-run a short browser smoke test for voice input.
- [ ] Re-run a short browser smoke test for new Herdr bridge session creation.
- [ ] Re-run a short browser smoke test for TUI read-only migration on a safe test session.

## Rollback notes

If a deployed regression appears, prefer reverting the latest pi-web commits in reverse order and redeploying only after approval:

1. `c2aad5d` Harden Herdr bridge migration release checks
2. `6d29592` Add explicit Herdr bridge migration
3. `120897f` Add bridge command parity and extension UI
4. Earlier bridge/runtime commits as needed

Do not manually edit private deployment configs, tokens, tunnels, LaunchAgents, or `.env*` files as part of rollback.
