/**
 * ===========================================================================
 * LOCKHERN DEMAND GEN AUDIT — GOOGLE ADS SCRIPT (fast workaround)
 * ===========================================================================
 * Runs INSIDE Google Ads (Tools > Bulk actions > Scripts), so it authenticates
 * natively as the account — no developer token, no login-customer-id, none of
 * the demographics/permission issues. It pulls the Demand Gen audit data plus
 * the brand-vs-DG age/gender comparison, and emails you ONE markdown document
 * that is a ready-to-paste Claude prompt to build the deck.
 *
 * HOW TO RUN (about 2 minutes):
 *   1. Open the client's Google Ads account.
 *   2. Tools > Bulk actions > Scripts > + (New script).
 *   3. Paste this whole file. Set CONFIG.EMAIL below to your address.
 *   4. Run (Preview first if you like). Authorize when asked.
 *   5. Check your email for "Lockhern DG audit export — <account>".
 *      Copy the whole email body, paste it into Claude (Opus), and it builds
 *      the deck. The script also logs the same text and writes a backup Sheet.
 *
 * If the account is under an MCC and you run from the MCC, either run it from
 * within the client account, or wrap the body in an AdsManagerApp account
 * selector (not needed for a single-account run).
 * ===========================================================================
 */

var CONFIG = {
  EMAIL: 'aric@lockherndigital.com',   // where to send the ready-to-paste prompt
  DAYS: 90,                            // reporting window (whole days, ends yesterday)
  TOP_ROWS: 15,                        // longest table printed in the prompt
  SAVE_THUMBNAILS: true                // download each video's thumbnail to Drive
};

var WARN = [];
var CUR = 'USD';

