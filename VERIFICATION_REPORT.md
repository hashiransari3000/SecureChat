# SecureChat verification report

Packaging verification completed on 2026-08-30.

## Passed
- Backend: every `src/**/*.js` file passed `node --check`.
- Backend controller modules loaded successfully against the supplied dependency set (with system Sharp) without module-scope exceptions.
- Frontend: all 24 `src/**/*.js` / `src/**/*.jsx` files parsed with zero JSX syntax diagnostics using the TypeScript parser.
- No unresolved relative imports were found across frontend/backend source trees.
- Route/controller references were checked and every referenced controller export exists.
- Conversation-event controller values match the Mongoose enum, including group create/join/leave events.
- Privacy appearance `theme` is now accepted by the backend settings allowlist.
- Pending group members are excluded from message delivery and historical group messages sent before acceptance are not returned after joining.
- Pending direct-request recipient photo is hidden from the requester until acceptance.
- Profile avatar bytes are no longer exposed through a public static directory; the authenticated endpoint re-checks current visibility/block rules.
- E2EE key envelopes are scoped by both user ID and device ID; local device IDs are account-scoped.
- Account wipe removes this browser's local E2EE identity and user-specific local privacy state after server deletion succeeds.
- Voice-note duration uses recording start time rather than a stale React state closure.
- Accessibility preference updates are excluded from the message auto-scroll trigger.

## Environment limitation
A clean Vite production build could not be completed inside the packaging container because npm registry access is unavailable and the original uploaded `node_modules` contains platform-specific optional Rolldown binaries that do not match this Linux container. Those dependencies are intentionally excluded from the final ZIP. On the target Windows computer, run `npm install` in both backend and frontend folders before `npm run dev`.

This report is a verification record, not a claim that an academic prototype has undergone an external professional security audit.
