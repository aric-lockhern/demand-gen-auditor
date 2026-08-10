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

### Audience validation: brand vs Demand Gen (deck slide 10)

The audit can judge where Demand Gen spends against where the brand actually
earns. In the dashboard, **Audience → Audience validation**:

- **Load campaigns** runs a live pull of every campaign in the account (all
  channels, not just Demand Gen), so you can pick the **brand benchmark**.
- Pick **one** campaign, **several**, or tick **Whole account** (all non Demand
  Gen campaigns). The usual benchmark is a branded Search campaign.
- **Compare demographics** pulls brand revenue and Demand Gen spend by age and
  gender, and computes each band's brand-revenue share, DG-spend share, an
  **index** (spend share ÷ revenue share — above 1.0 is over-spend relative to
  where the brand earns, below 1.0 is under-spend), and **brand ROAS**.

The selection and the computed comparison persist per account (in `_overrides`)
and flow into both the rough deck's audience-validation slide and the deck
prompt, so the branded rebuild renders the same figures. Backed by
`listAllCampaigns` and `buildBrandComparison`, which set the account context
themselves and so are safe to call straight from the dashboard.

### Locked 12-slide house format

The deck prompt is locked to a fixed **12-slide** house format (title, the lens,
executive summary, then the interleaved buckets: settings, structure, video
performance, video and content, the destination, audience, audience validation,
surfaces, and the closing "one thing"). Set **Settings tab → "Template deck
Drive ID"** to the FINAL reference deck (an uploaded `.pptx` or a Google Slides
file, shared with this account) and the build bundle includes it as
`template-reference.pptx`; the prompt tells Claude to match it slide for slide so
the output is the same deck every time, only the numbers changing.

### Strategy mode: no Demand Gen yet

When an account does not run Demand Gen, there is nothing to audit. **Strategy
mode** instead mines the rest of the account (all non Demand Gen campaigns) for a
**launch plan**. It is a per-account manual toggle in the dashboard under
**Launch → Strategy mode**:

- Tick **Strategy mode for this account** (persists per account).
- **Build launch recommendation** runs live queries and surfaces:
  - **who already buys** (revenue by age and gender),
  - the **full audience list inventory** (every remarketing and customer-match
    list, flagged for likely purchasers/customers to exclude and lists to seed
    from, with sizes), plus the audiences already converting,
  - converting **search themes** to seed custom-intent audiences,
  - the **conversion actions** the account tracks (what DG can optimise toward,
    and any missing mid-funnel action),
  - the **creative inventory** (how many YouTube video assets exist, i.e. the
    DG creative gap) and the best existing ads to repurpose,
  - where the account **converts today** (landing pages), and the current
    **channel mix** and **device split**.
- The result stores in a hidden `_strategy_<id>` sheet (chunked, like the
  payload) and drives both the dashboard view and the launch-plan deck.

With strategy mode on, the build bundle ships the **launch-plan prompt** instead
of the audit prompt, and the rough Slides deck becomes a from-scratch **Demand
Gen launch plan** (title, who to target, seed audiences, creative to repurpose,
where to drive, the launch setup) rather than an audit. Backed by
`buildStrategy`, `getStrategyData`, `setStrategyMode`, `buildStrategyPrompt_` and
`deckForStrategy_`.

### The deck flow (guided wizard)

The dashboard header has a four-step **Deck builder**:

1. **Build the rough deck** → the on-brand Google Slides deck from the cached
   pull. Unlocks the rest.
2. **Add settings screenshots** (optional) → drop, choose, or paste screenshots
   of each campaign's settings, the ad-group settings, and the ad-group audience
   with its exclusions. Claude treats these as the source of truth.
3. **Package the build bundle** → one `.zip` containing the deck (`.pptx`), the
   full data (`.xlsx`), the logos, your screenshots, `PROMPT.md`, and a readme.
   Built server-side (`buildBundle`, needs the `presentations` + `drive.readonly`
   scopes) and downloaded in the browser.
   Package unlocks only after you add screenshots or click **Skip**.
4. **Build in Claude** → attach just the one `.zip` and paste the short launch
   message (the full prompt is inside the zip as `PROMPT.md`). Claude (Opus)
   unzips, reviews everything, and returns the branded deck.

See `prompts/lockhern-deck.md` for the standalone prompt.

## Brand assets (logos)

**Recommended: a Drive folder (no uploads).** Put the logo files in a Google
Drive folder, share it with the account running the tool, and paste the folder's
ID or share URL into **Settings tab → "Logos Drive folder ID"**. The tool loads
them (drive.readonly scope) into the dashboard header, onto the rough deck's blue
title/closing slides, and onto a final **"Brand assets"** slide in the rough deck
so the branded rebuild reuses the real files with no separate upload. Name one
file with `white` (for the blue slides) and one with `mark`/`monogram` (the LD
icon); the rest is treated as the full-colour logo.

**Alternative: inline data URIs.** `BRAND.logoColor`, `BRAND.logoWhite`, and
`BRAND.logoMark` in `Code.gs` are data-URI slots. Paste each file as a base64
data URI to hard-code it. Until either path is set, everything falls back to a
brand-coloured wordmark; nothing breaks.

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