function main() {
  var acct = AdsApp.currentAccount();
  CUR = acct.getCurrencyCode() || 'USD';
  var name = acct.getName() || 'Google Ads account';
  var id = acct.getCustomerId();
  var range = dateRange_(CONFIG.DAYS);

  // ---- campaigns (all, for the DG vs non-DG split) ----
  var allCamps = safeSearch_(
    'SELECT campaign.id, campaign.name, campaign.advertising_channel_type, ' +
    'metrics.cost_micros, metrics.conversions_value FROM campaign WHERE ' +
    range.clause).map(function(r) {
      return {
        id: String(r.campaign.id),
        name: r.campaign.name,
        channel: r.campaign.advertisingChannelType,
        cost: micros_(r.metrics.costMicros),
        rev: num_(r.metrics.conversionsValue)
      };
    });
  function isDg(c) { return String(c.channel || '').indexOf('DEMAND_GEN') !== -1; }
  var dgIds = allCamps.filter(isDg).map(function(c) { return c.id; });
  var nonDgIds = allCamps.filter(function(c) { return !isDg(c); })
      .map(function(c) { return c.id; });

  // ---- DG campaigns with metrics + watch-depth ----
  var dgCamps = safeSearch_(
    'SELECT campaign.name, campaign.status, campaign.bidding_strategy_type, ' +
    'metrics.impressions, metrics.clicks, metrics.cost_micros, ' +
    'metrics.conversions, metrics.conversions_value, ' +
    'metrics.view_through_conversions, metrics.all_conversions, ' +
    'metrics.video_quartile_p25_rate, metrics.video_quartile_p50_rate, ' +
    'metrics.video_quartile_p75_rate, metrics.video_quartile_p100_rate ' +
    "FROM campaign WHERE campaign.advertising_channel_type = 'DEMAND_GEN' AND " +
    range.clause + ' ORDER BY metrics.cost_micros DESC').map(function(r) {
      return {
        name: r.campaign.name, status: r.campaign.status,
        bidding: pretty_(r.campaign.biddingStrategyType),
        impr: num_(r.metrics.impressions), clicks: num_(r.metrics.clicks),
        cost: micros_(r.metrics.costMicros), conv: num_(r.metrics.conversions),
        rev: num_(r.metrics.conversionsValue),
        vtc: num_(r.metrics.viewThroughConversions),
        allConv: num_(r.metrics.allConversions),
        p25: num_(r.metrics.videoQuartileP25Rate),
        p50: num_(r.metrics.videoQuartileP50Rate),
        p75: num_(r.metrics.videoQuartileP75Rate),
        p100: num_(r.metrics.videoQuartileP100Rate)
      };
    });

  var totals = rollup_(dgCamps);

  // ---- DG videos (per creative). Watch depth is NOT selectable at the asset
  //      level, so it stays a campaign/account-level figure (see Totals) and is
  //      footnoted on the deck rather than shown per video. Try the youtube asset
  //      type first, then field_type = VIDEO for coverage. ----
  var vidRows = [];
  ["asset.type = 'YOUTUBE_VIDEO'",
   "ad_group_ad_asset_view.field_type = 'VIDEO'"].forEach(function(cond) {
    if (vidRows.length) return;
    vidRows = safeSearch_(
      'SELECT campaign.name, asset.id, ' +
      'asset.youtube_video_asset.youtube_video_id, ' +
      'asset.youtube_video_asset.youtube_video_title, asset.name, ' +
      'metrics.impressions, metrics.cost_micros, metrics.conversions, ' +
      'metrics.conversions_value, metrics.view_through_conversions ' +
      'FROM ad_group_ad_asset_view WHERE ' +
      "campaign.advertising_channel_type = 'DEMAND_GEN' AND " + cond + ' AND ' +
      range.clause);
  });
  var byVid = {};
  vidRows.forEach(function(r) {
    var aid = String(r.asset.id);
    var yt = (r.asset.youtubeVideoAsset || {}).youtubeVideoId || '';
    var v = byVid[aid] || (byVid[aid] = {
      title: (r.asset.youtubeVideoAsset || {}).youtubeVideoTitle ||
             r.asset.name || ('Video ' + aid),
      youtubeId: yt,
      url: yt ? 'https://www.youtube.com/watch?v=' + yt : '',
      thumb: yt ? 'https://i.ytimg.com/vi/' + yt + '/hqdefault.jpg' : '',
      impr: 0, cost: 0, conv: 0, rev: 0, vtc: 0
    });
    v.impr += num_(r.metrics.impressions);
    v.cost += micros_(r.metrics.costMicros);
    v.conv += num_(r.metrics.conversions);
    v.rev += num_(r.metrics.conversionsValue);
    v.vtc += num_(r.metrics.viewThroughConversions);
  });
  var videos = Object.keys(byVid).map(function(k) { return byVid[k]; })
      .sort(function(a, b) { return b.cost - a.cost; });

  // Download each top video's thumbnail to a Drive folder so you can attach them
  // to Claude and have them placed on the scorecard. Each is named to match the
  // "thumbnail:" reference the prompt prints for that video (thumb-01.jpg …).
  var thumbFolderUrl = '';
  if (CONFIG.SAVE_THUMBNAILS) {
    try {
      var folder = DriveApp.createFolder(
          'Lockhern DG thumbnails - ' + name + ' - ' + range.end);
      videos.slice(0, CONFIG.TOP_ROWS).forEach(function(v, i) {
        v.thumbFile = 'thumb-' + pad2_(i + 1) + '.jpg';
        if (!v.thumb) return;
        try {
          var resp = UrlFetchApp.fetch(v.thumb, { muteHttpExceptions: true });
          if (resp.getResponseCode() === 200) {
            folder.createFile(resp.getBlob().setName(v.thumbFile));
          }
        } catch (e) { WARN.push('thumb ' + v.thumbFile + ': ' + e); }
      });
      thumbFolderUrl = folder.getUrl();
      Logger.log('Thumbnails folder: ' + thumbFolderUrl);
    } catch (e) { WARN.push('thumbnails: ' + e); }
  }

  // ---- DG audiences ----
  var audiences = safeSearch_(
    'SELECT ad_group_criterion.type, ad_group_criterion.display_name, ' +
    'metrics.cost_micros, metrics.conversions, metrics.conversions_value ' +
    'FROM ad_group_audience_view WHERE ' +
    "campaign.advertising_channel_type = 'DEMAND_GEN' AND " + range.clause +
    ' ORDER BY metrics.cost_micros DESC').map(function(r) {
      return { name: r.adGroupCriterion.displayName ||
               pretty_(r.adGroupCriterion.type),
               type: pretty_(r.adGroupCriterion.type),
               cost: micros_(r.metrics.costMicros),
               conv: num_(r.metrics.conversions),
               rev: num_(r.metrics.conversionsValue) };
    }).filter(function(a) { return a.cost > 0 || a.conv > 0; });

  // ---- DG surfaces / formats ----
  var surfBy = {};
  safeSearch_(
    'SELECT segments.ad_format_type, metrics.cost_micros, metrics.impressions, ' +
    'metrics.conversions FROM campaign WHERE ' +
    "campaign.advertising_channel_type = 'DEMAND_GEN' AND " + range.clause)
    .forEach(function(r) {
      var k = pretty_(r.segments.adFormatType) || 'Unsegmented';
      var s = surfBy[k] || (surfBy[k] = { surface: k, cost: 0, impr: 0, conv: 0 });
      s.cost += micros_(r.metrics.costMicros);
      s.impr += num_(r.metrics.impressions);
      s.conv += num_(r.metrics.conversions);
    });
  var surfaces = Object.keys(surfBy).map(function(k) { return surfBy[k]; })
      .sort(function(a, b) { return b.cost - a.cost; });

  // ---- DG landing pages ----
  var lpBy = {};
  safeSearch_(
    'SELECT ad_group_ad.ad.final_urls, metrics.cost_micros, metrics.clicks, ' +
    'metrics.conversions, metrics.conversions_value FROM ad_group_ad WHERE ' +
    "campaign.advertising_channel_type = 'DEMAND_GEN' AND " + range.clause)
    .forEach(function(r) {
      var urls = (r.adGroupAd.ad || {}).finalUrls || [];
      if (!urls.length) return;
      var u = urls[0];
      var lp = lpBy[u] || (lpBy[u] = { url: u, cost: 0, clicks: 0, conv: 0, rev: 0 });
      lp.cost += micros_(r.metrics.costMicros);
      lp.clicks += num_(r.metrics.clicks);
      lp.conv += num_(r.metrics.conversions);
      lp.rev += num_(r.metrics.conversionsValue);
    });
  var landingPages = Object.keys(lpBy).map(function(k) { return lpBy[k]; })
      .sort(function(a, b) { return b.cost - a.cost; });

  // ---- DG conversion actions ----
  var caBy = {};
  safeSearch_(
    'SELECT segments.conversion_action_name, segments.conversion_action_category, ' +
    'metrics.all_conversions, metrics.conversions FROM campaign WHERE ' +
    "campaign.advertising_channel_type = 'DEMAND_GEN' AND " + range.clause)
    .forEach(function(r) {
      var nm = r.segments.conversionActionName || 'Unnamed';
      var a = caBy[nm] || (caBy[nm] = { action: nm,
        category: pretty_(r.segments.conversionActionCategory),
        all: 0, conv: 0 });
      a.all += num_(r.metrics.allConversions);
      a.conv += num_(r.metrics.conversions);
    });
  var conversions = Object.keys(caBy).map(function(k) { return caBy[k]; })
      .filter(function(a) { return a.all > 0 || a.conv > 0; })
      .sort(function(a, b) { return b.all - a.all; });

  // ---- DG device split ----
  var devBy = {};
  safeSearch_(
    'SELECT segments.device, metrics.cost_micros, metrics.conversions FROM ' +
    "campaign WHERE campaign.advertising_channel_type = 'DEMAND_GEN' AND " +
    range.clause).forEach(function(r) {
      var k = pretty_(r.segments.device) || 'Unknown';
      var dv = devBy[k] || (devBy[k] = { device: k, cost: 0, conv: 0 });
      dv.cost += micros_(r.metrics.costMicros);
      dv.conv += num_(r.metrics.conversions);
    });
  var devices = Object.keys(devBy).map(function(k) { return devBy[k]; })
      .filter(function(d) { return d.cost > 0; })
      .sort(function(a, b) { return b.cost - a.cost; });

  // ---- AUDIENCE VALIDATION: brand (all non-DG) revenue by age/gender vs DG
  //      spend by age/gender. Split by campaign id (works on the demo views). --
  var brandDemo = pullDemoByIds_(nonDgIds, range.clause);
  var dgDemo = pullDemoByIds_(dgIds, range.clause);
  var ageCmp = compareBands_(AGE_BANDS, brandDemo.age, dgDemo.age);
  var genCmp = compareBands_(GENDER_BANDS, brandDemo.gender, dgDemo.gender);

  // ---- build the ready-to-paste Claude prompt ----
  var md = buildPrompt_({
    name: name, id: id, window: range, totals: totals, dgCamps: dgCamps,
    videos: videos, audiences: audiences, surfaces: surfaces,
    landingPages: landingPages, conversions: conversions, devices: devices,
    ageCmp: ageCmp, genCmp: genCmp, thumbFolderUrl: thumbFolderUrl,
    counts: { brand: nonDgIds.length, dg: dgIds.length }
  });

  Logger.log(md);
  try {
    MailApp.sendEmail(CONFIG.EMAIL,
      'Lockhern DG audit export — ' + name, md);
    Logger.log('Emailed to ' + CONFIG.EMAIL);
  } catch (e) { Logger.log('Email failed: ' + e); }

  // Backup: write the prompt to a new Google Sheet (cell A1).
  try {
    var ss = SpreadsheetApp.create('Lockhern DG audit — ' + name);
    var sh = ss.getActiveSheet();
    sh.setName('CLAUDE PROMPT');
    sh.getRange(1, 1).setValue(md.slice(0, 49000));
    Logger.log('Backup sheet: ' + ss.getUrl());
  } catch (e) { Logger.log('Sheet backup failed: ' + e); }

  if (WARN.length) Logger.log('Warnings:\n- ' + WARN.join('\n- '));
}

