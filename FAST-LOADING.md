# Fast loading (Netlify read path)

Google's Apps Script web-app front end is the slow, flaky part: the script runs in
milliseconds, but requests take 3–50 s and sometimes come back **404 from
`script.googleusercontent.com`**. This moves the **read** off that front end.

```
Google Ads API ──pull──▶ Google Sheet (the database) ──getPayload── Apps Script (/exec page)
                              │   ▲                                         │ reads try:
                 Publish.gs ──┘   │ (writes only: pulls, settings)          │  1. Netlify /api  (fast)
                 every 5 min      │                                         │  2. Apps Script   (fallback)
                 POST /api/ingest ▼
                          Netlify Blobs ◀──reads── Netlify Function /api ◀── the page (cross-origin fetch)
```

**The Sheet + Apps Script stay the source of truth and the only writer.** Netlify
only serves a copy of each account's finished payload for reads. Anything the fast
path can't vouch for falls back to Apps Script, so it can never show less, or
something wrong — at worst it's as slow as before.

## Files
| Path | What it is |
|---|---|
| `Publish.gs` | The publisher. Every 5 min (`publishAll`, time trigger) posts the access **index** and each **changed account's payload** to `<FAST_API_URL>/api/ingest`. A re-pull publishes that account at once (`publishSoon_`). |
| `netlify/functions/api.mjs` | The function at `/api` and `/api/ingest` (Netlify Blobs, strong consistency). |
| `netlify/lib/fastapi.mjs` | The read + ingest logic, so `tests/fastapi.test.mjs` can run it directly. |
| `tests/fastapi.test.mjs` | `node --test`: access rules, round-trip identity, ingest security. |
| `netlify.toml`, `package.json`, `public/` | Netlify build (`npm test` gates it), the function dir, a placeholder page. |

## How access works
The web app runs as the viewer (`executeAs USER_ACCESSING`, domain-locked to
`lockherndigital.com`). On every page load `doGet` mints that viewer a signed
session — `s1.<base64url(email|expiry)>.<HMAC-SHA256>` from Script Property
`SESSION_SECRET` — and hands it to the page. The page sends it to `/api?key=…`.
The function verifies the HMAC against the **published** session secret and checks
the email's domain. An optional shared agency key (Script Property `FAST_ADMIN_KEY`,
published only as a SHA-256 hash) also works, for non-browser checks. No session or
an unknown/forged/expired one ⇒ `{fallback:true}` ⇒ the page asks Apps Script.

Rotating `SESSION_SECRET` (and republishing) revokes every old session on the fast
path. The agency key, the session secret and the email are never sent to the
browser except as the viewer's own freshly-minted session.

## One-time setup
1. **Create a Netlify site from this GitHub repo.** Netlify builds
   `netlify/functions/api.mjs` on its own; `netlify.toml` runs `npm test` first, so
   a commit that fails the tests never publishes. Note the site URL
   (e.g. `https://your-site.netlify.app`, or your custom domain once added).
2. **Point Apps Script at it.** Apps Script → Project Settings → **Script
   properties** → add `FAST_API_URL` = that site's base URL.
3. **Run the Sheet menu → “Fast loading: set up.”** It creates `INGEST_SECRET`,
   installs the 5-minute trigger, test-sends, and shows the secret to copy.
4. **Copy `INGEST_SECRET` into Netlify** → Site configuration → Environment
   variables → add `INGEST_SECRET` with that value → **Deploys → Trigger deploy**.
5. **Run the menu item again.** It should say “Fast loading is on.” The first round
   publishes every account (a few minutes); after that, only changed accounts.

Check it any time from a browser: `https://<site>/api?api=ping` →
`{published:true, accounts:N, at:…}`.

To turn it off: clear `FAST_API_URL` (or delete the `INGEST_SECRET` Script
Property). The page falls back to Apps Script.

## Known, harmless differences
- **Up to ~5 minutes stale.** The fast path serves the last published snapshot;
  the trigger refreshes it every 5 min. After **your own** re-pull the page reads
  fresh from Apps Script (and the account is also published immediately), so you
  never see your own change lag.
- **Only the big payload read moves.** The account picker list and the AI overview
  still come from Apps Script's `doGet` injection; writes (re-pull, discover, pause,
  notes, overview) always go to Apps Script. The payload is served **verbatim** —
  the exact bytes `getPayload` returns — so the numbers are identical.
- **Cross-origin:** the page (on `/exec`) fetches the Netlify `/api` cross-origin;
  the function sends CORS headers. If the Apps Script sandbox ever blocks that
  fetch, the page falls back to Apps Script automatically (no breakage) — the
  permanent fix for that case is serving the page itself from Netlify too.
