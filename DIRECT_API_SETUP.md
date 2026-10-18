# COCKTAIL ROOM — direct Google API transport (NOT DEPLOYED)

The previous Google Apps Script HTMLService popup bridge is blocked in Chrome: login succeeds but postMessage does not reliably reach GitHub Pages.

## New file
`apps-script-api-client.js` contains an isolated Google Identity Services OAuth token flow and a direct HTTPS call to the Apps Script Execution API (`scripts.run`). It is NOT yet wired to production or enabled for real data. Only crWebTestHealth, crSyncGet, crSyncPut are permitted client-side. Actual authorization MUST be rechecked in Apps Script.

## Required Google configuration (not available from repository)
1. Link the existing Apps Script to a standard Google Cloud project.
2. Enable Google Apps Script API for that project; deploy the Apps Script project as an API executable.
3. Configure the Google OAuth consent screen (test users first).
4. Create a **Web application** OAuth client permitting the exact PWA origin `https://issataevun-sys.github.io`.
5. Obtain OAuth CLIENT ID and Script ID (not secrets). Do NOT commit a client secret, Google refresh token, owner password or service-account key to public GitHub.
6. Ensure requested OAuth scopes match the script's actual scopes; `spreadsheets` alone may be insufficient. The existing code checks the owner on the server.
7. Test `crWebTestHealth` first, then only fake shift reads and writes, revision conflicts, actual offline recovery, and browser reloads. Do not enable for actual guests beforehand.

The new transport removes the dependency on window.opener, but is not operational without this Google Cloud setup. Existing Google Sheets and existing Apps Script deployment remain untouched.