// ---------------------------------------------------------------------------
// Demographics helpers
// ---------------------------------------------------------------------------
var AGE_BANDS = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+', 'Unknown'];
var GENDER_BANDS = ['Male', 'Female', 'Unknown'];

function ageBand_(v) {
  v = String(v || '').toUpperCase();
  if (v.indexOf('18_24') !== -1) return '18-24';
  if (v.indexOf('25_34') !== -1) return '25-34';
  if (v.indexOf('35_44') !== -1) return '35-44';
  if (v.indexOf('45_54') !== -1) return '45-54';
  if (v.indexOf('55_64') !== -1) return '55-64';
  if (v.indexOf('65_') !== -1) return '65+';
  return 'Unknown';
}
function genderBand_(v) {
  v = String(v || '').toUpperCase();
  if (v.indexOf('FEMALE') !== -1) return 'Female';
  if (v.indexOf('MALE') !== -1) return 'Male';
  return 'Unknown';
}

function pullDemoByIds_(ids, dateClause) {
  var out = { age: {}, gender: {} };
  if (!ids.length) return out;
  var idList = ids.join(',');
  [['age_range_view', 'age_range', 'ageRange', 'age', ageBand_],
   ['gender_view', 'gender', 'gender', 'gender', genderBand_]].forEach(function(s) {
    var q = 'SELECT campaign.id, ad_group_criterion.' + s[1] + '.type, ' +
      'metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM ' +
      s[0] + ' WHERE campaign.id IN (' + idList + ') AND ' + dateClause;
    safeSearch_(q).forEach(function(r) {
      var raw = (r.adGroupCriterion[s[2]] || {}).type;
      var band = s[4](raw);
      var b = out[s[3]][band] || (out[s[3]][band] = { cost: 0, conv: 0, rev: 0 });
      b.cost += micros_(r.metrics.costMicros);
      b.conv += num_(r.metrics.conversions);
      b.rev += num_(r.metrics.conversionsValue);
    });
  });
  return out;
}

