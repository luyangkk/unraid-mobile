# Website palette and gradient implementation plan

Spec: [website-themes-design](../specs/2026-10-25-website-themes-design.md).

Work in the existing `feat/unraid-official-themes` checkout. Preserve unrelated untracked validation evidence. At theme implementation completion, changes stayed uncommitted for review. The user's subsequent separate instruction authorizes committing, pushing, and manually publishing this development branch as GHCR latest; host changes remain excluded.

1. Update palette, bootstrap, and browser acceptance expectations; verify website palette and variants. Remove numeric contrast gates per the user's correction. Run the targeted tests before implementation and retain the expected failures.
2. Replace semantic palette bases. Synchronize head/runtime/manifest colors and build/image verifiers. Apply website gradients to shared Buttons, brand identity, and selected navigation. Run targeted tests.
3. Run `npm ci`, full `npm test`, and `npm run build`. Extend existing production Chrome acceptance to check CSS hover movement, focus, disabled, Slot links, touch, and reduced-motion without a new dependency. Run page/Portal/session/transition/PWA checks.
4. Request one independent review of the working diff, resolve material findings, and write source, verification, and limitations evidence.

Review focus: website-style masked border and full flowing fill must remain behind text/icons; hover must stop on exit, disabled state, and reduced-motion; stored themes and live CSS must match manifest/metadata; no cache, API, navigation, or SSE lifecycle changes. Numeric contrast limits were explicitly canceled by the user.

## Execution record

- Source inspection completed before implementation. Website rules and browser-computed colors are recorded in the spec.
- First draft passed 32 targeted and 402 full tests. Chrome exposed a disabled-to-enabled color interpolation mismatch against that draft's strict contrast goal.
- User correction: prioritize website fidelity and remove contrast requirements. Updated fidelity tests failed in three expected places before replacing black resting text / derived orange text / variants.
- User Chrome confirmed authenticated host White-theme CSS. Curl's unauthenticated redirect was not representative of the browser session.
- Final: 399 frontend tests and production/PWA build passed; 10 production Chrome checks / 73 assertions passed. Independent review found no material issues. Real worker browser installation remained unverified; detailed limitations are recorded in `docs/validation/2026-10-25-website-themes.md`.
