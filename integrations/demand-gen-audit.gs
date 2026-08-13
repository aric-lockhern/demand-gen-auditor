/**
 * ===========================================================================
 * DEMAND GEN AUDIT MODULE  (portable)
 * ===========================================================================
 * Drop this whole file into your existing Google Ads audit Apps Script project
 * (Extensions > Apps Script > + > Script). It pulls every Demand Gen signal for
 * one account and hands you back BOTH a structured object and a ready-to-read
 * text block you can splice straight into whatever prompt your audit tool sends
 * to the model.
 *
 * It is self-contained: it has its OWN Google Ads transport that uses the
 * project's OAuth token + your developer token, so it depends on NOTHING in
 * your other code. Every function/global here is prefixed `dg` / `DG_` so it
 * cannot collide with your existing names.
 *
 * ---------------------------------------------------------------------------
 * ONE-TIME SETUP
 * ---------------------------------------------------------------------------
 * 1. appsscript.json must include the Ads scope (add if missing):
 *      "oauthScopes": [ "https://www.googleapis.com/auth/adwords", ... ]
 *    If you send the summary to an LLM from here, also add:
 *      "https://www.googleapis.com/auth/script.external_request"
 *
 * 2. Set your developer token in Project Settings > Script Properties:
 *      DEVELOPER_TOKEN   = <your Google Ads API developer token>
 *      LOGIN_CUSTOMER_ID = <manager/MCC id, digits only>   // ONLY if you reach
 *                          the account through an MCC. Leave unset for direct
 *                          access — sending a wrong one causes a 403.
 *    (Or hard-code them in DG_CONFIG below.)
 *
 * ---------------------------------------------------------------------------
 * USE IT
 * ---------------------------------------------------------------------------
 *   var dg = getDemandGenData('1234567890', 30);   // customerId, days
 *   if (dg.ok && dg.hasDemandGen) {
 *     var block = demandGenSummary(dg);             // text for your prompt
 *     // ...append `block` to the account data you already send to the model,
 *     // and add DG_PROMPT_INSTRUCTIONS (bottom of this file) to your system
 *     // / instruction text so the model folds Demand Gen into the analysis.
 *   }
 *
 * Quick gate before you bother pulling everything:
 *   if (hasDemandGen('1234567890')) { ...include the DG section... }
 * ===========================================================================
 */

var DG_CONFIG = {
  API_VERSION: 'v22',        // match the version your other tool uses
  DEVELOPER_TOKEN: '',       // or leave '' and set Script Property DEVELOPER_TOKEN
  LOGIN_CUSTOMER_ID: '',     // MCC id (digits) — only for accounts under a manager
  DAYS: 30,                  // default reporting window (whole days, ending yesterday)
  MAX_ROWS_IN_SUMMARY: 12    // longest table the text summary will print
};

var DG_FILTER = "campaign.advertising_channel_type = 'DEMAND_GEN'";

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

function dgToken_() {
  if (DG_CONFIG.DEVELOPER_TOKEN) return String(DG_CONFIG.DEVELOPER_TOKEN).trim();
  var p = PropertiesService.getScriptProperties().getProperty('DEVELOPER_TOKEN');
  if (!p) {
    throw new Error('No developer token. Set DEVELOPER_TOKEN in Script ' +
        'Properties or in DG_CONFIG.DEVELOPER_TOKEN.');
  }
  return String(p).trim();
}

function dgLoginId_() {
  var id = DG_CONFIG.LOGIN_CUSTOMER_ID ||
      PropertiesService.getScriptProperties().getProperty('LOGIN_CUSTOMER_ID') || '';
  return dgDigits_(id);
}

