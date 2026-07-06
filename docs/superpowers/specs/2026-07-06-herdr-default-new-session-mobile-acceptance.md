# Herdr default new-session mobile acceptance

Do not run `npm run build` or restart/deploy services for this checklist unless deployment is explicitly approved.

## Scope

Covers the mobile/browser-visible states for the Herdr-default `+ New` flow:

- Pending Herdr Session after `+ New`
- exact Session Binding resolution
- 15 second timeout actions
- Read-only Herdr Session
- Focus Herdr agent
- explicit `Create web session instead` fallback
- preserved pi-web-managed composer controls

## Mobile checklist

Use a mobile-width browser viewport or a real mobile browser.

1. Select a project directory in the sidebar.
2. Tap `+ New`.
3. Confirm the chat pane immediately shows `Pending Herdr Session`.
4. Confirm the pending copy says pi-web is starting a Herdr agent and `Waiting for Session Binding`.
5. When Herdr creation returns, confirm the Herdr agent label is shown without layout overflow.
6. If no binding appears within 15 seconds, confirm the timeout copy says `No Session Binding appeared within 15 seconds`.
7. Confirm timeout actions are visible and tappable without horizontal overflow:
   - `Focus Herdr agent` when an agent id is available
   - `Try Herdr again`
   - `Create web session instead`
8. Confirm tapping `Focus Herdr agent` does not close the Herdr pane.
9. Confirm tapping `Try Herdr again` starts a new Pending Herdr Session for the same cwd.
10. Confirm tapping `Create web session instead` opens the normal pi-web-managed composer.
11. In the pi-web-managed fallback composer, confirm these controls remain usable:
    - voice input button
    - `Send`
    - `Steer` while streaming
    - `Follow-up` while streaming
    - `Compact`
    - `Abort`
12. For a selected Herdr-owned session, confirm the composer is replaced by `Read-only Herdr Session`.
13. Confirm the read-only copy explains that the session is Herdr-owned and that web command routing is not available yet.
14. Confirm read-only mode shows `Focus Herdr agent`.
15. Confirm read-only mode does not show voice input, `Send`, `Steer`, or `Follow-up` controls.
16. Confirm existing mobile no-zoom input behavior still passes via `npm run test:mobile-input-font-size`.

## Source checks

Run:

```bash
npm run test:herdr-mobile-acceptance
npm run test:mobile-input-font-size
```
