# Herdr-owned sessions are writable only with bridge capability

Pi-web distinguishes three runtime forms:

1. **pi-web-managed** — legacy/explicit fallback sessions. Pi-web owns an in-process RPC runtime and keeps full composer, voice, Steer, Follow-up, Abort, Compact, and extension UI behavior.
2. **Herdr TUI-owned** — Herdr owns a pane running plain Pi TUI. Pi-web can create, focus, bind, and display these sessions, but they stay read-only because no safe semantic command ingress exists.
3. **Herdr bridge-owned** — Herdr owns a `pi-web-rpc-bridge` process, the bridge owns `pi --mode rpc` stdin/stdout, and pi-web sends guarded commands to the bridge socket.

Read-only Herdr UI applies to Herdr TUI-owned sessions and to any Herdr-owned session where bridge capability is missing, stale, or not proven for the exact selected session. The composer for those sessions stays disabled with a clear explanation and a `Focus Herdr agent` action.

Bridge capability is proven only when pi-web has exact Session Binding for the selected session plus a live bridge registry/socket guarded by matching `sessionId` and/or `sessionFile`. Cwd, latest-session-file, and timestamp guesses are not valid.

Once bridge capability is present, pi-web may enable composer controls supported by the bridge protocol. Unsupported controls remain hidden or disabled until bridge parity exists.

Terminal-keystroke fallback remains rejected. Pi-web must not route chat commands through `herdr agent send`, `pane send-text`, `pane send-keys`, `pane send-input`, `pane run`, or Enter simulation.

The single writer invariant remains: pi-web never starts a second runtime for a Herdr-owned session.
