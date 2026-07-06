# Herdr uses a structured command channel

Herdr is the default runtime owner for new sessions, but pi-web must preserve semantic agent commands such as prompt, steer, follow-up, abort, compact, and extension UI responses. We will route pi-web input to Herdr-owned sessions through a Herdr-provided structured command API instead of relying on terminal keystroke simulation or direct Pi process sockets. Pi-web will not add a terminal-keystroke fallback for prompt sending; Herdr-owned message routing waits for the formal Herdr command API.
