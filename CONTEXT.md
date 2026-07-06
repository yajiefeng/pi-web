# Pi Web

Pi Web is the browser and mobile control surface for Pi agent sessions. It reads durable Pi session files, displays runtime status, and routes user input to the runtime that owns the selected session.

## Language

**Runtime Owner**:
The single runtime allowed to write to a Pi session at a time. New sessions should be Herdr-owned by default; pi-web's in-process runtime is a fallback or legacy owner.
_Avoid_: Dual writer, active source

**Herdr-owned Session**:
A Pi session whose active agent process is managed by Herdr in a terminal pane. Until Herdr provides the structured command channel, pi-web may create, focus, bind, and display it, but must not send chat input to it or start a second in-process agent for the same session.
_Avoid_: Terminal session, external session

**Pi-web-managed Session**:
A legacy Pi session whose active agent process is started and driven inside the pi-web server process. It remains fully capable during migration, but can be retired once Herdr-owned sessions support the complete command surface.
_Avoid_: Normal session, local session

**Session Binding**:
The explicit link between a Herdr agent and a Pi session, identified by `agent_session_id` or `agent_session_path`. Pending Herdr Session resolution only watches the agent id returned by creation and must not infer a binding from cwd or creation time.
_Avoid_: cwd match, project match, latest session guess

**Structured Command Channel**:
The semantic message path pi-web uses to send agent commands such as prompt, steer, follow-up, abort, and compact to a Herdr-owned session. Herdr provides this command API so pi-web addresses Herdr agents rather than individual Pi process sockets or terminal keystrokes.
_Avoid_: Keyboard simulation, terminal text hack, direct Pi process socket

**Read-only Herdr Session**:
A Herdr-owned session displayed in pi-web before the structured command channel is available. The composer, send actions, and voice input are disabled, and the user is directed to focus the Herdr agent pane to continue sending messages.
_Avoid_: Broken chat, disabled session

**Pending Herdr Session**:
The temporary pi-web state shown after `+ New` starts a Herdr agent but before Herdr reports a session binding. It is not a real Pi session; after 15 seconds without a binding, pi-web shows explicit retry and web-session fallback actions instead of silently falling back.
_Avoid_: Fake session, temporary session id

**Pi-web Herdr Agent Name**:
The display name pi-web assigns when starting a Herdr agent, formatted as `pi-web-<short-project-name>-<short-random>`. It identifies pi-web-created agents without exposing full paths or requiring names to be unique by cwd.
_Avoid_: Full cwd name, generic pi name
