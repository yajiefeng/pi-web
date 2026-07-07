# New defaults to Herdr bridge-owned runtime

Pi-web's `+ New` action defaults to creating a Herdr-owned session. The target runtime for new Herdr sessions is the bridge architecture:

```txt
Herdr
  → pi-web-rpc-bridge
      → pi --mode rpc
```

The Herdr creation command starts `pi-web-rpc-bridge` in the selected cwd. The bridge then starts `pi --mode rpc`, owns Pi RPC stdin/stdout, exposes a local command socket, and reports status/session binding back to Herdr.

Creation still returns Herdr agent identity, not a promised session id. Pi-web immediately shows a Pending Herdr Session and watches runtime-status updates for that exact Herdr agent id until Herdr reports explicit Session Binding through `agent_session_id` or `agent_session_path`.

Pi-web does not infer the new session from cwd, timestamps, or the latest session file. Pi-web-created Herdr agents still use readable names such as `pi-web-<short-project-name>-<short-random>`.

If creation fails or no binding appears within 15 seconds, pi-web shows explicit `Focus Herdr agent` when available, `Try Herdr again`, and `Create web session instead` actions rather than silently falling back or automatically closing the Herdr pane.

Plain Pi TUI sessions remain supported for display/focus, but they are Herdr TUI-owned and stay read-only in pi-web unless explicitly migrated or restarted as bridge-owned sessions.

Terminal-keystroke fallback remains rejected. Pi-web must not route chat commands through `herdr agent send`, `pane send-text`, `pane send-keys`, `pane send-input`, `pane run`, or Enter simulation.

The single writer invariant remains: bridge-owned sessions are written only by the Herdr-owned Pi RPC process; explicit web fallback sessions are written only by the pi-web-managed runtime.
