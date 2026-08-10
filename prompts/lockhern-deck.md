# Lockhern deck-design prompt

This is the house prompt for turning a Demand Gen audit into a **Lockhern-branded,
client-ready** slide deck with our point of view on it.

Two ways to use it:

- **From the dashboard** (recommended): the tool generates a per-account version
  of this prompt — the brand system and POV below, plus the account's findings,
  the analyst's storyboard notes, and a machine-readable **Creative appendix**
  (one row per creative with its thumbnail URL and metrics). Click **Copy deck
  design prompt** in the header or on the Storyboard tab, then paste it to Claude
  along with the rough `.pptx` (Build slide deck → export from Google Slides as
  PowerPoint).
- **Standalone**: paste this file to Claude with the rough `.pptx` attached. It
  carries the brand and the argument but not the account's specific findings or
  notes — the dashboard version is richer.

---

## The brief

Rebuild the attached Google Ads Demand Gen audit as a polished, client-ready deck
for **Lockhern Digital**. A rough `.pptx` is attached (auto-exported from Google
Slides): the numbers are correct and the structure is sound, but it is
script-laid-out — generic titles, dense tables, no hierarchy, no brand. Turn it
into something Lockhern would put in front of a client, **without changing what it
says**, and **with our point of view on it**.

## Our point of view — carry this argument through the deck

The deck argues a thesis: **a full-funnel, creative-led approach to Demand Gen.**

Demand Gen is a **social and creative channel, not a search channel.** YouTube is
social and should be bought like social: creative and landing pages are the
levers, and success shows up first in attention and mid-funnel signal, not
last-click purchases.

Principles the reader should leave with:

- Stop thinking like a search marketer; think like a social buyer. YouTube is
  social — treat it as such.
- Creative and landing pages are the levers. Driving to a standard product page
  is usually not good enough — build purpose-made pages.
- Seed audiences from watching behaviour and the best-performing organic / Meta
  content, not search-style intent lists.
- Set additional KPIs (Add to Cart, Begin Checkout) to **Primary**, and keep
  Purchases in a custom group. Google discourages mixing conversion goals; we do
  it deliberately to feed the algorithm mid-funnel signal.
- Set client expectations first. This is **not supposed to work off the rip.**
  Align on KPIs before launch.

Present performance on the signals a purchase-only lens misses: the 25/50/75/100%
video completion funnel, the AI-modified cuts (Enhanced by Google AI), CTR,
view-through conversions, attributed brand searches, full-funnel impact, brand
lift, and cost per quiz / email submit.

## Lockhern brand system — apply consistently

Colours (use as the entire palette; introduce no others):

| Token | Hex | Use |
|---|---|---|
| Primary blue | `#317AE0` | The hero colour: full-bleed background for the title, closing and any section-divider slides, plus headlines, key figures and the single accent |
| Secondary blue | `#2E51C0` | Secondary series, accents |
| Tertiary navy | `#0E2970` | Use sparingly: small accents and text contrast only. Not a background or a large fill. |
| Ink | `#0E0E0E` | Body text |
| Dark gray | `#6B7A99` | Captions, muted labels |
| Mid gray | `#BAC3D6` | Rules, gridlines |
| Light gray | `#E7ECF4` | Card fills, washes, table banding |
| White | `#FFFFFF` | |

Type: **Fraunces** for titles/display, **Figtree** for body and figures. If
unavailable, substitute a clean serif for titles and a humanist sans for body —
never default fonts.

Logo: place the Lockhern logo on the title and closing slides (white version on
the primary blue background) and a small mark in a consistent corner of content slides.
Embed the provided logo files; do not recreate the logo.

Motif: primary blue (`#317AE0`) is the signature colour. Use it full-bleed on the title, closing and any section-divider slides; content slides stay light for readability. Primary blue is the single accent. Keep tertiary navy to a minimum. No stripes, no accent bars under titles.

## Slides, in order — the locked 12-slide house format

This deck has a **fixed format**. When you build from the dashboard, a finished
reference deck ships in the bundle as `template-reference.pptx` — open it first
and match it slide for slide (layout, type, colour, bucket labels). Only the
content changes per account, never the structure. Produce exactly 12 slides.
Every content slide from 4 on carries a **bucket label** above its title (BUCKET
ONE / TWO / THREE / FOUR plus a short section word), an assertion title, and one
supporting line, plus the small mark and footer line at the foot.

