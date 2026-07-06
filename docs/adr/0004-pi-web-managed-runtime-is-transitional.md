# Pi-web-managed runtime is transitional

Pi-web-managed sessions keep their current full capabilities during the Herdr migration so existing sessions and explicit web-session fallbacks remain usable. Once Herdr-owned sessions support the complete command surface through the structured command channel, pi-web's in-process runtime can be retired rather than kept as a permanent parallel runtime.
