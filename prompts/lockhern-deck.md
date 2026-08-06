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

## Slides, in order

1. **Title** — full-bleed primary blue, white logo, account name, window, and the line "A full-funnel, creative-led approach to Demand Gen" as the framing.
2. **Executive summary** — three or four findings, each one line, each carrying
   its number. This is the slide people read.
3. **How we judge Demand Gen** — a short POV slide stating the lens (social not
   search; creative + landing pages are the levers; measured on attention and
   mid-funnel signal).
4. **Headline numbers** — this period vs prior, with real hierarchy.
5. **What is actually delivering** — entities that exist vs deliver.
6. **Creative scorecard — ONE page.** Every creative on a single slide, styled
   like the Google Ads video table: a small YouTube thumbnail per row, the source
   (advertiser vs Enhanced by Google AI), impressions, view rate, the
   25/50/75/100% watch funnel, conversions, and view-through. Only spill to a
   second page if the rows genuinely do not fit. **Do NOT make one slide per
   creative.** Pull thumbnails from the Creative appendix URLs. Call out the
   AI-modified cuts as a group.
7. **Channel and ad-format splits** — donut/bar plus a table.
8. **What counted as a conversion** — and whether ATC / Begin Checkout are
   Primary (our deliberate stance) or purchase-only.
9. **Structure** — campaigns, ad groups, audiences, demographics, assets.
10. **Spend over time.**
11. **How to read these numbers** — the caveats, kept in full.
12. **Closing** — full-bleed primary blue, logo, and the one recommendation that matters most.

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