1. **Title** — full-bleed primary blue, white logo, "DEMAND GEN AUDIT", account
   name, window / id / currency, the framing line "A full-funnel, creative-led
   approach to Demand Gen.", and "Prepared by Lockhern Digital" with month and year.
2. **The lens** — three pillars (THE CHANNEL, THE LEVERS, THE SIGNAL), each an
   icon in a blue circle with a short claim and one line, then a strip of the
   exact signals we grade on. A point-of-view slide, not three columns of text.
3. **Executive summary** — a one-line setup (spend, conversions, CPA and its
   change), then three findings as large stat callouts under tags FIX / READ IT
   RIGHT / WORTH A LOOK. Add the "what we are not calling a problem" line and the
   view-through footnote.
4. **Bucket one · Settings** — SETTING / VERIFIED VALUE / WHAT IT MEANS status
   table, each row ALIGNED / FIX / WORTH A LOOK. Only confirmed settings. Source
   line: interface beats API on conflict.
5. **Bucket two · Structure** — the creative-packing finding: one ad carries N
   videos, so watch depth is blended and no single video can be measured. Show
   the thumbnails, the blended watch-depth chart, and live-vs-paused counts as
   intentional seasonal context.
6. **Bucket three · Video performance** — the one-page creative scorecard. A
   thumbnail per creative, columns CREATIVE / IMPR. / COST / VIEW RATE /
   25·50·75·100 / CONV. / VIEW-THRU / CPA / CPA INC. VT and the source. **Do NOT
   make one slide per creative.** Footnote the blended watch depth.
7. **Bucket four · Video and content** — three numbered moves (01/02/03), each
   tagged OBSERVED or TEST with a "how we know it worked" line: split the ad,
   seed audiences from watching, turn on the AI cuts and judge them.
8. **Bucket four · The destination** — where all the spend lands. Stat strip,
   then WHAT THE PAGE DOES WELL vs WHAT IT ASKS A COLD VIEWER TO DO, then the
   recommendation: a purpose-built page and the primary KPI to test (quiz, email
   or SMS capture, or a direct order).
9. **Bucket one · Audience** — WHO THE SIGNAL TARGETS / WHO IT KEEPS OUT / AND
   WHO IT REACHES, with a spend-by-age chart. Credit the purchaser exclusion when
   it is in place. Use the ad-group audience screenshot as truth.
10. **Bucket one · Audience validation** — the brand-vs-Demand-Gen demographic
    slide. A grouped bar of brand revenue share vs DG spend share by age, and a
    cohort table AGE / BRAND REVENUE / DG SPEND / INDEX / BRAND ROAS. Index is DG
    spend share divided by brand revenue share (1.0 means spend matches demand).
    Use the brand comparison data the dashboard supplies; if it is absent, keep
    the slide as a labelled placeholder rather than inventing numbers.
11. **Bucket three · Surfaces** — spend by surface plus SURFACE / SPEND / CONV. /
    CPA / VIEW RATE. Drop surfaces under ~1% of spend. Caveat any zero view rate.
12. **The one thing** — full-bleed primary blue closing slide, white logo, the
    single highest-leverage action, then THE NEXT MOVES as a numbered list with
    week labels.

## What to change

- **Titles become takeaways.** "Audiences" says nothing; "Three audiences carry
  80% of conversions" is a title. Where the numbers on a slide don't support an
  assertion, keep a descriptive title rather than inventing one.
- **Give the numbers hierarchy.** Headline figures large; supporting detail
  recedes.
- **Turn ranking tables into comparisons.** A bar makes the shape visible. Keep
  tables where the reader looks values up.
- **Mark what needs attention.** Where a figure is bad, let the design say so.
  Do not make everything look positive.

## Constraints

- Never change a number, a label, or a date. If a figure looks wrong, flag it in
  your reply rather than correcting it on the slide.
- Keep the caveats slide, and keep every caveat on it.
- Keep watch-depth figures labelled exactly as they are; where a figure describes
  the ad rather than an individual video, do not relabel it.
- No stock photography, no icons standing in for data, no decorative chrome that
  carries no information.
- Build with **pptxgenjs** (LAYOUT_WIDE, 13.3 × 7.5 in) or python-pptx. Return a
  new `.pptx`. Run the pptx validator and fix what it flags.

Before you start, tell me the design direction you have chosen and why it suits
this client. Then build it.
