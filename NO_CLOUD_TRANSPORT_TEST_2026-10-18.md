# COCKTAIL ROOM — verified no-Cloud transport, 2026-10-18

## Device-proven result
On an actual iPhone/Safari, the isolated test successfully:
1. Loaded an Apps Script `doGet` ping via callback-based JSONP.
2. Submitted a randomly generated, non-personal 128-bit test identifier via an HTTP POST with `mode:'no-cors'`.
3. Queried `doGet` for the identifier's presence in Apps Script's short-lived cache.
4. Received positive confirmation. Neither a Google Cloud Project nor OAuth was used.

Test source: `cocktail-room/tests/StandaloneTransportProbe.gs`; frontend: `cocktail-room-pwa/transport-test.html`.

## What it does NOT prove
- Sending personal records, access control, session integrity, server-side role permissions.
- Safe delivery on unreliable connections; a no-CORS response is **opaque**, so a successful `fetch` alone never proves a write.
- Long-term reliability, multi-device merge/conflicts, or automatic background operation on iOS.
- Secure production access using an anonymous web-app endpoint.

## Architecture direction (requires implementation + review)
- PWA: locally persist each edit in the encrypted IndexedDB store first; keep durable outbound operation IDs and retry queue.
- Transport: public Apps Script Web App may receive HTTPS POST; every production request must be authenticated and integrity-protected with per-device credentials, role checks, replay protection, validation and audit trail. Do NOT ship credentials in public GitHub JavaScript or URL query strings.
- Read-back/receipt: JSONP may provide only non-sensitive statuses in the test. A production result or private data must not be returned over an unauthenticated public JSONP URL. Design and verify a confidential read channel **before** enabling production queries.
- Idempotency: each client operation gets a stable unique ID; receiver confirms persisted operation ID after committing. Retry must not create duplicate orders/revenue.
- Concurrency: keep existing `crSyncPut` revisions, server-side locks and three-way merge; unresolved conflicting records stay blocked for owner/admin review.
- Offline: iPhone PWA remains usable without internet, retains pending changes and syncs when foregrounded again. iOS background sync while closed is not guaranteed.
- Device security: owner-approved provisioning and revocation, per-employee offline PIN with role restrictions; offline encryption key stays on device; the server never trusts a PIN or role claim without verification.
- Staging: use a separate test deployment and non-sensitive sample shift. Never point local `local-test-*` shifts at production Sheets.

## Current safety status
`StandaloneTransportProbe.gs` is ONLY an anonymous diagnostics script with no Google Sheets access. The production `Code.gs` still disables `doPost`; no real-data external API has been deployed. Existing shift data remains unaffected. The PWA blocks direct sync for `local-test-*` shifts.

**Do not open the production `doPost` route or remove owner authorization until the authenticated API and privacy review are complete.**
