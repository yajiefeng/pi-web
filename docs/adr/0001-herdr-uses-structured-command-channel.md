# Herdr-owned command routing uses a Pi RPC bridge

Herdr is the default runtime owner for new sessions, but pi-web must preserve semantic agent commands such as prompt, steer, follow-up, abort, compact, and extension UI responses. We will route pi-web input to Herdr-owned sessions through a pi-web-owned `pi-web-rpc-bridge`, not through Herdr terminal keystrokes and not through a second pi-web-managed runtime.

The bridge is started by Herdr, starts `pi --mode rpc`, owns Pi RPC stdin/stdout, exposes a local command socket to pi-web, and reports status/session binding back to Herdr. Herdr core remains responsible for pane/process ownership, focus, lifecycle, and status registry. Herdr core does not need to understand prompt semantics.

This replaces the earlier idea that Herdr core itself must provide the Structured Command Channel. The structured command seam is now the bridge socket plus Pi RPC protocol.

Terminal-keystroke fallback remains rejected. Pi-web must not route chat commands through `herdr agent send`, `pane send-text`, `pane send-keys`, `pane send-input`, `pane run`, or Enter simulation.

The single writer invariant still holds: a session is written by either the Herdr-owned Pi RPC process or by an explicit pi-web-managed fallback runtime, never both.
