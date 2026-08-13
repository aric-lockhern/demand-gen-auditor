# Demand Gen module — drop into another Google Ads audit tool

`demand-gen-audit.gs` is a **self-contained** Apps Script module that pulls every
Demand Gen signal for one account and returns both structured data and a
model-ready text block. It carries its own Google Ads transport (project OAuth
token + your developer token), so it has **no dependency** on the rest of this
app. Every name is prefixed `dg` / `DG_` so it won't collide with your project.

## Install (once)

1. In your other audit project: **Extensions → Apps Script → + → Script**, paste
   the whole contents of `demand-gen-audit.gs`.
2. Make sure `appsscript.json` has the Ads scope (add if missing):
   ```json
   "oauthScopes": [
     "https://www.googleapis.com/auth/adwords",
     "https://www.googleapis.com/auth/script.external_request"
   ]
   ```
3. **Project Settings → Script Properties**:
   - `DEVELOPER_TOKEN` — your Google Ads API developer token.
   - `LOGIN_CUSTOMER_ID` — **only** if you reach accounts through an MCC (digits
     only). Leave unset for direct access; sending a wrong one causes a 403.
4. Set `DG_CONFIG.API_VERSION` at the top of the file to the same version your
   tool already uses (e.g. `v22`).

## Use it in your analysis

```js
// Where your tool assembles the data + prompt for one account:
var dg = demandGenForPrompt(customerId, 30);   // customerId, days

if (dg.hasDemandGen) {
  // 1. Add dg.summary to the account data you send to the model.
  promptDataBlock += '\n\n' + dg.summary;

  // 2. Add dg.instructions to your system / instruction text so the model
  //    folds Demand Gen into the overall audit correctly.
  systemInstructions += '\n\n' + dg.instructions;
}
```

Prefer to gate first? `hasDemandGen(customerId)` is a one-row check.

Prefer the raw data (to build your own tables/slides)? Use
`getDemandGenData(customerId, days)` and read `.totals`, `.campaigns`,
`.videos`, `.audiences`, `.surfaces`, `.landingPages`, `.demographics`,
`.devices`, `.conversionActions`, `.creativeAssets`.

## What it pulls (all Demand Gen filtered, over the window)

- **Totals** — spend, impressions, clicks, CTR, conversions, CPA, ROAS,
  view-through conversions, full-funnel CPA (incl. VTC), the
  all-conversions-vs-bidding gap, and the 25/50/75/100% video watch-depth funnel.
- **Campaigns**, **ad groups**, **ads**.
- **Videos** rolled up per creative, each with its own watch-depth funnel.
- **Creative inventory** — YouTube video + image asset counts, image list.
- **Audiences** in use, **surfaces/formats** (Shorts, in-feed, in-stream…),
  **landing pages** (where the spend lands), **age/gender demographics**,
  **device split**, and **conversion actions** credited to Demand Gen.

## Resilience

- Each slice is isolated: a slice that fails is recorded in `data.warnings`
  and the rest still returns.
- Queries drop a field and retry if the API version rejects it (handles the
  `video_views` → `video_trueview_views` rename and similar drift).
- Rates are computed from raw counters, so grouped/rolled-up rows stay correct.
