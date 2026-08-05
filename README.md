# Demand Gen Audit

An **Apps Script + Google Ads API** audit tool for Google Ads Demand Gen
campaigns. It runs entirely on **read-only** Google Ads access — the API permits
reads for read-only users, and nothing here mutates. Results are written to a
Google Sheet and served through a self-contained HTML dashboard (a real web-app
URL, via `HtmlService`).

## Why Apps Script instead of a Google Ads Script

Google Ads Scripts require Standard or Admin access to create. Apps Script does
not, because the permission check happens in the Ads API against your OAuth
identity. Apps Script also gains `HtmlService`, so the dashboard is a real URL
rather than a file you have to host yourself.

## Files

| File               | Purpose                                                            |
| ------------------ | ----------------------------------------------------------------- |
| `Code.gs`          | All server-side logic: config, Ads API queries, audit, Sheet I/O. |
| `Index.html`       | Self-contained dashboard template (`createTemplateFromFile`).     |
| `appsscript.json`  | Manifest: OAuth scopes, runtime, and web-app deployment config.   |

## Setup

1. `sheets.google.com` → new sheet → **Extensions → Apps Script**.
2. Create three files matching this bundle: `Code.gs`, `Index.html`, and the
   manifest. For the manifest, click the gear icon → **"Show appsscript.json
   manifest file in editor"**, then replace its contents with `appsscript.json`.
3. Fill in `CONFIG` in `Code.gs`. Everything there is only a fallback — live
   values come from the **Settings** tab of the spreadsheet and from **Script
   Properties**, so switching clients never means editing the file. Run
   `setup()` once to create the Settings tab.
   - Script Property `DEVELOPER_TOKEN` — kept out of the spreadsheet so sharing
     the Sheet never leaks it.
   - Script Property `LOGIN_CUSTOMER_ID` — your manager (MCC) account, needed
     only when you reach the client account through an MCC.
   - Customer IDs are digits only — no hyphens.
4. Run `installTrigger` once. Approve the consent screen, which asks for Google
   Ads access — this is the step that binds your read-only identity.
5. Run `refresh` manually to confirm a clean pull.
6. **Deploy → New deployment → Web app.**
   - Execute as: **Me**
   - Who has access: see **Sharing** below.

## Sharing

`Execute as: Me` is required — it makes the web app use your Ads access, so the
client never needs a Google Ads seat. But that also means anyone who can open
the URL sees the data. Prefer **"Anyone with Google account"** over **"Anyone"**
so access is at least tied to an identity, and treat the URL as a credential.
For a named client, **"Anyone within &lt;your domain&gt;"** plus a PDF export is
usually the cleaner handoff.

## Execution limits

Apps Script allows 6 minutes per execution on consumer accounts and 30 on
Workspace. A pull runs roughly 15 queries plus asset resolution. If you hit the
ceiling:

1. Set `SKIP_PLACEMENTS` true first — placement reporting is the heaviest and
   least reliable slice for Demand Gen.
2. Then narrow `LAST_N_DAYS`.

## Notes

- **API version** is pinned in `CONFIG.API_VERSION` (currently `v25`). A `404`
  from the API usually means the version has been sunset — bump it.
- **"Conversions"** counts only actions included in the Conversions column for
  bidding; **"All conv."** counts every tracked conversion action.
- View-through conversions are reported separately and are **not** included in
  the Conversions figure.