function compareBands_(order, brand, dg) {
  var brTot = 0, dgTot = 0;
  order.forEach(function(b) {
    brTot += (brand[b] ? brand[b].rev : 0);
    dgTot += (dg[b] ? dg[b].cost : 0);
  });
  var rows = order.map(function(b) {
    var br = brand[b] || { cost: 0, rev: 0 }, d = dg[b] || { cost: 0 };
    var brShare = brTot ? br.rev / brTot : 0;
    var dgShare = dgTot ? d.cost / dgTot : 0;
    return {
      band: b, brandRev: br.rev, brandRoas: br.cost ? br.rev / br.cost : 0,
      brandRevShare: brShare, dgSpend: d.cost, dgSpendShare: dgShare,
      index: (brShare && dgTot) ? dgShare / brShare : null
    };
  });
  return rows.filter(function(r) { return r.brandRev || r.dgSpend; });
}

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------
function buildPrompt_(d) {
  var N = CONFIG.TOP_ROWS, L = [];
  function p(s) { L.push(s === undefined ? '' : s); }

  p('# Build a Lockhern Digital Demand Gen audit deck');
  p('');
  p('You are building a polished, client-ready slide deck for **Lockhern Digital** ' +
    'from the Google Ads Demand Gen data at the bottom. Produce a real **.pptx** ' +
    '(use python-pptx, widescreen 13.33 x 7.5in) and return the file.');
  p('');
  p('## Point of view (carry it through the whole deck)');
  p('Demand Gen is a SOCIAL, CREATIVE, full-funnel channel on YouTube, not a search ' +
    'channel. Creative and landing pages are the levers. Judge success on attention ' +
    'and mid-funnel signal (the 25/50/75/100% video watch-depth funnel, view rate, ' +
    'view-through conversions, full-funnel CPA including VTC), not last-click ' +
    'purchases. Recommend setting mid-funnel KPIs (Add to Cart, Begin Checkout) to ' +
    'primary and keeping Purchases separate. Set expectations: this is not supposed ' +
    'to work off the rip, align on KPIs before launch.');
  p('');
  p('## Brand system');
  p('Use ONLY these colors: primary blue #317AE0 (the hero: full-bleed background on ' +
    'title, closing and section dividers, plus headlines, key figures and the single ' +
    'accent), secondary #2E51C0, navy #0E2970 (sparingly), ink #0E0E0E, grays ' +
    '#6B7A99 / #BAC3D6 / #E7ECF4, white. Titles in a clean serif (Fraunces), body in ' +
    'a humanist sans (Figtree). No stock photography, no icons standing in for data, ' +
    'no decorative chrome. **Never use an em dash or en dash anywhere in the deck.**');
  p('');
  p('## Slides, in order (produce exactly 12)');
  p('1. **Title** — full-bleed primary blue, "DEMAND GEN AUDIT", the account name, ' +
    'the window, "A full-funnel, creative-led approach to Demand Gen", and ' +
    '"Prepared by Lockhern Digital" with the month and year.');
  p('2. **The lens** — three pillars THE CHANNEL / THE LEVERS / THE SIGNAL. A point-' +
    'of-view slide, not three columns of text.');
  p('3. **Executive summary** — one line of setup (spend, conversions, CPA), then ' +
    'three findings as large stat callouts tagged FIX / READ IT RIGHT / WORTH A LOOK.');
  p('4. **Video performance** — one-page scorecard, one row per video (with its ' +
    'thumbnail): impressions, cost, conversions, view-through, CPA. Watch depth is ' +
    'only available blended at the account level (see Totals: Google does not report ' +
    'it per video asset), so footnote it, do not fabricate a per-video figure. Do ' +
    'NOT make one slide per video.');
  p('5. **Three moves** — split multi-video ads so each video is measurable; seed ' +
    'audiences from watching behaviour and best organic/paid-social creative; turn ' +
    'on and judge the AI-modified cuts.');
  p('6. **The destination** — the landing pages: what the page does well vs what it ' +
    'asks a cold viewer to do; recommend a purpose-built page and the primary KPI to ' +
    'test (quiz, email/SMS capture, or direct order).');
  p('7. **Audience** — who the targeting reaches and excludes, with spend by age.');
  p('8. **Audience validation** — brand (all non Demand Gen) revenue by age vs Demand ' +
    'Gen spend by age. INDEX = DG spend share / brand revenue share: above 1.0 the ' +
    'group is over-bought vs where revenue sits, below 1.0 under-bought. Include ' +
    'Brand ROAS. Use the exact table below.');
  p('9. **Surfaces** — spend by surface/format; drop surfaces under ~1% of spend.');
  p('10. **Conversion actions** — what is tracked vs fed to bidding (the all-conv vs ' +
    'bidding-conv gap is the fixable miss).');
  p('11. **Audiences in use** — the converting audiences already running.');
  p('12. **The one thing** — full-bleed primary blue closing: the single highest-' +
    'leverage action, then THE NEXT MOVES as a numbered list with week labels.');
  p('');
  p('Titles are assertions that carry their number ("Three audiences carry 80% of ' +
    'conversions"), not labels. Give the numbers hierarchy. Mark what needs ' +
    'attention. **Never invent a number, label or date**; if a figure looks wrong, ' +
    'flag it in your reply rather than changing it on the slide. Before building, ' +
    'tell me the three executive-summary findings you chose and the design direction, ' +
    'then build the .pptx.');
  p('');
  p('---');
  p('');
  p('## Account data');
  p('Account: ' + d.name + ' (' + d.id + '), ' + CUR + '. Window: ' +
    d.window.start + ' to ' + d.window.end + '.');
  var t = d.totals;
  p('');
  p('### Totals (Demand Gen)');
  p('- Spend: ' + money_(t.cost) + ' | Impressions: ' + int_(t.impr) +
    ' | Clicks: ' + int_(t.clicks) + ' | CTR: ' + pct_(t.clicks / (t.impr || 1)));
  p('- Conversions: ' + dec_(t.conv) + ' | CPA: ' + money_(safe_(t.cost, t.conv)) +
    ' | ROAS: ' + dec_(safe_(t.rev, t.cost)));
  p('- View-through conv: ' + dec_(t.vtc) + ' | Full-funnel CPA (incl VTC): ' +
    money_(safe_(t.cost, t.conv + t.vtc)));
  p('- All-conversions (everything tracked): ' + dec_(t.allConv) +
    ' | Tracked but NOT bid on: ' + dec_(Math.max(0, t.allConv - t.conv)));
  p('- Watch depth 25/50/75/100: ' + pct_(t.p25) + ' / ' + pct_(t.p50) + ' / ' +
    pct_(t.p75) + ' / ' + pct_(t.p100));

  section_(p, 'Campaigns (Demand Gen)', d.dgCamps.slice(0, N), function(c) {
    return '- ' + c.name + ' [' + c.status + ', ' + c.bidding + '] — spend ' +
      money_(c.cost) + ', conv ' + dec_(c.conv) + ' @ ' + money_(safe_(c.cost, c.conv)) +
      ', VTC ' + dec_(c.vtc);
  });
  section_(p, 'Videos (per creative)', d.videos.slice(0, N),
    function(v) {
      return '- ' + clip_(v.title, 50) + ' — spend ' + money_(v.cost) + ', impr ' +
        int_(v.impr) + ', conv ' + dec_(v.conv) + ' @ ' + money_(safe_(v.cost, v.conv)) +
        ', VTC ' + dec_(v.vtc) +
        (v.thumbFile ? '  thumbnail: ' + v.thumbFile : '') +
        (v.thumb ? '  (' + v.thumb + ')' : '');
    });
  if (d.thumbFolderUrl) {
    p('');
    p('Video thumbnails were downloaded to this Drive folder: ' + d.thumbFolderUrl);
    p('They are named thumb-01.jpg, thumb-02.jpg, … in the order the videos are ' +
      'listed above. Download them and attach them to this chat, then place each ' +
      'video\'s thumbnail on its row of the Video performance scorecard. If they ' +
      'are not attached, fetch each from its thumbnail URL above.');
  }
  section_(p, 'Audiences in use', d.audiences.slice(0, N), function(a) {
    return '- ' + clip_(a.name, 46) + ' [' + a.type + '] — spend ' + money_(a.cost) +
      ', conv ' + dec_(a.conv) + ' @ ' + money_(safe_(a.cost, a.conv));
  });
  section_(p, 'Surfaces / formats', d.surfaces.slice(0, N), function(s) {
    return '- ' + s.surface + ' — spend ' + money_(s.cost) + ', impr ' + int_(s.impr) +
      ', conv ' + dec_(s.conv);
  });
  section_(p, 'Landing pages (where spend lands)', d.landingPages.slice(0, N),
    function(l) {
      return '- ' + clip_(l.url.replace(/^https?:\/\//, ''), 60) + ' — spend ' +
        money_(l.cost) + ', conv ' + dec_(l.conv) + ' @ ' + money_(safe_(l.cost, l.conv));
    });
  section_(p, 'Conversion actions', d.conversions.slice(0, N), function(a) {
    return '- ' + clip_(a.action, 44) + (a.category ? ' [' + a.category + ']' : '') +
      ' — all-conv ' + dec_(a.all) + ', bidding-conv ' + dec_(a.conv);
  });
  section_(p, 'Device split', (d.devices || []).slice(0, N), function(dv) {
    return '- ' + dv.device + ' — spend ' + money_(dv.cost) + ', conv ' + dec_(dv.conv);
  });

  // Audience validation table (the comparison).
  p('');
  p('### Audience validation — brand (all non Demand Gen) vs Demand Gen, by age');
  p('(Checked ' + d.counts.brand + ' non-DG and ' + d.counts.dg +
    ' Demand Gen campaigns. INDEX = DG spend share / brand revenue share.)');
  p('| Age | Brand revenue | Brand rev share | Brand ROAS | DG spend | DG spend share | Index |');
  p('|---|---|---|---|---|---|---|');
  cmpTable_(p, d.ageCmp);
  p('');
  p('### Audience validation — by gender');
  p('| Gender | Brand revenue | Brand rev share | Brand ROAS | DG spend | DG spend share | Index |');
  p('|---|---|---|---|---|---|---|');
  cmpTable_(p, d.genCmp);

  return L.join('\n');
}

function cmpTable_(p, rows) {
  if (!rows.length) { p('| (no demographic rows) | | | | | | |'); return; }
  rows.forEach(function(r) {
    p('| ' + [r.band, money_(r.brandRev), pct_(r.brandRevShare),
      (r.brandRoas ? r.brandRoas.toFixed(2) : '-'), money_(r.dgSpend),
      pct_(r.dgSpendShare), (r.index == null ? '-' : r.index.toFixed(2) + 'x')
    ].join(' | ') + ' |');
  });
}

function section_(p, title, rows, fmt) {
  if (!rows.length) return;
  p(''); p('### ' + title);
  rows.forEach(function(r) { p(fmt(r)); });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function safeSearch_(q) {
  try {
    var it = AdsApp.search(q), rows = [];
    while (it.hasNext()) rows.push(it.next());
    return rows;
  } catch (e) {
    WARN.push(String(e).slice(0, 160) + ' | query: ' + q.slice(0, 90));
    return [];
  }
}
function dateRange_(days) {
  var tz = AdsApp.currentAccount().getTimeZone();
  var end = new Date(); end.setDate(end.getDate() - 1);
  var start = new Date(end); start.setDate(end.getDate() - (Math.max(1, days) - 1));
  var f = function(dd) { return Utilities.formatDate(dd, tz, 'yyyy-MM-dd'); };
  return { clause: "segments.date BETWEEN '" + f(start) + "' AND '" + f(end) + "'",
           start: f(start), end: f(end) };
}
function rollup_(camps) {
  var t = { impr: 0, clicks: 0, cost: 0, conv: 0, rev: 0, vtc: 0, allConv: 0,
    wp25: 0, wp50: 0, wp75: 0, wp100: 0 };
  camps.forEach(function(c) {
    t.impr += c.impr; t.clicks += c.clicks; t.cost += c.cost; t.conv += c.conv;
    t.rev += c.rev; t.vtc += c.vtc; t.allConv += c.allConv;
    t.wp25 += c.p25 * c.impr; t.wp50 += c.p50 * c.impr;
    t.wp75 += c.p75 * c.impr; t.wp100 += c.p100 * c.impr;
  });
  t.p25 = t.impr ? t.wp25 / t.impr : 0; t.p50 = t.impr ? t.wp50 / t.impr : 0;
  t.p75 = t.impr ? t.wp75 / t.impr : 0; t.p100 = t.impr ? t.wp100 / t.impr : 0;
  return t;
}
function num_(x) { var n = Number(x); return isNaN(n) ? 0 : n; }
function micros_(x) { return num_(x) / 1e6; }
function safe_(a, b) { return b ? a / b : 0; }
function money_(v) { return CUR + ' ' + (Math.round((v || 0) * 100) / 100).toFixed(2); }
function pct_(v) { return (Math.round((v || 0) * 1000) / 10).toFixed(1) + '%'; }
function dec_(v) { return (Math.round((v || 0) * 100) / 100).toFixed(2); }
function int_(v) { return String(Math.round(v || 0)); }
function clip_(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function pad2_(n) { return n < 10 ? '0' + n : String(n); }
function pretty_(v) {
  if (!v) return '';
  return String(v).toLowerCase().split('_').map(function(w) {
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}
