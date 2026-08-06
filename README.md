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

| File                     | Purpose                                                           |
| ------------------------ | ----------------------------------------------------------------- |
| `Code.gs`                | All server-side logic: config, Ads API queries, audit, Sheet I/O, deck builder, prompts. |
| `Index.html`             | Self-contained dashboard template (`createTemplateFromFile`).     |
| `appsscript.json`        | Manifest: OAuth scopes, runtime, and web-app deployment config.   |
| `prompts/lockhern-deck.md` | The house prompt for turning the audit into a Lockhern-branded, client-ready deck. |

## The Lockhern layer

This audit is opinionated. It argues the strategy from the talk **"Demand Gen for
people who don't like Demand Gen"**: Demand Gen is a social/creative full-funnel
play, not search — judge it on the 25–100% completion funnel, view-through,
attributed brand search, brand lift and cost-per-quiz/email, not just last-click
purchases; set Add to Cart and Begin Checkout to Primary on purpose; creative and
landing pages are the levers.

That POV and the Lockhern brand are woven through the tool:

- **`BRAND`** (top of `Code.gs`) — the palette, type, and logo data-URIs, read by
  the dashboard, the Slides deck theme, and the deck prompt. One place to edit.
- **`POV`** — the thesis, principles, measurement lens and expectations, quoted
  verbatim by the analysis prompt, the brief, and the deck prompt.
- **Storyboard tab** (dashboard → **Deck**) — every planned client-deck slide as a
  reviewable card *before any `.pptx` exists*. Add an **emphasis note** to any
  slide; it saves to the `Commentary` sheet (via `saveNote`) and flows into both
  the exported deck and the deck-design prompt as a focal point for Claude.
- **One-page creative scorecard** — creatives render as a single scorecard
  (thumbnail · advertiser vs *Enhanced by Google AI* · impressions · view rate ·
  the 25/50/75/100% funnel · conversions · view-through), **not one slide per
  video**. It spills to a second page only past `DECK.CREATIVE_ROWS_PER_PAGE`
  rows. Per-video detail is an opt-in appendix — set
  `DECK.SECTIONS.creativeDetail = true`.

### Settings: honest pulls + manual overrides

The API does not expose every Demand Gen setting, and some (location, language,
audiences) are set at the **ad group**, not the campaign. So the Settings view:

- Pulls what the API reliably gives (bidding + target, budget, conversion goals,
  new-vs-existing, schedule, campaign-level locations/languages/exclusions).
- Never fabricates asset-optimization states — a toggle is ON/OFF only when the
  API reports it; otherwise it reads **Review** and you set it inline.
- Lists the settings the API can't confirm (view-through optimization, product
  feeds, GDN, devices, third-party measurement, IP exclusions, URL options,
  brand guidelines) under **Verify in platform**, each with a field to record
  the true value.
- Adds an **Ad group settings** view (Structure → Ad group settings) with each
  ad group's location, language and list targeting.

All manual entries (`saveOverride`) persist to a hidden `_overrides` sheet and
flow into both the deck and the analysis brief. Campaigns sort enabled-first,
then by spend.

**Ground truth (paste or screenshot).** The Settings view has a "Ground truth"
box: paste the campaign and ad-group settings copied from Google Ads, and it
saves as the authoritative source. Even simpler, when you build the deck you can
drag the settings screenshots straight into the Claude chat, the deck prompt
tells Claude to treat any attached settings screenshots or pasted text as truth
and correct anything the API read wrong (e.g. conversion goals). Unconfirmed
settings are omitted from the deck rather than shown as a loud "review".

### The deck flow

1. **Build slide deck** (header button) → a rough, on-brand Google Slides deck
   built from the cached pull. When it finishes, the dashboard prints the exact
   next steps.
2. Export the rough deck: **File → Download → Microsoft PowerPoint (.pptx)**.
3. **Download data (.xlsx)** (header button) → one-click export of the full data
   Sheet as a real `.xlsx` (uses the `drive.readonly` scope). This is the
   authoritative dataset for the build.
4. Screenshot each campaign's settings, the ad-group settings, and the ad-group
   audience (inclusions + exclusions) in Google Ads.
5. **Copy deck design prompt** → a per-account, Lockhern-branded prompt carrying
   the POV, brand system, findings, storyboard notes, landing pages, and a
   machine-readable creative appendix.
6. In **Claude (Opus)**, paste the prompt and attach the `.pptx`, the `.xlsx`,
   the screenshots, and the logo files → the polished, client-ready branded deck.
   See `prompts/lockhern-deck.md`.

## Brand assets (logos)

`BRAND.logoColor`, `BRAND.logoWhite`, and `BRAND.logoMark` in `Code.gs` are empty
data-URI slots. Until they're filled, the dashboard header and deck fall back to a
brand-coloured wordmark — nothing breaks. To embed the real logo, paste each file
as a base64 data URI (e.g. `data:image/png;base64,iVBORw0K...`) into the matching
slot. The dashboard reads them via the `brand` template variable; the deck decodes
them for the title and closing slides.

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

## Reporting window

Defaults to the **last 90 days** (a single month is usually too short to read
Demand Gen, which builds signal and whose view-through and brand effects lag).
Change it in the **Settings tab → "Days to report"** (30, 60, 90, 180, 365 all
work), then run `refresh`. With `Compare with prior period` on, the deck also
pulls the preceding window of equal length for deltas. Note: re-running `setup()`
only adds missing settings, so an existing sheet keeps its current value. Edit
the cell directly to change it.

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
