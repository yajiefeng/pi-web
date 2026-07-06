# Herdr-owned sessions are read-only until the command API exists

Pi-web will first support creating, focusing, binding, and displaying Herdr-owned sessions, but will not send chat input to them until Herdr exposes the structured command API. The composer for a Herdr-owned session will be disabled with a clear explanation and a `Focus Herdr agent` action; this disabled state includes send actions, Steer/Follow-up, and voice input. This avoids terminal-keystroke semantics and prevents pi-web from accidentally starting a second in-process runtime for a Herdr-owned session.