/** POST a GAQL query to searchStream and return the flattened results array. */
function dgSearch_(customerId, query) {
  var url = 'https://googleads.googleapis.com/' + DG_CONFIG.API_VERSION +
      '/customers/' + dgDigits_(customerId) + '/googleAds:searchStream';
  var headers = {
    Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
    'developer-token': dgToken_()
  };
  var login = dgLoginId_();
  if (login) headers['login-customer-id'] = login;

  var resp = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', headers: headers,
    payload: JSON.stringify({ query: query }), muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  var body = resp.getContentText();
  if (code !== 200) throw new Error('HTTP ' + code + ': ' + String(body).slice(0, 400));

  var chunks;
  try { chunks = JSON.parse(body); }
  catch (e) { throw new Error('Response too large to parse; add a LIMIT or ' +
      'shorten the window.'); }

  var rows = [];
  (Array.isArray(chunks) ? chunks : [chunks]).forEach(function(chunk) {
    if (chunk.results) rows = rows.concat(chunk.results);
  });
  return rows;
}

/**
 * Run a query, and if the API rejects a selected field on this API version,
 * drop exactly that field and retry — so version drift (e.g. video_views vs
 * video_trueview_views) degrades gracefully instead of failing the whole pull.
 */
function dgQuery_(customerId, select, from, where, orderBy, limit) {
  var fields = select.slice();
  for (var guard = 0; guard <= select.length + 1; guard++) {
    var q = 'SELECT ' + fields.join(', ') + ' FROM ' + from +
        (where ? ' WHERE ' + where : '') +
        (orderBy ? ' ORDER BY ' + orderBy : '') +
        (limit ? ' LIMIT ' + limit : '');
    try {
      return dgSearch_(customerId, q);
    } catch (e) {
      var msg = String(e.message || e);
      var drop = null;
      for (var i = 0; i < fields.length; i++) {
        if (msg.indexOf(fields[i]) !== -1) { drop = fields[i]; break; }
      }
      if (!drop || fields.length <= 1) throw e;
      fields = fields.filter(function(f) { return f !== drop; });
    }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Small helpers (all prefixed dg so nothing collides with your project)
// ---------------------------------------------------------------------------

function dgGet_(obj, path) {
  var parts = path.split('.'), cur = obj;
  for (var i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined) return null;
    cur = cur[parts[i]];
  }
  return cur === undefined ? null : cur;
}
function dgNum_(v) { var n = Number(v); return isNaN(n) ? 0 : n; }
function dgMicros_(v) { return dgNum_(v) / 1000000; }
function dgSafe_(a, b) { return b ? a / b : 0; }
function dgDigits_(v) { return String(v == null ? '' : v).replace(/[^0-9]/g, ''); }
function dgPretty_(v) {
  if (!v) return '';
  return String(v).toLowerCase().split('_').map(function(w) {
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

var DG_CORE = ['metrics.impressions', 'metrics.clicks', 'metrics.cost_micros',
  'metrics.conversions', 'metrics.conversions_value',
  'metrics.view_through_conversions', 'metrics.all_conversions',
  'metrics.all_conversions_value'];
var DG_VIDEO = ['metrics.video_trueview_views'];
var DG_QUART = ['metrics.video_quartile_p25_rate', 'metrics.video_quartile_p50_rate',
  'metrics.video_quartile_p75_rate', 'metrics.video_quartile_p100_rate'];

/** Normalise one API row's metrics and derive the rates from raw counters. */
function dgMetrics_(row) {
  var m = row.metrics || {};
  return dgDerive_({
    impressions: dgNum_(m.impressions),
    clicks: dgNum_(m.clicks),
    cost: dgMicros_(m.costMicros),
    conversions: dgNum_(m.conversions),
    convValue: dgNum_(m.conversionsValue),
    viewThrough: dgNum_(m.viewThroughConversions),
    allConversions: dgNum_(m.allConversions),
    allConvValue: dgNum_(m.allConversionsValue),
    videoViews: dgNum_(m.videoTrueviewViews !== undefined
        ? m.videoTrueviewViews : m.videoViews),
    p25: dgNum_(m.videoQuartileP25Rate),
    p50: dgNum_(m.videoQuartileP50Rate),
    p75: dgNum_(m.videoQuartileP75Rate),
    p100: dgNum_(m.videoQuartileP100Rate)
  });
}

function dgDerive_(m) {
  m.ctr = dgSafe_(m.clicks, m.impressions);
  m.cpc = dgSafe_(m.cost, m.clicks);
  m.cvr = dgSafe_(m.conversions, m.clicks);
  m.cpa = dgSafe_(m.cost, m.conversions);
  m.roas = dgSafe_(m.convValue, m.cost);
  m.viewRate = dgSafe_(m.videoViews, m.impressions);
  m.allCpa = dgSafe_(m.cost, m.allConversions);
  m.convGap = Math.max(0, m.allConversions - m.conversions); // tracked, not bid on
  m.totalConv = m.conversions + m.viewThrough;
  m.cpaVtc = dgSafe_(m.cost, m.totalConv);                   // full-funnel CPA
  return m;
}

/** Sum an array of dgMetrics_ objects; quartiles are impression-weighted. */
function dgRollup_(rows) {
  var t = { impressions: 0, clicks: 0, cost: 0, conversions: 0, convValue: 0,
    viewThrough: 0, allConversions: 0, allConvValue: 0, videoViews: 0 };
  var wq = { p25: 0, p50: 0, p75: 0, p100: 0 };
  (rows || []).forEach(function(r) {
    for (var k in t) if (t.hasOwnProperty(k)) t[k] += (r[k] || 0);
    ['p25', 'p50', 'p75', 'p100'].forEach(function(q) {
      wq[q] += (r[q] || 0) * (r.impressions || 0);
    });
  });
  ['p25', 'p50', 'p75', 'p100'].forEach(function(q) {
    t[q] = dgSafe_(wq[q], t.impressions);
  });
  return dgDerive_(t);
}

function dgDateClause_(days) {
  var tz = Session.getScriptTimeZone();
  var end = new Date(); end.setDate(end.getDate() - 1);          // through yesterday
  var start = new Date(end); start.setDate(end.getDate() - (Math.max(1, days) - 1));
  var f = function(d) { return Utilities.formatDate(d, tz, 'yyyy-MM-dd'); };
  return { clause: "segments.date BETWEEN '" + f(start) + "' AND '" + f(end) + "'",
           start: f(start), end: f(end) };
}

// ---------------------------------------------------------------------------
// The pulls (each Demand Gen filtered; each isolated so one failure can't sink
// the rest — a failing slice is recorded in `warnings`).
// ---------------------------------------------------------------------------

/** Fast yes/no: does this account run any Demand Gen at all? */
function hasDemandGen(customerId) {
  try {
    var rows = dgSearch_(customerId,
        'SELECT campaign.id FROM campaign WHERE ' + DG_FILTER + ' LIMIT 1');
    return rows.length > 0;
  } catch (e) { return false; }
}

function getDemandGenData(customerId, days) {
  days = days || DG_CONFIG.DAYS;
  var out = { ok: false, hasDemandGen: false, warnings: [] };
  try {
    var range = dgDateClause_(days);
    var date = range.clause;
    var id = dgDigits_(customerId);

    function slice(label, fn) {
      try { return fn(); }
      catch (e) { out.warnings.push(label + ': ' + (e.message || e)); return null; }
    }

    // Account identity.
    var cust = slice('account', function() {
      var r = dgSearch_(id, 'SELECT customer.descriptive_name, ' +
          'customer.currency_code FROM customer LIMIT 1');
      var c = r.length ? r[0].customer : {};
      return { name: c.descriptiveName || 'Google Ads account',
               currency: c.currencyCode || 'USD' };
    }) || { name: 'Google Ads account', currency: 'USD' };

    out.account = { id: id, name: cust.name, currency: cust.currency,
        days: days, window: { start: range.start, end: range.end } };

    // Campaigns (also the source of account totals).
    var campaigns = slice('campaigns', function() {
      var rows = dgQuery_(id, ['campaign.id', 'campaign.name', 'campaign.status',
          'campaign.bidding_strategy_type', 'campaign_budget.amount_micros']
          .concat(DG_CORE, DG_VIDEO, DG_QUART), 'campaign',
          DG_FILTER + ' AND ' + date);
      return rows.map(function(r) {
        var o = dgMetrics_(r);
        o.id = dgGet_(r, 'campaign.id');
        o.name = dgGet_(r, 'campaign.name');
        o.status = dgGet_(r, 'campaign.status');
        o.bidding = dgPretty_(dgGet_(r, 'campaign.biddingStrategyType'));
        o.budget = dgMicros_(dgGet_(r, 'campaignBudget.amountMicros'));
        return o;
      });
    }) || [];
    out.hasDemandGen = campaigns.length > 0;
    out.campaigns = campaigns;
    out.totals = dgRollup_(campaigns);

    // Ad groups.
    out.adGroups = slice('adGroups', function() {
      var rows = dgQuery_(id, ['campaign.name', 'ad_group.id', 'ad_group.name',
          'ad_group.status'].concat(DG_CORE), 'ad_group',
          DG_FILTER + ' AND ' + date);
      return rows.map(function(r) {
        var o = dgMetrics_(r);
        o.name = dgGet_(r, 'adGroup.name');
        o.campaign = dgGet_(r, 'campaign.name');
        o.status = dgGet_(r, 'adGroup.status');
        return o;
      });
    }) || [];

    // Ads (and, from their final URLs, the landing-page rollup).
    var ads = slice('ads', function() {
      var rows = dgQuery_(id, ['campaign.name', 'ad_group.name',
          'ad_group_ad.ad.id', 'ad_group_ad.ad.type', 'ad_group_ad.status',
          'ad_group_ad.ad.name', 'ad_group_ad.ad.final_urls'].concat(DG_CORE),
          'ad_group_ad', DG_FILTER + ' AND ' + date);
      return rows.map(function(r) {
        var o = dgMetrics_(r);
        o.id = dgGet_(r, 'adGroupAd.ad.id');
        o.name = dgGet_(r, 'adGroupAd.ad.name') || '';
        o.type = dgPretty_(dgGet_(r, 'adGroupAd.ad.type'));
        o.status = dgGet_(r, 'adGroupAd.status');
        o.campaign = dgGet_(r, 'campaign.name');
        var urls = dgGet_(r, 'adGroupAd.ad.finalUrls');
        o.finalUrl = urls && urls.length ? urls[0] : '';
        return o;
      });
    }) || [];
    out.ads = ads;
    out.landingPages = dgLandingPages_(ads);

    // Videos, rolled up per creative with the watch-depth funnel.
    out.videos = slice('videos', function() { return dgVideos_(id, date); }) || [];

    // Non-video creative (images) + a headline count.
    out.creativeAssets = slice('creative', function() {
      return dgAssets_(id, date); }) || { videoCount: 0, imageCount: 0, images: [] };
    out.creativeAssets.videoCount = out.videos.length;

    // Audiences in use (targeting).
    out.audiences = slice('audiences', function() {
      var rows = dgQuery_(id, ['campaign.name', 'ad_group.name',
          'ad_group_criterion.type', 'ad_group_criterion.display_name']
          .concat(DG_CORE), 'ad_group_audience_view',
          DG_FILTER + ' AND ' + date);
      return rows.map(function(r) {
        var o = dgMetrics_(r);
        o.type = dgPretty_(dgGet_(r, 'adGroupCriterion.type'));
        o.name = dgGet_(r, 'adGroupCriterion.displayName') || o.type;
        o.campaign = dgGet_(r, 'campaign.name');
        return o;
      }).filter(function(r) { return r.impressions > 0; });
    }) || [];

    // Surfaces / formats (Shorts, in-feed, in-stream, …).
    out.surfaces = slice('surfaces', function() {
      var rows = dgQuery_(id, ['campaign.name', 'segments.ad_format_type']
          .concat(DG_CORE, DG_VIDEO), 'campaign', DG_FILTER + ' AND ' + date);
      var by = {};
      rows.forEach(function(r) {
        var key = dgPretty_(dgGet_(r, 'segments.adFormatType')) || 'Unsegmented';
        (by[key] = by[key] || []).push(dgMetrics_(r));
      });
      return Object.keys(by).map(function(k) {
        var o = dgRollup_(by[k]); o.surface = k; return o;
      }).filter(function(r) { return r.impressions > 0; })
        .sort(function(a, b) { return b.cost - a.cost; });
    }) || [];

    // Demographics: age + gender.
    out.demographics = slice('demographics', function() {
      return dgDemographics_(id, date); }) || { age: [], gender: [] };

    // Device split.
    out.devices = slice('devices', function() {
      var rows = dgQuery_(id, ['segments.device'].concat(DG_CORE), 'campaign',
          DG_FILTER + ' AND ' + date);
      var by = {};
      rows.forEach(function(r) {
        var key = dgPretty_(dgGet_(r, 'segments.device')) || 'Unknown';
        (by[key] = by[key] || []).push(dgMetrics_(r));
      });
      return Object.keys(by).map(function(k) {
        var o = dgRollup_(by[k]); o.device = k; return o;
      }).sort(function(a, b) { return b.cost - a.cost; });
    }) || [];

    // Conversion actions credited to Demand Gen.
    out.conversionActions = slice('conversionActions', function() {
      var rows = dgQuery_(id, ['segments.conversion_action_name',
          'segments.conversion_action_category', 'metrics.all_conversions',
          'metrics.all_conversions_value', 'metrics.conversions',
          'metrics.conversions_value'], 'campaign', DG_FILTER + ' AND ' + date,
          'metrics.all_conversions DESC');
      var by = {};
      rows.forEach(function(r) {
        var name = dgGet_(r, 'segments.conversionActionName') || 'Unnamed action';
        var a = by[name] || (by[name] = { action: name,
            category: dgPretty_(dgGet_(r, 'segments.conversionActionCategory')),
            allConversions: 0, allConvValue: 0, conversions: 0, convValue: 0 });
        a.allConversions += dgNum_(dgGet_(r, 'metrics.allConversions'));
        a.allConvValue += dgNum_(dgGet_(r, 'metrics.allConversionsValue'));
        a.conversions += dgNum_(dgGet_(r, 'metrics.conversions'));
        a.convValue += dgNum_(dgGet_(r, 'metrics.conversionsValue'));
      });
      return Object.keys(by).map(function(k) { return by[k]; })
        .filter(function(a) { return a.allConversions > 0 || a.conversions > 0; })
        .sort(function(a, b) { return b.allConversions - a.allConversions; });
    }) || [];

    out.ok = true;
    return out;
  } catch (e) {
    out.error = e.message || String(e);
    return out;
  }
}

function dgLandingPages_(ads) {
  var by = {};
  (ads || []).forEach(function(ad) {
    var url = ad.finalUrl || '';
    if (!url) return;
    var lp = by[url] || (by[url] = { url: url, cost: 0, conversions: 0,
        viewThrough: 0, clicks: 0, ads: 0 });
    lp.cost += ad.cost || 0;
    lp.conversions += ad.conversions || 0;
    lp.viewThrough += ad.viewThrough || 0;
    lp.clicks += ad.clicks || 0;
    lp.ads += 1;
  });
  return Object.keys(by).map(function(u) {
    var lp = by[u];
    lp.cpa = dgSafe_(lp.cost, lp.conversions);
    lp.cvr = dgSafe_(lp.conversions, lp.clicks);
    return lp;
  }).sort(function(a, b) { return b.cost - a.cost; });
}

function dgVideos_(id, date) {
  var rows = dgQuery_(id, ['campaign.name', 'asset.id',
      'asset.youtube_video_asset.youtube_video_id',
      'asset.youtube_video_asset.youtube_video_title', 'asset.name']
      .concat(DG_CORE, DG_VIDEO, DG_QUART), 'ad_group_ad_asset_view',
      DG_FILTER + " AND asset.type = 'YOUTUBE_VIDEO' AND " + date);
  var by = {};
  rows.forEach(function(r) {
    var aid = dgGet_(r, 'asset.id');
    var yt = dgGet_(r, 'asset.youtubeVideoAsset.youtubeVideoId') || '';
    var v = by[aid] || (by[aid] = { id: aid, videoId: yt,
        title: dgGet_(r, 'asset.youtubeVideoAsset.youtubeVideoTitle') ||
               dgGet_(r, 'asset.name') || ('Video ' + aid),
        url: yt ? 'https://www.youtube.com/watch?v=' + yt : '',
        rows: [] });
    v.rows.push(dgMetrics_(r));
  });
  return Object.keys(by).map(function(k) {
    var v = by[k]; var m = dgRollup_(v.rows);
    for (var f in m) if (m.hasOwnProperty(f)) v[f] = m[f];
    delete v.rows;
    return v;
  }).filter(function(v) { return v.impressions > 0; })
    .sort(function(a, b) { return b.cost - a.cost; });
}

function dgAssets_(id, date) {
  var rows = dgQuery_(id, ['asset.id', 'asset.type', 'asset.name',
      'asset.image_asset.full_size.url', 'metrics.impressions',
      'metrics.cost_micros', 'metrics.conversions'], 'ad_group_ad_asset_view',
      DG_FILTER + ' AND ' + date);
  var images = {}, videos = {};
  rows.forEach(function(r) {
    var type = dgGet_(r, 'asset.type');
    var aid = dgGet_(r, 'asset.id');
    if (type === 'IMAGE') {
      images[aid] = images[aid] || { id: aid,
          name: dgGet_(r, 'asset.name') || ('Image ' + aid),
          url: dgGet_(r, 'asset.imageAsset.fullSize.url') || '' };
    } else if (type === 'YOUTUBE_VIDEO') {
      videos[aid] = true;
    }
  });
  var imgList = Object.keys(images).map(function(k) { return images[k]; });
  return { imageCount: imgList.length, videoCount: Object.keys(videos).length,
           images: imgList.slice(0, 40) };
}

function dgDemographics_(id, date) {
  var out = { age: [], gender: [] };
  [['age_range_view', 'age', 'ageRange'],
   ['gender_view', 'gender', 'gender']].forEach(function(p) {
    var rows = dgQuery_(id, ['ad_group_criterion.' + p[2] + '.type']
        .concat(DG_CORE), p[0], DG_FILTER + ' AND ' + date);
    var by = {};
    rows.forEach(function(r) {
      var band = dgPretty_(dgGet_(r, 'adGroupCriterion.' + p[2] + '.type')) ||
          'Unknown';
      (by[band] = by[band] || []).push(dgMetrics_(r));
    });
    out[p[1]] = Object.keys(by).map(function(k) {
      var o = dgRollup_(by[k]); o.band = k; return o;
    }).filter(function(r) { return r.impressions > 0; });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Text summary — what you splice into your model prompt
// ---------------------------------------------------------------------------

function dgMoney_(v, cur) {
  return (cur || 'USD') + ' ' + (Math.round((v || 0) * 100) / 100)
      .toLocaleString(undefined, { minimumFractionDigits: 2,
        maximumFractionDigits: 2 });
}
function dgPct_(v) { return (Math.round((v || 0) * 1000) / 10) + '%'; }
function dgInt_(v) { return Math.round(v || 0).toLocaleString(); }
function dgDec_(v) { return (Math.round((v || 0) * 100) / 100).toLocaleString(); }

/**
 * Render the pulled data as a compact, model-friendly markdown block. Keep it
 * factual — it is data for the model to reason over, not prose.
 */
function demandGenSummary(data) {
  if (!data || !data.ok) {
    return '## Demand Gen\n(Data pull failed' +
        (data && data.error ? ': ' + data.error : '') + '.)';
  }
  if (!data.hasDemandGen) {
    return '## Demand Gen\nThis account runs NO Demand Gen campaigns in the ' +
        'window (' + data.account.window.start + ' to ' + data.account.window.end +
        '). Treat Demand Gen as a launch opportunity, not an existing channel.';
  }
  var cur = data.account.currency, t = data.totals, N = DG_CONFIG.MAX_ROWS_IN_SUMMARY;
  var L = [];
  L.push('## Demand Gen audit data');
  L.push('Account: ' + data.account.name + ' (' + data.account.id + '), ' + cur +
      '. Window: ' + data.account.window.start + ' to ' + data.account.window.end +
      ' (' + data.account.days + ' days).');
  if (data.warnings && data.warnings.length) {
    L.push('_Partial pulls: ' + data.warnings.join('; ') + '._');
  }

  L.push('');
  L.push('### Totals');
  L.push('- Spend: ' + dgMoney_(t.cost, cur));
  L.push('- Impressions: ' + dgInt_(t.impressions) + ' · Clicks: ' +
      dgInt_(t.clicks) + ' · CTR: ' + dgPct_(t.ctr));
  L.push('- Conversions (bidding): ' + dgDec_(t.conversions) + ' · CPA: ' +
      dgMoney_(t.cpa, cur) + ' · ROAS: ' + dgDec_(t.roas));
  L.push('- View-through conv: ' + dgDec_(t.viewThrough) + ' · Full-funnel CPA ' +
      '(incl. VTC): ' + dgMoney_(t.cpaVtc, cur));
  L.push('- All-conversions (every tracked action): ' + dgDec_(t.allConversions) +
      '. Actions tracked but NOT in the bidding column: ' + dgDec_(t.convGap));
  L.push('- Video view rate: ' + dgPct_(t.viewRate) + '. Watch-depth funnel — ' +
      '25%: ' + dgPct_(t.p25) + ' · 50%: ' + dgPct_(t.p50) + ' · 75%: ' +
      dgPct_(t.p75) + ' · 100%: ' + dgPct_(t.p100));

  L.push(dgTable_('Campaigns', data.campaigns, N, cur,
      ['name', 'status', 'bidding'], true));
  L.push(dgTable_('Top videos (per creative, with watch depth)', data.videos, N, cur,
      ['title'], true, true));
  L.push(dgTable_('Audiences in use', data.audiences, N, cur, ['name', 'type'], true));
  L.push(dgTable_('Surfaces / formats', data.surfaces, N, cur, ['surface'], true));
  L.push(dgTable_('Landing pages (where spend lands)', data.landingPages, N, cur,
      ['url'], false));
  L.push(dgDemoBlock_('Age', (data.demographics || {}).age, cur));
  L.push(dgDemoBlock_('Gender', (data.demographics || {}).gender, cur));
  L.push(dgTable_('Devices', data.devices, N, cur, ['device'], false));

  // Conversion actions (different shape — no rate metrics).
  var ca = (data.conversionActions || []).slice(0, N);
  if (ca.length) {
    L.push('');
    L.push('### Conversion actions credited to Demand Gen');
    ca.forEach(function(a) {
      L.push('- ' + a.action + (a.category ? ' [' + a.category + ']' : '') +
          ': all-conv ' + dgDec_(a.allConversions) + ', bidding-conv ' +
          dgDec_(a.conversions));
    });
  }

  var img = (data.creativeAssets || {});
  L.push('');
  L.push('### Creative inventory');
  L.push('- ' + (img.videoCount || 0) + ' YouTube video asset(s), ' +
      (img.imageCount || 0) + ' image asset(s).');

  return L.join('\n');
}

/** Generic table renderer for the metric-bearing slices. */
function dgTable_(title, rows, n, cur, labelKeys, showConv, isVideo) {
  rows = (rows || []).slice(0, n);
  if (!rows.length) return '';
  var out = ['', '### ' + title];
  rows.forEach(function(r) {
    var label = labelKeys.map(function(k) { return r[k]; })
        .filter(Boolean).join(' · ') || '(unnamed)';
    var bits = ['spend ' + dgMoney_(r.cost, cur),
        'impr ' + dgInt_(r.impressions)];
    if (showConv) bits.push('conv ' + dgDec_(r.conversions) + ' @ ' +
        dgMoney_(r.cpa, cur));
    else bits.push('conv ' + dgDec_(r.conversions) + ' · CVR ' + dgPct_(r.cvr));
    if (r.viewThrough) bits.push('VTC ' + dgDec_(r.viewThrough));
    if (isVideo) bits.push('view rate ' + dgPct_(r.viewRate) +
        ' · 100% ' + dgPct_(r.p100));
    out.push('- ' + label + ' — ' + bits.join(', '));
  });
  return out.join('\n');
}

function dgDemoBlock_(title, rows, cur) {
  rows = (rows || []);
  if (!rows.length) return '';
  var out = ['', '### Demographics · ' + title];
  rows.sort(function(a, b) { return b.cost - a.cost; }).forEach(function(r) {
    out.push('- ' + r.band + ' — spend ' + dgMoney_(r.cost, cur) + ', conv ' +
        dgDec_(r.conversions) + ', CPA ' + dgMoney_(r.cpa, cur));
  });
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Prompt instructions — add this to your model's system / instruction text so
// it folds the Demand Gen data above into the overall account audit.
// ---------------------------------------------------------------------------

var DG_PROMPT_INSTRUCTIONS = [
  'A "Demand Gen audit data" section is included with this account. Fold it',
  'into the overall audit as its own findings area. Demand Gen is a SOCIAL and',
  'CREATIVE channel on YouTube, not a search channel, so judge it accordingly:',
  '',
  '- Lead with creative and landing pages as the levers, not keywords or match',
  '  types. If most spend lands on a generic product page, call that out and',
  '  recommend a purpose-built page.',
  '- Read performance on the full funnel, not last-click purchases alone: the',
  '  25/50/75/100% video watch-depth funnel, view rate, view-through',
  '  conversions, and the full-funnel CPA (incl. VTC). A purchase-only lens',
  '  understates Demand Gen.',
  '- Note the gap between all-conversions and bidding conversions: mid-funnel',
  '  actions (Add to Cart, Begin Checkout) tracked but not fed to bidding are a',
  '  common, fixable miss — recommend promoting them as signal.',
  '- Check audience seeding: prospecting should exclude existing purchasers, and',
  '  seed from watching behaviour / best organic + paid-social creative rather',
  '  than search-style intent lists.',
  '- Where a figure is weak, say so plainly; do not make everything look fine.',
  '',
  'Use only the numbers provided. Never invent a metric, label, or date; if a',
  'figure looks wrong, flag it rather than "correcting" it.'
].join('\n');

/**
 * Convenience: everything an audit prompt needs for one account, in one call.
 * Returns { ok, hasDemandGen, summary, instructions, data }.
 */
function demandGenForPrompt(customerId, days) {
  var data = getDemandGenData(customerId, days);
  return {
    ok: data.ok,
    hasDemandGen: data.hasDemandGen,
    summary: demandGenSummary(data),
    instructions: DG_PROMPT_INSTRUCTIONS,
    data: data
  };
}
