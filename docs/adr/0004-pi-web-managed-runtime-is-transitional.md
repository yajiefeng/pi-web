# Pi-web-managed runtime is transitional

Pi-web-managed sessions keep their current full capabilities during the Herdr migration so existing sessions and explicit web-session fallbacks remain usable. They are not the long-term parallel runtime for sessions that Herdr owns.

The migration target is Herdr bridge-owned runtime: Herdr starts `pi-web-rpc-bridge`, the bridge starts `pi --mode rpc`, and pi-web sends semantic commands to the bridge socket. Once bridge-owned sessions support the complete command surface, pi-web's in-process runtime can be retired rather than kept as a permanent parallel runtime.

Herdr TUI-owned sessions remain read-only unless explicitly migrated or restarted as bridge-owned sessions. This prevents two writers from touching one session file.

Terminal-keystroke fallback remains rejected. Pi-web must not route chat commands through `herdr agent send`, `pane send-text`, `pane send-keys`, `pane send-input`, `pane run`, or Enter simulation.

The single writer invariant remains the guiding rule for retiring the transitional runtime.
