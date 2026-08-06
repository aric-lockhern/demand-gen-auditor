/**
 * ============================================================================
 * DEMAND GEN AUDIT — Apps Script + Google Ads API
 * ============================================================================
 *
 * Runs entirely on read-only Google Ads access. The API permits reads for
 * read-only users; only mutates are blocked. Nothing here mutates.
 *
 * WHY THIS INSTEAD OF A GOOGLE ADS SCRIPT
 *   Google Ads Scripts require Standard or Admin access to create. Apps Script
 *   does not, because the permission check happens in the Ads API against your
 *   OAuth identity. It also gains HtmlService, so the dashboard is a real URL
 *   rather than a file you have to host yourself.
 *
 * SETUP
 *   1. sheets.google.com > new sheet > Extensions > Apps Script.
 *   2. Create three files matching this bundle: Code.gs, Index.html, and the
 *      manifest. For the manifest, click the gear icon > "Show appsscript.json
 *      manifest file in editor", then replace its contents.
 *   3. Fill in CONFIG below. Customer IDs are digits only — no hyphens.
 *   4. Run installTrigger once. Approve the consent screen, which will ask for
 *      Google Ads access. This is the step that binds your read-only identity.
 *   5. Run refresh manually to confirm a clean pull.
 *   6. Deploy > New deployment > Web app.
 *        Execute as: Me
 *        Who has access: see SHARING below
 *
 * SHARING
 *   "Execute as: Me" is required — it makes the web app use your Ads access, so
 *   the client never needs a Google Ads seat. But that also means anyone who can
 *   open the URL sees the data. Prefer "Anyone with Google account" over
 *   "Anyone" so access is at least tied to an identity, and treat the URL as a
 *   credential. For a named client, "Anyone within <your domain>" plus a PDF
 *   export is usually the cleaner handoff.
 *
 * EXECUTION LIMITS
 *   Apps Script allows 6 minutes per execution on consumer accounts and 30 on
 *   Workspace. This pull runs roughly 15 queries plus asset resolution. If you
 *   hit the ceiling, set SKIP_PLACEMENTS true first — it is the heaviest and
 *   least reliable slice for Demand Gen — then narrow LAST_N_DAYS.
 * ============================================================================
 */

var CONFIG = {
  // Everything below is only a fallback. Live values come from the Settings
  // tab of this spreadsheet and from Script Properties, so switching clients
  // never means editing this file. Run setup() once to create the tab.

  // Filled from the Settings tab. Digits or hyphens, both work.
  ACCOUNTS: [],

  // Script Property LOGIN_CUSTOMER_ID. Your manager account. Needed only when
  // you reach the client account through an MCC.
  LOGIN_CUSTOMER_ID: '',

  // Script Property DEVELOPER_TOKEN. Kept out of the spreadsheet so sharing
  // the Sheet never leaks it.
  DEVELOPER_TOKEN: '',

  // v25 released July 2026, supported to July 2027.
  API_VERSION: 'v25',

  LAST_N_DAYS: 30,
  COMPARE_PRIOR_PERIOD: true,

  // Rows kept per table in the dashboard. The Sheet always gets everything.
  TOP_N: 150,

  HIDE_ZERO_IMPRESSION_ROWS: true,

  // Placement reporting is slow and patchy for Demand Gen. Drop it first.
  SKIP_PLACEMENTS: false,

  WRITE_SHEET: true,

  // Lets dashboard viewers star video assets. Anyone who can open the web
  // app can write these, so turn it off for read-only client links.
  ALLOW_LABELING: true,

  // Per account. Apps Script allows 6 minutes per execution on consumer
  // accounts, 30 on Workspace, so multi-account runs need a per-account cap.
  TIME_BUDGET_SECONDS: 240
};

var CHANNELS = {
  YOUTUBE: { label: 'YouTube', color: '#E8503A' },
  GOOGLE_OWNED_CHANNELS: { label: 'Discover & Gmail', color: '#2F6BE0' },
  CONTENT: { label: 'Display', color: '#E0A030' },
  MIXED: { label: 'Cross-network', color: '#7B58C8' },
  SEARCH: { label: 'Search', color: '#3AA98C' },
  SEARCH_PARTNERS: { label: 'Search partners', color: '#3AA98C' },
  UNKNOWN: { label: 'Unattributed', color: '#8A8F9E' },
  UNSPECIFIED: { label: 'Unattributed', color: '#8A8F9E' }
};

// Ad format segmentation is supported for Video and Demand Gen only. PAUSE is
// the TV-screen surface: image ads beside a paused organic YouTube video.
var FORMATS = {
  SHORTS: { label: 'YouTube Shorts', color: '#E8503A' },
  INFEED: { label: 'In-feed', color: '#2F6BE0' },
  INSTREAM_SKIPPABLE: { label: 'In-stream skippable', color: '#7B58C8' },
  INSTREAM_NON_SKIPPABLE: { label: 'In-stream non-skippable', color: '#9C6BD6' },
  BUMPER: { label: 'Bumper', color: '#C05E9E' },
  PAUSE: { label: 'Pause screen (TV)', color: '#1F8A8A' },
  MASTHEAD: { label: 'Masthead', color: '#E0A030' },
  OUTSTREAM: { label: 'Outstream', color: '#B8843C' },
  AUDIO: { label: 'Audio', color: '#6E7484' },
  VERTICAL_ADS_PROMOTION: { label: 'Vertical promotion', color: '#8A8F9E' },
  TEXT: { label: 'Text', color: '#8A8F9E' },
  OTHER: { label: 'Other formats', color: '#A2A8B4' },
  UNSEGMENTED: { label: 'Unsegmented', color: '#C2C6CE' },
  UNKNOWN: { label: 'Unsegmented', color: '#C2C6CE' },
  UNSPECIFIED: { label: 'Unsegmented', color: '#C2C6CE' },
  // Fallback slice, when only sub-network segmentation is available.
  YOUTUBE_SHORTS: { label: 'YouTube Shorts', color: '#E8503A' },
  YOUTUBE_INFEED: { label: 'YouTube in-feed', color: '#2F6BE0' },
  YOUTUBE_INSTREAM: { label: 'YouTube in-stream', color: '#7B58C8' }
};

// Asset optimisation toggles. The first two are the "Shorter videos" and
// "Resized videos" switches in the Asset optimization panel.
var ASSET_AUTOMATION = {
  GENERATE_SHORTER_YOUTUBE_VIDEOS: 'Shorter videos',
  GENERATE_VERTICAL_YOUTUBE_VIDEOS: 'Resized videos',
  GENERATE_ENHANCED_YOUTUBE_VIDEOS: 'Enhanced videos',
  GENERATE_VIDEOS_FROM_OTHER_ASSETS: 'Videos from other assets',
  GENERATE_DESIGN_VERSIONS_FOR_IMAGES: 'Design versions for images',
  GENERATE_IMAGE_ENHANCEMENT: 'Image enhancement',
  GENERATE_IMAGE_EXTRACTION: 'Images from landing page',
  GENERATE_LANDING_PAGE_PREVIEW: 'Landing page preview',
  TEXT_ASSET_AUTOMATION: 'Text asset automation',
  FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION: 'Final URL expansion text'
};

// Campaign settings the API does not reliably expose; verified manually in the
// dashboard and carried into the deck. Keep in sync with the dashboard copy.
var CAMPAIGN_REVIEW_FIELDS = [
  ['viewThroughOpt', 'View-through conversion optimization'],
  ['productFeeds', 'Product feeds'],
  ['devices', 'Device targeting'],
  ['gdn', 'Google Display Network'],
  ['thirdParty', 'Third-party measurement'],
  ['ipExclusions', 'IP exclusions'],
  ['urlOptions', 'Campaign URL options'],
  ['brandGuidelines', 'Brand guidelines']
];

/**
 * The asset-automation panel for a campaign, reported honestly.
 *
 * We show the full list of toggles the Ads UI exposes so the auditor has a
 * complete checklist, but we NEVER invent a state: a toggle is ON/OFF only when
 * the API actually reports it (`verified: true`). Anything the API does not
 * return is left as `on: null` — "review in platform" — rather than assumed Off,
 * because assuming Off is exactly how we mislabelled an enabled setting before.
 * The dashboard lets the auditor set the true value manually where the API is
 * silent.
 */
function mergeAutomation_(raw) {
  var reported = {};
  (raw || []).forEach(function(item) {
    if (item && item.assetAutomationType) {
      reported[item.assetAutomationType] =
          item.assetAutomationStatus === 'OPTED_IN';
    }
  });
  var order = Object.keys(ASSET_AUTOMATION);
  Object.keys(reported).forEach(function(type) {
    if (order.indexOf(type) === -1) order.push(type);
  });
  return order.map(function(type) {
    var has = reported.hasOwnProperty(type);
    return {
      type: type,
      name: ASSET_AUTOMATION[type] || pretty_(type),
      on: has ? reported[type] : null,   // null = the API said nothing; review
      verified: has
    };
  });
}

var ACQUISITION_MODES = {
  TARGET_ALL_EQUALLY: 'New and existing equally (default)',
  BID_HIGHER_FOR_NEW_CUSTOMER: 'Bids higher for new customers',
  TARGET_NEW_CUSTOMER: 'New customers only'
};

var DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY',
            'SUNDAY'];

var DGEN = "campaign.advertising_channel_type = 'DEMAND_GEN'";

// ============================================================================
// BRAND — Lockhern Digital
// ============================================================================
// One source of truth for palette, type and logos. The dashboard :root tokens,
// the Slides deck THEME and the deck-redesign prompt all read from here, so a
// brand tweak never means editing three places. Hex values carry the leading
// '#'. For pptxgenjs (which rejects '#'), brandHex_() strips it.
var BRAND = {
  name: 'Lockhern Digital',
  primary:   '#317AE0', // Primary blue — headlines, key figures, links
  secondary: '#2E51C0', // Secondary blue — royal/indigo mid-tone
  tertiary:  '#0E2970', // Tertiary blue — navy, dark backgrounds
  ink:       '#0E0E0E', // Near-black text
  white:     '#FFFFFF',
  grayDark:  '#6B7A99', // Dark gray — the logo's slate, secondary text
  grayMid:   '#BAC3D6', // Mid gray — muted lines, disabled
  grayLight: '#E7ECF4', // Light gray — washes, card fills
  titleFont: 'Fraunces',
  bodyFont:  'Figtree',
  // Logo data URIs (base64, e.g. "data:image/png;base64,..."). Filled once the
  // logo files are dropped into place. Empty is safe everywhere — every consumer
  // guards on truthiness and falls back to the wordmark in text.
  logoColor: '', // full colour logo: LD monogram + wordmark, for light slides
  logoWhite: '', // all-white logo, for the navy title/closing slides
  logoMark:  ''  // LD monogram only, for tight corners and the dashboard header
};

/** Strip the leading '#' for tools (pptxgenjs) that reject it. */
function brandHex_(key) { return String(BRAND[key] || '').replace('#', ''); }

// ============================================================================
// POV — the strategy this audit argues
// ============================================================================
// From the talk "Demand Gen for people who don't like Demand Gen." The whole
// point of the tool is to land THIS argument in a real account, so the thesis
// lives as data the analysis prompt, the brief and the deck can all quote
// verbatim rather than each paraphrasing it differently.
var POV = {
  title: "Demand Gen for people who don't like Demand Gen",
  thesis: 'Demand Gen is a social and creative channel, not a search channel. ' +
      'YouTube is social and should be bought like social: creative and landing ' +
      'pages are the levers, and success shows up first in attention and ' +
      'mid-funnel signal, not last-click purchases. Audit it on that basis.',
  // The strategic principles the account should be judged against.
  principles: [
    'Stop thinking like a search marketer and start thinking like a social ' +
        'buyer. YouTube is social; treat it as such.',
    'Creative and landing pages are the levers. Driving to a standard product ' +
        'page is usually not good enough — build purpose-made pages.',
    'Seed audiences from watching behaviour and from the best-performing ' +
        'organic and Meta content, rather than search-style intent lists.',
    'Set additional KPIs (Add to Cart, Begin Checkout) to Primary, and keep ' +
        'Purchases in a custom group so other campaigns can still optimise to ' +
        'purchase only. Google discourages mixing conversion goals; we do it ' +
        'deliberately to feed the algorithm mid-funnel signal.',
    'Set client expectations before launch. This is not supposed to work off ' +
        'the rip. Align on KPIs first.'
  ],
  // "Use metrics you probably don't want to use." The upper- and mid-funnel
  // read that a purchase-only lens misses.
  metrics: [
    'Video completion rate across the 25% / 50% / 75% / 100% quartiles',
    'The AI-modified videos (Shortened / Enhanced by Google AI) — review them ' +
        'directly; their watch-through and cost often diverge from the original',
    'Click-through rate',
    'View-through conversions',
    'Attributed brand searches',
    "Full-funnel impact (Google's report)",
    'Brand lift study (roughly 10K over 10 days)',
    'Cost per quiz or email submit'
  ],
  // The measurement foundation — still start from hard outcomes, then layer signal.
  foundation: [
    'Always start from conversion, CPA or ROAS, and make sure a conversion ' +
        'exists for any quiz or email submit.',
    'Add as many signals as possible — Add to Cart, Begin Checkout — so the ' +
        'algorithm has more to learn from.',
    'Run brand lift studies and incremental tests with your Google reps.',
    'Use post-purchase surveys, and use the CRM to tie purchases back to email ' +
        'and quiz submits.'
  ],
  expectation: 'This is not supposed to work off the rip. Set expectations and ' +
      'align on KPIs before launch, then judge it on the signals above.'
};

var CORE_METRICS = [
  'metrics.impressions',
  'metrics.clicks',
  'metrics.cost_micros',
  'metrics.conversions',
  'metrics.conversions_value',
  'metrics.view_through_conversions'
];
// Renamed in v22: video_views became video_trueview_views. metricsOf_
// reads either, so pinning an older API version still works.
var VIDEO_METRICS = ['metrics.video_trueview_views'];
// "All conv." counts every tracked conversion action; "Conversions"
// counts only those included in the Conversions column for bidding.
var ALL_CONV_METRICS = ['metrics.all_conversions',
                        'metrics.all_conversions_value'];
var QUARTILE_METRICS = [
  'metrics.video_quartile_p25_rate',
  'metrics.video_quartile_p50_rate',
  'metrics.video_quartile_p75_rate',
  'metrics.video_quartile_p100_rate'
];
var ENGAGEMENT_METRICS = ['metrics.engagements', 'metrics.interactions'];

var RUN_LOG = [];
var COUNTS = {};
var STARTED_AT = 0;
var PAYLOAD_PREFIX = '_payload_';
var SETTINGS_SHEET = 'Settings';
// The account this execution is currently reporting on.
var CURRENT = null;
var PAYLOAD_CHUNK = 45000;  // Sheets caps a cell at 50,000 characters.
var LABELS_SHEET = '_labels';
var OVERRIDES_SHEET = '_overrides';

// ===========================================================================
// ENTRY POINTS
// ===========================================================================

/** Serves the dashboard. Reads the cached payload — never queries live. */
/** Spreadsheet menu so refreshes do not require opening the script editor. */
function onOpen() {
  SpreadsheetApp.getUi()
      .createMenu('Demand Gen audit')
      .addItem('Refresh all accounts', 'refresh')
      .addItem('Create or repair Settings tab', 'setup')
      .addSeparator()
      .addItem('Prepare commentary tab', 'setupCommentary')
      .addItem('Build slide deck', 'buildDeck')
      .addSeparator()
      .addItem('Install daily refresh', 'installTrigger')
      .addToUi();
}

/**
 * Creates the Settings tab. Safe to re-run: existing values are preserved and
 * only missing rows are added.
 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open this from the bound spreadsheet.');

  var rows = [
    ['Accounts to report', '123-456-7890',
     'Comma-separated Google Ads customer IDs. Hyphens optional.'],
    ['Days to report', 30, 'Size of the reporting window.'],
    ['Compare with prior period', true,
     'Adds the preceding window of equal length for deltas.'],
    ['Rows per table', 150, 'Dashboard only. The Sheet always gets everything.'],
    ['Include placements', false,
     'Slow and patchy for Demand Gen. Turn off first if runs time out.'],
    ['Allow starring in dashboard', true,
     'Turn off for read-only client links.'],
    ['Google Ads API version', 'v25', 'Bump when a version sunsets.']
  ];

  var sheet = ss.getSheetByName(SETTINGS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SETTINGS_SHEET, 0);
    sheet.getRange(1, 1, 1, 3)
        .setValues([['Setting', 'Value', 'Notes']])
        .setFontWeight('bold').setBackground('#191C24').setFontColor('#FFFFFF');
    sheet.getRange(2, 1, rows.length, 3).setValues(rows);
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 230);
    sheet.setColumnWidth(2, 220);
    sheet.setColumnWidth(3, 460);
  } else {
    var existing = {};
    var last = sheet.getLastRow();
    if (last > 1) {
      sheet.getRange(2, 1, last - 1, 1).getValues().forEach(function(r) {
        existing[String(r[0]).trim()] = true;
      });
    }
    rows.forEach(function(row) {
      if (!existing[row[0]]) sheet.appendRow(row);
    });
  }

  var props = PropertiesService.getScriptProperties();
  var missing = ['DEVELOPER_TOKEN'].filter(function(key) {
    return !props.getProperty(key);
  });

  var message = 'Settings tab ready. Enter your account IDs there.';
  if (missing.length) {
    message += '\n\nStill needed: Project Settings > Script Properties > add ' +
        missing.join(', ') + '. Add LOGIN_CUSTOMER_ID too if you reach these ' +
        'accounts through a manager account. Secrets live there rather than in ' +
        'the Sheet so sharing the Sheet cannot leak them.';
  }
  Logger.log(message);
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    // No UI when run from the editor or a trigger.
  }
  return message;
}

/** Merges Script Properties and the Settings tab over the fallbacks above. */
function loadSettings_() {
  var props = PropertiesService.getScriptProperties();
  ['DEVELOPER_TOKEN', 'LOGIN_CUSTOMER_ID'].forEach(function(key) {
    var value = props.getProperty(key);
    if (value) CONFIG[key] = String(value).trim();
  });

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss && ss.getSheetByName(SETTINGS_SHEET);
  if (sheet && sheet.getLastRow() > 1) {
    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    var map = {};
    values.forEach(function(row) {
      map[String(row[0]).trim().toLowerCase()] = row[1];
    });

    // Assign whenever the row exists, including when it is blank. Skipping on
    // falsy would silently reuse the previous run's accounts after a clear.
    if (map.hasOwnProperty('accounts to report')) {
      CONFIG.ACCOUNTS = String(map['accounts to report'] || '').split(/[,\n;]+/)
          .map(function(id) { return digits_(id); })
          .filter(function(id) { return id.length >= 8; });
    }
    if (map['days to report']) CONFIG.LAST_N_DAYS = Number(map['days to report']);
    if (map['rows per table']) CONFIG.TOP_N = Number(map['rows per table']);
    if (map['google ads api version']) {
      CONFIG.API_VERSION = String(map['google ads api version']).trim();
    }
    CONFIG.COMPARE_PRIOR_PERIOD = truthy_(map['compare with prior period'], true);
    CONFIG.SKIP_PLACEMENTS = !truthy_(map['include placements'], false);
    CONFIG.ALLOW_LABELING = truthy_(map['allow starring in dashboard'], true);
  }

  if (!CONFIG.DEVELOPER_TOKEN) {
    throw new Error('No developer token. Add DEVELOPER_TOKEN under Project ' +
        'Settings > Script Properties, then run refresh again.');
  }
  if (!CONFIG.ACCOUNTS.length) {
    throw new Error('No accounts listed. Run setup(), then put your customer ' +
        'IDs in the Settings tab under "Accounts to report".');
  }
  return CONFIG.ACCOUNTS;
}

function truthy_(value, fallback) {
  if (value === '' || value === null || value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  return /^(true|yes|y|1|on)$/i.test(String(value).trim());
}

/** Serves the dashboard for one account. */
function doGet(e) {
  var wanted = (e && e.parameter && e.parameter.account)
      ? digits_(e.parameter.account) : '';
  var available = cachedAccounts_();
  var chosen = wanted && available.some(function(a) { return a.id === wanted; })
      ? wanted
      : (available.length ? available[0].id : '');

  var template = HtmlService.createTemplateFromFile('Index');
  // Escape "<" so ad copy containing markup cannot close the script tag.
  template.payload = ((chosen && readPayload_(chosen)) || 'null')
      .replace(/</g, '\\u003c');
  template.labels = (readLabels_() || '{}').replace(/</g, '\\u003c');
  template.canLabel = readSetting_('allow starring in dashboard', true)
      ? 'true' : 'false';
  template.accounts = JSON.stringify(available).replace(/</g, '\\u003c');
  template.current = JSON.stringify(chosen);
  template.baseUrl = JSON.stringify(webAppUrl_());
  template.brand = JSON.stringify(BRAND).replace(/</g, '\\u003c');
  template.overrides = JSON.stringify(readOverrides_()).replace(/</g, '\\u003c');

  return template.evaluate()
      .setTitle('Demand Gen Audit')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** The deployed web app URL, used by the account picker to reload. */
function webAppUrl_() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (e) {
    return '';
  }
}

/** Reads one Settings value without a full load. Used by doGet. */
function readSetting_(key, fallback) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss && ss.getSheetByName(SETTINGS_SHEET);
    if (!sheet || sheet.getLastRow() < 2) return fallback;
    var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][0]).trim().toLowerCase() === key) {
        return truthy_(values[i][1], fallback);
      }
    }
  } catch (e) {
    // Fall through to the default.
  }
  return fallback;
}

/** Pulls every listed account, writes the Sheet, and caches each payload. */
function refresh() {
  var accounts = loadSettings_();
  var results = [];

  accounts.forEach(function(id) {
    STARTED_AT = new Date().getTime();
    RUN_LOG = [];
    COUNTS = {};
    CURRENT = { id: id };
    try {
      var data = auditAccount_(id);
      results.push(data);
      savePayload_(data);
    } catch (err) {
      log_('FAILED ' + formatId_(id), String(err.message || err).slice(0, 300));
      Logger.log('Account ' + formatId_(id) + ' failed: ' + err);
    }
  });

  if (CONFIG.WRITE_SHEET && results.length) writeSheets_(results);
  Logger.log('Finished ' + results.length + ' of ' + accounts.length +
      ' account(s).');
  return results.length;
}

/** Pulls a single account. */
function auditAccount_(customerId) {
  var range = buildDateRange_();
  var customer = pullCustomer_();

  log_('Account', customer.name + ' (' + formatId_(customerId) + ')');
  log_('Window', range.start + ' to ' + range.end);

  var data = {
    account: {
      name: customer.name,
      id: formatId_(customerId),
      rawId: digits_(customerId),
      currency: customer.currency,
      timeZone: customer.timeZone,
      start: range.start,
      end: range.end,
      priorStart: range.priorStart,
      priorEnd: range.priorEnd,
      generated: Utilities.formatDate(
          new Date(), customer.timeZone, 'MMM d, yyyy h:mm a')
    },
    campaigns: pullCampaigns_(range.current),
    channels: pullChannels_(range.current),
    adGroups: pullAdGroups_(range.current),
    ads: pullAds_(range.current),
    adChannels: pullAdChannels_(range.current),
    audiences: pullAudiences_(range.current),
    assets: pullAssets_(range.current),
    videos: pullVideos_(range.current),
    conversionActions: pullConversionActions_(range.current),
    demographics: pullDemographics_(range.current),
    devices: pullDevices_(range.current),
    surfaces: pullSurfaces_(range.current),
    settings: pullSettings_(),
    adGroupSettings: pullAdGroupSettings_(),
    placements: CONFIG.SKIP_PLACEMENTS ? [] : pullPlacements_(range.current),
    daily: pullDaily_(range.current)
  };

  if (!data.campaigns.length) {
    log_('Result', 'No Demand Gen campaigns with data in this window.');
  }

  var assetUrls = attachCreatives_(data.ads);
  backfillVideoIdentity_(data.videos, assetUrls);
  data.creativePacking = packingOf_(data.ads);
  data.landingPages = landingPagesOf_(data.ads);
  backfillVideoQuartiles_(data.videos, data.ads);
  attachVideoConversions_(data.videos, data.ads, range.current);
  data.totals = rollup_(data.campaigns);
  data.prior = range.prior ? rollup_(pullCampaigns_(range.prior)) : null;
  data.channelMix = rollupBy_(data.channels, 'channel');
  data.surfaceMix = rollupBy_(data.surfaces, 'surface');
  data.surfaceMix.forEach(function(row) {
    var match = null;
    for (var i = 0; i < data.surfaces.length; i++) {
      if (data.surfaces[i].surface === row.surface) {
        match = data.surfaces[i];
        break;
      }
    }
    row.color = match ? match.color : '#A2A8B4';
  });
  data.deviceMix = rollupBy_(data.devices, 'device');
  data.counts = COUNTS;
  data.readout = {
    conversions: buildReadout_(data, 'conversions'),
    all: buildReadout_(data, 'all')
  };
  data.runLog = RUN_LOG.slice();
  data.brief = buildBrief_(data);

  log_('Done', Math.round((new Date().getTime() - STARTED_AT) / 1000) + 's');
  return data;
}

/** Which accounts already have a cached payload, for the dashboard picker. */
function cachedAccounts_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return [];
  return ss.getSheets().map(function(sheet) {
    var name = sheet.getName();
    if (name.indexOf(PAYLOAD_PREFIX) !== 0) return null;
    var id = name.substring(PAYLOAD_PREFIX.length);
    var label = sheet.getRange(1, 2).getValue();
    return { id: id, name: label ? String(label) : formatId_(id) };
  }).filter(Boolean);
}

/** Run once. Creates a daily 6am refresh and forces the consent screen. */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'refresh') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('refresh').timeBased().atHour(6).everyDays(1).create();
  Logger.log('Daily refresh installed. Run refresh() now for a first pull.');
}

// ===========================================================================
// GOOGLE ADS API TRANSPORT
// ===========================================================================

/**
 * Calls searchStream and flattens the chunked response.
 * searchStream returns every row in one response, which avoids paging inside
 * Apps Script's execution budget.
 */
function apiSearch_(query) {
  if (!CURRENT || !CURRENT.id) {
    throw new Error('No account selected. Run refresh(), which reads accounts ' +
        'from the Settings tab, rather than calling a pull function directly.');
  }
  var url = 'https://googleads.googleapis.com/' + CONFIG.API_VERSION +
      '/customers/' + digits_(CURRENT.id) + '/googleAds:searchStream';

  var headers = {
    Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
    'developer-token': CONFIG.DEVELOPER_TOKEN
  };
  if (CONFIG.LOGIN_CUSTOMER_ID) {
    headers['login-customer-id'] = digits_(CONFIG.LOGIN_CUSTOMER_ID);
  }

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify({ query: query }),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  var body = response.getContentText();

  if (code !== 200) throw new Error(describeError_(code, body));

  var chunks;
  try {
    chunks = JSON.parse(body);
  } catch (e) {
    // UrlFetchApp truncates responses around 50MB, which leaves invalid JSON.
    throw new Error('Response too large to parse (' +
        (body.length / 1048576).toFixed(1) + 'MB, truncated by Apps Script). ' +
        'Add a LIMIT to this query or narrow LAST_N_DAYS.');
  }

  var rows = [];
  (Array.isArray(chunks) ? chunks : [chunks]).forEach(function(chunk) {
    if (chunk.results) rows = rows.concat(chunk.results);
  });
  return rows;
}

/** Turns API error envelopes into something worth reading in the log. */
function describeError_(code, body) {
  var error;
  try {
    var parsed = JSON.parse(body);
    error = (Array.isArray(parsed) ? parsed[0] : parsed).error;
  } catch (e) {
    return 'HTTP ' + code + ': ' + String(body).slice(0, 400);
  }
  if (!error) return 'HTTP ' + code + ': ' + String(body).slice(0, 400);

  var detail = '';
  var details = error.details || [];
  for (var i = 0; i < details.length; i++) {
    var errors = details[i].errors || [];
    if (errors.length) {
      detail = errors[0].message || '';
      break;
    }
  }

  var message = 'HTTP ' + code + ' — ' + (error.message || '') +
      (detail ? ' | ' + detail : '');

  var raw = (error.message || '') + ' ' + detail;

  if (code === 403 &&
      /has not been used in project|SERVICE_DISABLED|API .*is disabled/i.test(raw)) {
    var project = (raw.match(/project (\d+)/) || [])[1] || '(see message above)';
    message += '\nFix: this project is on the default, hidden Cloud project, ' +
        'which cannot have APIs enabled. Attach a standard Cloud project:' +
        '\n  1. console.cloud.google.com > create or pick a project.' +
        '\n  2. Enable the Google Ads API in it.' +
        '\n  3. Configure its OAuth consent screen (name + support email).' +
        '\n  4. Copy the project NUMBER, not the project ID.' +
        '\n  5. Apps Script > Project Settings > Google Cloud Platform (GCP) ' +
        'Project > Change project > paste the number.' +
        '\n  6. Re-run. You will be asked to authorize again.' +
        '\nCurrent project number: ' + project;
  } else if (code === 401) {
    message += '\nFix: re-run installTrigger to re-consent, and confirm the ' +
        'adwords scope is in the manifest.';
  } else if (code === 403) {
    message += '\nFix: check DEVELOPER_TOKEN, and whether LOGIN_CUSTOMER_ID ' +
        'is required for how you reach this account.';
  } else if (code === 404) {
    message += '\nFix: API_VERSION ' + CONFIG.API_VERSION + ' may be sunset. ' +
        'Bump it in CONFIG.';
  }
  return message;
}

/**
 * Runs a query, dropping only the fields the API actually rejects.
 *
 * The API names the offending field in its error, so we parse it out and drop
 * exactly that. Dropping whole groups instead would discard every field
 * positioned after the culprit, losing data that was perfectly valid.
 */
function gaql_(name, from, required, optional, where, orderBy, limit) {
  if (outOfTime_()) {
    log_(name, 'SKIPPED — time budget reached.');
    return [];
  }

  var pool = [];
  optional.forEach(function(group) { pool = pool.concat(group); });

  var rejected = [];   // Named by the API as invalid.
  var removed = [];    // Shed blind because the error named nothing we sent.
  var reason = '';
  var maxAttempts = pool.length + 2;

  for (var attempt = 0; attempt < maxAttempts; attempt++) {
    var query = 'SELECT ' + required.concat(pool).join(', ') +
        ' FROM ' + from + ' WHERE ' + where +
        (orderBy ? ' ORDER BY ' + orderBy : '') +
        (limit ? ' LIMIT ' + limit : '');

    try {
      var rows = apiSearch_(query);
      log_(name, rows.length + ' rows.' +
          (rejected.length ? ' API rejected: ' + rejected.join(', ') + '.' : '') +
          (removed.length
              ? ' Removed to recover: ' + removed.join(', ') +
                ' (the error named none of them).'
              : '') +
          (reason ? ' First reason: ' + reason : ''));
      return rows;
    } catch (e) {
      var message = String(e.message || e);
      if (!pool.length) {
        log_(name, 'SKIPPED — ' + message.slice(0, 300));
        return [];
      }
      if (!reason) reason = message.split('\n')[0].slice(0, 160);
      // Drop every pooled field the error names. If it names none, fall back
      // to shedding the last field so the loop still terminates.
      var bad = pool.filter(function(field) {
        return message.indexOf(field) !== -1;
      });
      if (bad.length) {
        rejected = rejected.concat(bad);
      } else {
        // Nothing we sent was named, so shed the least important field. Pools
        // are ordered most important first for exactly this reason.
        bad = [pool[pool.length - 1]];
        removed = removed.concat(bad);
      }

      pool = pool.filter(function(field) { return bad.indexOf(field) === -1; });
    }
  }

  log_(name, 'SKIPPED — exhausted retries. First reason: ' + reason);
  return [];
}

function outOfTime_() {
  return STARTED_AT &&
      (new Date().getTime() - STARTED_AT) / 1000 > CONFIG.TIME_BUDGET_SECONDS;
}

function log_(key, message) {
  RUN_LOG.push([key, message]);
  Logger.log(key + ': ' + message);
}

// ===========================================================================
// REPORTS
// ===========================================================================

function pullCustomer_() {
  var rows = apiSearch_(
      'SELECT customer.descriptive_name, customer.currency_code, ' +
      'customer.time_zone FROM customer LIMIT 1');
  var customer = rows.length ? rows[0].customer : {};
  return {
    name: customer.descriptiveName || 'Google Ads account',
    currency: customer.currencyCode || 'USD',
    timeZone: customer.timeZone || Session.getScriptTimeZone()
  };
}

function pullCampaigns_(dateClause) {
  var rows = gaql_('Campaigns', 'campaign',
      ['campaign.id', 'campaign.name', 'campaign.status',
       'campaign.bidding_strategy_type'].concat(CORE_METRICS),
      [ALL_CONV_METRICS, VIDEO_METRICS, QUARTILE_METRICS, ENGAGEMENT_METRICS,
       ['campaign_budget.amount_micros']],
      DGEN + ' AND ' + dateClause);

  var mapped = rows.map(function(r) {
    var out = metricsOf_(r);
    out.id = get_(r, 'campaign.id');
    out.name = get_(r, 'campaign.name');
    out.status = get_(r, 'campaign.status');
    out.bidding = pretty_(get_(r, 'campaign.biddingStrategyType'));
    out.budget = micros_(get_(r, 'campaignBudget.amountMicros'));
    return out;
  });
  return tally_('campaigns', mapped);
}

function pullChannels_(dateClause) {
  var rows = gaql_('Channel split', 'campaign',
      ['campaign.id', 'campaign.name', 'segments.ad_network_type']
          .concat(CORE_METRICS),
      [ALL_CONV_METRICS, VIDEO_METRICS, QUARTILE_METRICS],
      DGEN + ' AND ' + dateClause);

  return rows.map(function(r) {
    var out = metricsOf_(r);
    out.campaignId = get_(r, 'campaign.id');
    out.campaign = get_(r, 'campaign.name');
    out.channel = channelLabel_(get_(r, 'segments.adNetworkType'));
    return out;
  }).filter(hasVolume_);
}

function pullAdGroups_(dateClause) {
  var rows = gaql_('Ad groups', 'ad_group',
      ['campaign.name', 'ad_group.id', 'ad_group.name', 'ad_group.status']
          .concat(CORE_METRICS),
      [ALL_CONV_METRICS, VIDEO_METRICS, QUARTILE_METRICS],
      DGEN + ' AND ' + dateClause);

  var mapped = rows.map(function(r) {
    var out = metricsOf_(r);
    out.id = get_(r, 'adGroup.id');
    out.name = get_(r, 'adGroup.name');
    out.campaign = get_(r, 'campaign.name');
    out.status = get_(r, 'adGroup.status');
    return out;
  });
  return tally_('adGroups', mapped);
}

function pullAds_(dateClause) {
  var rows = gaql_('Ads', 'ad_group_ad',
      ['campaign.name', 'ad_group.name', 'ad_group_ad.ad.id',
       'ad_group_ad.ad.type', 'ad_group_ad.status'].concat(CORE_METRICS),
      [ALL_CONV_METRICS, VIDEO_METRICS, QUARTILE_METRICS,
       ['ad_group_ad.ad.name', 'ad_group_ad.ad.final_urls'],
       ['ad_group_ad.policy_summary.approval_status']],
      DGEN + ' AND ' + dateClause);

  var mapped = rows.map(function(r) {
    var out = metricsOf_(r);
    out.id = get_(r, 'adGroupAd.ad.id');
    out.name = get_(r, 'adGroupAd.ad.name') || '';
    out.type = pretty_(get_(r, 'adGroupAd.ad.type'));
    out.status = get_(r, 'adGroupAd.status');
    out.approval = pretty_(get_(r, 'adGroupAd.policySummary.approvalStatus'));
    out.campaign = get_(r, 'campaign.name');
    out.adGroup = get_(r, 'adGroup.name');
    var urls = get_(r, 'adGroupAd.ad.finalUrls');
    out.finalUrl = urls && urls.length ? urls[0] : '';
    out.headlines = [];
    out.descriptions = [];
    out.images = [];
    out.videos = [];
    return out;
  });
  return tally_('ads', mapped);
}

/**
 * Where the ads actually drive. Demand Gen lives or dies on the landing page,
 * so we roll every ad's final URL up into destinations with the spend, actions
 * and view-through behind each. The deck audits these pages and recommends a
 * purpose-built Demand Gen experience.
 */
function landingPagesOf_(ads) {
  var byUrl = {};
  (ads || []).forEach(function(ad) {
    var url = ad.finalUrl || '';
    if (!url) return;
    var lp = byUrl[url] || (byUrl[url] = {
      url: url, spend: 0, conversions: 0, viewThrough: 0, impressions: 0,
      clicks: 0, ads: 0, campaigns: {}
    });
    lp.spend += ad.cost || 0;
    lp.conversions += ad.conversions || 0;
    lp.viewThrough += ad.viewThrough || 0;
    lp.impressions += ad.impressions || 0;
    lp.clicks += ad.clicks || 0;
    lp.ads += 1;
    if (ad.campaign) lp.campaigns[ad.campaign] = true;
  });
  return Object.keys(byUrl).map(function(u) {
    var lp = byUrl[u];
    lp.campaignList = Object.keys(lp.campaigns);
    delete lp.campaigns;
    lp.cpa = lp.conversions ? lp.spend / lp.conversions : 0;
    lp.cvr = lp.clicks ? lp.conversions / lp.clicks : 0;
    return lp;
  }).sort(function(a, b) { return b.spend - a.spend; });
}

function pullAdChannels_(dateClause) {
  var rows = gaql_('Ad channel split', 'ad_group_ad',
      ['ad_group_ad.ad.id', 'segments.ad_network_type', 'metrics.cost_micros'],
      [], DGEN + ' AND ' + dateClause);

  var byAd = {};
  rows.forEach(function(r) {
    var id = get_(r, 'adGroupAd.ad.id');
    if (!byAd[id]) byAd[id] = {};
    var key = channelLabel_(get_(r, 'segments.adNetworkType'));
    byAd[id][key] = (byAd[id][key] || 0) + micros_(get_(r, 'metrics.costMicros'));
  });
  return byAd;
}

function pullAudiences_(dateClause) {
  var rows = gaql_('Audiences', 'ad_group_audience_view',
      ['campaign.name', 'ad_group.name', 'ad_group_criterion.criterion_id',
       'ad_group_criterion.type'].concat(CORE_METRICS),
      [ALL_CONV_METRICS, VIDEO_METRICS,
       ['ad_group_criterion.display_name'],
       ['ad_group_criterion.audience.audience',
        'ad_group_criterion.user_list.user_list'],
       ['ad_group_criterion.user_interest.user_interest_category',
        'ad_group_criterion.custom_audience.custom_audience',
        'ad_group_criterion.detailed_demographic.detailed_demographic',
        'ad_group_criterion.life_event.life_event']],
      DGEN + ' AND ' + dateClause);

  var results = rows.map(function(r) {
    var out = metricsOf_(r);
    out.campaign = get_(r, 'campaign.name');
    out.adGroup = get_(r, 'adGroup.name');
    out.type = pretty_(get_(r, 'adGroupCriterion.type'));
    out.name = get_(r, 'adGroupCriterion.displayName') || '';
    out.ref =
        get_(r, 'adGroupCriterion.audience.audience') ||
        get_(r, 'adGroupCriterion.userList.userList') ||
        get_(r, 'adGroupCriterion.userInterest.userInterestCategory') ||
        get_(r, 'adGroupCriterion.customAudience.customAudience') ||
        get_(r, 'adGroupCriterion.detailedDemographic.detailedDemographic') ||
        get_(r, 'adGroupCriterion.lifeEvent.lifeEvent') || '';
    return out;
  });
  results = tally_('audiences', results);

  resolveAudienceNames_(results);
  return results;
}

function resolveAudienceNames_(rows) {
  var needed = {};
  rows.forEach(function(row) {
    if (!row.name && row.ref) needed[row.ref] = true;
  });
  var refs = Object.keys(needed);
  if (!refs.length) return;

  var names = {};
  [{ from: 'audience', key: 'audience', match: '/audiences/' },
   { from: 'user_list', key: 'userList', match: '/userLists/' }
  ].forEach(function(lookup) {
    var ids = refs.filter(function(ref) {
      return ref.indexOf(lookup.match) !== -1;
    }).map(function(ref) { return ref.split('/').pop(); });

    chunk_(ids, 400).forEach(function(batch) {
      var found = gaql_('Resolve ' + lookup.from, lookup.from,
          [lookup.from + '.id', lookup.from + '.name'], [],
          lookup.from + '.id IN (' + batch.join(',') + ')');
      found.forEach(function(r) {
        var obj = r[lookup.key];
        if (obj) names[String(obj.id)] = obj.name;
      });
    });
  });

  rows.forEach(function(row) {
    if (row.name || !row.ref) return;
    var id = row.ref.split('/').pop();
    row.name = names[id] || (row.type + ' ' + id);
  });
}

function pullAssets_(dateClause) {
  var rows = gaql_('Asset performance', 'ad_group_ad_asset_view',
      ['campaign.name', 'ad_group.name', 'asset.id',
       'ad_group_ad_asset_view.field_type',
       'metrics.impressions', 'metrics.clicks'],
      [ALL_CONV_METRICS,
       ['metrics.cost_micros', 'metrics.conversions',
        'metrics.conversions_value', 'metrics.view_through_conversions'],
       ['ad_group_ad_asset_view.performance_label'],
       ['asset.type', 'asset.name'],
       ['asset.text_asset.text',
        'asset.image_asset.full_size.url',
        'asset.youtube_video_asset.youtube_video_id']],
      DGEN + ' AND ' + dateClause);

  return rows.map(function(r) {
    var out = metricsOf_(r);
    out.id = get_(r, 'asset.id');
    out.campaign = get_(r, 'campaign.name');
    out.adGroup = get_(r, 'adGroup.name');
    out.fieldType = pretty_(get_(r, 'adGroupAdAssetView.fieldType'));
    out.label = pretty_(get_(r, 'adGroupAdAssetView.performanceLabel')) ||
        'Unrated';
    out.type = pretty_(get_(r, 'asset.type'));
    out.text = get_(r, 'asset.textAsset.text') || get_(r, 'asset.name') || '';
    out.imageUrl = get_(r, 'asset.imageAsset.fullSize.url') || '';
    var ytId = get_(r, 'asset.youtubeVideoAsset.youtubeVideoId');
    out.viewUrl = ytId ? 'https://www.youtube.com/watch?v=' + ytId : out.imageUrl;
    out.thumbUrl = ytId ? 'https://i.ytimg.com/vi/' + ytId + '/mqdefault.jpg'
                        : out.imageUrl;
    return out;
  }).filter(hasVolume_);
}

/**
 * Where ads actually rendered: Shorts, in-feed, in-stream, pause screens.
 * Falls back to sub-network segmentation when format segmentation is
 * unavailable, which gives a coarser but still useful YouTube split.
 */
function pullSurfaces_(dateClause) {
  var attempts = [
    { segment: 'segments.ad_format_type', field: 'segments.adFormatType',
      name: 'Ad formats', source: 'format' },
    { segment: 'segments.ad_sub_network_type', field: 'segments.adSubNetworkType',
      name: 'Ad formats (sub-network)', source: 'subnetwork' }
  ];

  for (var i = 0; i < attempts.length; i++) {
    var attempt = attempts[i];
    var rows = gaql_(attempt.name, 'campaign',
        ['campaign.name', attempt.segment].concat(CORE_METRICS),
        [ALL_CONV_METRICS, VIDEO_METRICS, QUARTILE_METRICS],
        DGEN + ' AND ' + dateClause);

    var mapped = rows.map(function(r) {
      var out = metricsOf_(r);
      var key = get_(r, attempt.field);
      var entry = FORMATS[key];
      out.campaign = get_(r, 'campaign.name');
      out.surface = entry ? entry.label : (pretty_(key) || 'Unsegmented');
      out.color = entry ? entry.color : '#A2A8B4';
      return out;
    }).filter(hasVolume_);

    if (mapped.length) {
      mapped.source = attempt.source;
      return mapped;
    }
  }
  return [];
}

/**
 * Campaign configuration rather than performance.
 *
 * Settings explain results, so an audit that reports numbers without them
 * leaves the reader guessing why. Each block degrades on its own: an account
 * without lifecycle goals should still get its budgets and schedules.
 */
function pullSettings_() {
  var out = { campaigns: [], conversionActions: [], notes: [] };

  // start_date / end_date are optional, not required: some API versions reject
  // them ("Unrecognized fields"), and putting them in `required` would sink the
  // entire settings pull. As optional fields gaql_ sheds exactly those two and
  // keeps everything else.
  var rows = gaql_('Campaign settings', 'campaign',
      ['campaign.id', 'campaign.name', 'campaign.status',
       'campaign.bidding_strategy_type'],
      [['campaign_budget.amount_micros', 'campaign_budget.delivery_method',
        'campaign_budget.explicitly_shared'],
       ['campaign.asset_automation_settings'],
       ['campaign.geo_target_type_setting.positive_geo_target_type',
        'campaign.geo_target_type_setting.negative_geo_target_type'],
       ['campaign.target_cpa.target_cpa_micros'],
       ['campaign.target_roas.target_roas'],
       ['campaign.maximize_conversion_value.target_roas'],
       ['campaign.maximize_conversions.target_cpa_micros'],
       ['campaign.start_date', 'campaign.end_date']],
      DGEN);

  var byId = {};
  rows.forEach(function(r) {
    var automation = mergeAutomation_(get_(r, 'campaign.assetAutomationSettings'));
    var target = '';
    if (get_(r, 'campaign.targetCpa.targetCpaMicros')) {
      target = 'Target CPA ' + micros_(get_(r, 'campaign.targetCpa.targetCpaMicros'));
    } else if (get_(r, 'campaign.maximizeConversions.targetCpaMicros')) {
      target = 'Target CPA ' +
          micros_(get_(r, 'campaign.maximizeConversions.targetCpaMicros'));
    } else if (get_(r, 'campaign.targetRoas.targetRoas')) {
      target = 'Target ROAS ' + num_(get_(r, 'campaign.targetRoas.targetRoas'));
    } else if (get_(r, 'campaign.maximizeConversionValue.targetRoas')) {
      target = 'Target ROAS ' +
          num_(get_(r, 'campaign.maximizeConversionValue.targetRoas'));
    }

    var campaign = {
      id: get_(r, 'campaign.id'),
      name: get_(r, 'campaign.name'),
      status: get_(r, 'campaign.status'),
      bidding: pretty_(get_(r, 'campaign.biddingStrategyType')),
      target: target,
      startDate: get_(r, 'campaign.startDate') || '',
      endDate: get_(r, 'campaign.endDate') || '',
      budget: micros_(get_(r, 'campaignBudget.amountMicros')),
      budgetDelivery: pretty_(get_(r, 'campaignBudget.deliveryMethod')),
      budgetShared: !!get_(r, 'campaignBudget.explicitlyShared'),
      geoPositive: pretty_(get_(r,
          'campaign.geoTargetTypeSetting.positiveGeoTargetType')),
      geoNegative: pretty_(get_(r,
          'campaign.geoTargetTypeSetting.negativeGeoTargetType')),
      automation: automation,
      schedule: [],
      locations: [],
      excludedLocations: [],
      languages: [],
      excludedAudiences: [],
      goals: [],
      acquisition: ''
    };
    byId[campaign.id] = campaign;
    out.campaigns.push(campaign);
  });

  if (!out.campaigns.length) return out;

  // --- criteria: schedule, geography, language, exclusions ----------------
  var geoIds = {};
  var criteria = gaql_('Campaign criteria', 'campaign_criterion',
      ['campaign.id', 'campaign_criterion.type', 'campaign_criterion.negative'],
      [['campaign_criterion.ad_schedule.day_of_week',
        'campaign_criterion.ad_schedule.start_hour',
        'campaign_criterion.ad_schedule.end_hour'],
       ['campaign_criterion.location.geo_target_constant'],
       ['campaign_criterion.language.language_constant'],
       ['campaign_criterion.user_list.user_list']],
      DGEN + " AND campaign_criterion.type IN ('AD_SCHEDULE', 'LOCATION', " +
      "'LANGUAGE', 'USER_LIST')");

  criteria.forEach(function(r) {
    var campaign = byId[get_(r, 'campaign.id')];
    if (!campaign) return;
    var type = get_(r, 'campaignCriterion.type');
    var negative = !!get_(r, 'campaignCriterion.negative');

    if (type === 'AD_SCHEDULE') {
      var day = get_(r, 'campaignCriterion.adSchedule.dayOfWeek');
      var startHour = num_(get_(r, 'campaignCriterion.adSchedule.startHour'));
      var endHour = num_(get_(r, 'campaignCriterion.adSchedule.endHour'));
      campaign.schedule.push({ day: day, start: startHour, end: endHour });
    } else if (type === 'LOCATION') {
      var ref = get_(r, 'campaignCriterion.location.geoTargetConstant');
      if (ref) {
        var geoId = String(ref).split('/').pop();
        geoIds[geoId] = true;
        (negative ? campaign.excludedLocations : campaign.locations).push(geoId);
      }
    } else if (type === 'LANGUAGE') {
      var lang = get_(r, 'campaignCriterion.language.languageConstant');
      if (lang) campaign.languages.push(String(lang).split('/').pop());
    } else if (type === 'USER_LIST' && negative) {
      var list = get_(r, 'campaignCriterion.userList.userList');
      if (list) campaign.excludedAudiences.push(String(list).split('/').pop());
    }
  });

  // Resolve geo IDs to readable place names.
  var geoNames = {};
  chunk_(Object.keys(geoIds), 200).forEach(function(batch) {
    gaql_('Resolve locations', 'geo_target_constant',
        ['geo_target_constant.id', 'geo_target_constant.canonical_name'], [],
        'geo_target_constant.id IN (' + batch.join(',') + ')')
      .forEach(function(r) {
        geoNames[String(get_(r, 'geoTargetConstant.id'))] =
            get_(r, 'geoTargetConstant.canonicalName');
      });
  });

  var listNames = {};
  var allLists = [];
  out.campaigns.forEach(function(c) {
    allLists = allLists.concat(c.excludedAudiences);
  });
  chunk_(allLists, 200).forEach(function(batch) {
    if (!batch.length) return;
    gaql_('Resolve excluded lists', 'user_list',
        ['user_list.id', 'user_list.name'], [],
        'user_list.id IN (' + batch.join(',') + ')')
      .forEach(function(r) {
        listNames[String(get_(r, 'userList.id'))] = get_(r, 'userList.name');
      });
  });

  // Resolve language constant IDs to readable names (1000 -> English).
  var langNames = {};
  var allLangs = [];
  out.campaigns.forEach(function(c) { allLangs = allLangs.concat(c.languages); });
  chunk_(dedupe_(allLangs), 200).forEach(function(batch) {
    if (!batch.length) return;
    gaql_('Resolve languages', 'language_constant',
        ['language_constant.id', 'language_constant.name',
         'language_constant.code'], [],
        'language_constant.id IN (' + batch.join(',') + ')')
      .forEach(function(r) {
        langNames[String(get_(r, 'languageConstant.id'))] =
            get_(r, 'languageConstant.name') ||
            get_(r, 'languageConstant.code');
      });
  });

  out.campaigns.forEach(function(c) {
    c.locations = c.locations.map(function(id) { return geoNames[id] || id; });
    c.excludedLocations = c.excludedLocations.map(function(id) {
      return geoNames[id] || id;
    });
    c.excludedAudiences = c.excludedAudiences.map(function(id) {
      return listNames[id] || ('List ' + id);
    });
    c.languages = c.languages.map(function(id) { return langNames[id] || id; });
  });

  // --- conversion goals per campaign --------------------------------------
  gaql_('Campaign conversion goals', 'campaign_conversion_goal',
      ['campaign.id', 'campaign_conversion_goal.category',
       'campaign_conversion_goal.biddable'],
      [['campaign_conversion_goal.origin']], DGEN)
    .forEach(function(r) {
      var campaign = byId[get_(r, 'campaign.id')];
      if (!campaign) return;
      // Only skip goals the API explicitly marks non-biddable. If the biddable
      // field is absent (undefined), keep the goal — treating undefined as
      // false previously dropped every goal and mislabelled campaign-specific
      // goals (e.g. Add to cart + Purchase) as "Account default".
      if (get_(r, 'campaignConversionGoal.biddable') === false) return;
      var category = pretty_(get_(r, 'campaignConversionGoal.category'));
      if (category && campaign.goals.indexOf(category) === -1) {
        campaign.goals.push(category);
      }
    });

  // --- new customer acquisition -------------------------------------------
  gaql_('Customer acquisition', 'campaign_lifecycle_goal',
      ['campaign.id',
       'campaign_lifecycle_goal.customer_acquisition_goal_settings.optimization_mode'],
      [], DGEN)
    .forEach(function(r) {
      var campaign = byId[get_(r, 'campaign.id')];
      if (!campaign) return;
      var mode = get_(r,
          'campaignLifecycleGoal.customerAcquisitionGoalSettings.optimizationMode');
      campaign.acquisition = ACQUISITION_MODES[mode] || pretty_(mode);
    });

  out.campaigns.forEach(function(c) {
    // No lifecycle goal on the campaign is not "unconfigured" — it is the
    // default, which the Ads UI shows as bidding equally for new and existing.
    if (!c.acquisition) c.acquisition = ACQUISITION_MODES.TARGET_ALL_EQUALLY;
  });

  // --- conversion action detail -------------------------------------------
  out.conversionActions = gaql_('Conversion action setup', 'conversion_action',
      ['conversion_action.name', 'conversion_action.category',
       'conversion_action.status'],
      [['conversion_action.primary_for_goal'],
       ['conversion_action.include_in_conversions_metric'],
       ['conversion_action.view_through_lookback_window_days'],
       ['conversion_action.click_through_lookback_window_days'],
       ['conversion_action.counting_type']],
      "conversion_action.status = 'ENABLED'")
    .map(function(r) {
      return {
        name: get_(r, 'conversionAction.name'),
        category: pretty_(get_(r, 'conversionAction.category')),
        inColumn: !!get_(r, 'conversionAction.includeInConversionsMetric'),
        primary: get_(r, 'conversionAction.primaryForGoal') !== false,
        viewThroughDays: num_(get_(r,
            'conversionAction.viewThroughLookbackWindowDays')),
        clickThroughDays: num_(get_(r,
            'conversionAction.clickThroughLookbackWindowDays')),
        counting: pretty_(get_(r, 'conversionAction.countingType'))
      };
    });

  return out;
}

/** Resolve geo_target_constant IDs to canonical place names. */
function resolveGeo_(ids) {
  var names = {};
  chunk_(dedupe_(ids), 200).forEach(function(batch) {
    if (!batch.length) return;
    gaql_('Resolve locations', 'geo_target_constant',
        ['geo_target_constant.id', 'geo_target_constant.canonical_name'], [],
        'geo_target_constant.id IN (' + batch.join(',') + ')')
      .forEach(function(r) {
        names[String(get_(r, 'geoTargetConstant.id'))] =
            get_(r, 'geoTargetConstant.canonicalName');
      });
  });
  return names;
}

/** Resolve language_constant IDs to readable names (1000 -> English). */
function resolveLang_(ids) {
  var names = {};
  chunk_(dedupe_(ids), 200).forEach(function(batch) {
    if (!batch.length) return;
    gaql_('Resolve languages', 'language_constant',
        ['language_constant.id', 'language_constant.name',
         'language_constant.code'], [],
        'language_constant.id IN (' + batch.join(',') + ')')
      .forEach(function(r) {
        names[String(get_(r, 'languageConstant.id'))] =
            get_(r, 'languageConstant.name') || get_(r, 'languageConstant.code');
      });
  });
  return names;
}

/** Resolve user_list IDs to names. */
function resolveUserLists_(ids) {
  var names = {};
  chunk_(dedupe_(ids), 200).forEach(function(batch) {
    if (!batch.length) return;
    gaql_('Resolve user lists', 'user_list',
        ['user_list.id', 'user_list.name'], [],
        'user_list.id IN (' + batch.join(',') + ')')
      .forEach(function(r) {
        names[String(get_(r, 'userList.id'))] = get_(r, 'userList.name');
      });
  });
  return names;
}

/**
 * Ad-group-level settings. For Demand Gen, location, language and audience
 * targeting are frequently set at the ad group rather than the campaign — which
 * is why a campaign can read "All locations" while the real targeting lives
 * here. Pulls each ad group's targeted/excluded locations, languages and
 * remarketing lists, resolved to names.
 */
function pullAdGroupSettings_() {
  var meta = {};
  gaql_('Ad group settings', 'ad_group',
      ['campaign.id', 'campaign.name', 'ad_group.id', 'ad_group.name',
       'ad_group.status'],
      [['ad_group.type']], DGEN)
    .forEach(function(r) {
      var id = get_(r, 'adGroup.id');
      meta[id] = {
        campaignId: get_(r, 'campaign.id'),
        campaign: get_(r, 'campaign.name'),
        id: id,
        adGroup: get_(r, 'adGroup.name'),
        status: get_(r, 'adGroup.status'),
        type: pretty_(get_(r, 'adGroup.type')) || '',
        locations: [], excludedLocations: [], languages: [],
        audiences: [], excludedAudiences: []
      };
    });
  if (!Object.keys(meta).length) return [];

  var geoIds = [], langIds = [], listIds = [];
  gaql_('Ad group criteria', 'ad_group_criterion',
      ['ad_group.id', 'ad_group_criterion.type',
       'ad_group_criterion.negative'],
      [['ad_group_criterion.location.geo_target_constant'],
       ['ad_group_criterion.language.language_constant'],
       ['ad_group_criterion.user_list.user_list']],
      DGEN + " AND ad_group_criterion.type IN ('LOCATION', 'LANGUAGE', " +
      "'USER_LIST')")
    .forEach(function(r) {
      var ag = meta[get_(r, 'adGroup.id')];
      if (!ag) return;
      var type = get_(r, 'adGroupCriterion.type');
      var neg = !!get_(r, 'adGroupCriterion.negative');
      if (type === 'LOCATION') {
        var ref = get_(r, 'adGroupCriterion.location.geoTargetConstant');
        if (ref) {
          var gid = String(ref).split('/').pop();
          geoIds.push(gid);
          (neg ? ag.excludedLocations : ag.locations).push(gid);
        }
      } else if (type === 'LANGUAGE') {
        var lref = get_(r, 'adGroupCriterion.language.languageConstant');
        if (lref) {
          var lid = String(lref).split('/').pop();
          langIds.push(lid);
          ag.languages.push(lid);
        }
      } else if (type === 'USER_LIST') {
        var uref = get_(r, 'adGroupCriterion.userList.userList');
        if (uref) {
          var uid = String(uref).split('/').pop();
          listIds.push(uid);
          (neg ? ag.excludedAudiences : ag.audiences).push(uid);
        }
      }
    });

  var geoNames = resolveGeo_(geoIds);
  var langNames = resolveLang_(langIds);
  var listNames = resolveUserLists_(listIds);

  return Object.keys(meta).map(function(id) {
    var ag = meta[id];
    ag.locations = ag.locations.map(function(x) { return geoNames[x] || x; });
    ag.excludedLocations = ag.excludedLocations.map(function(x) {
      return geoNames[x] || x;
    });
    ag.languages = ag.languages.map(function(x) { return langNames[x] || x; });
    ag.audiences = ag.audiences.map(function(x) {
      return listNames[x] || ('List ' + x);
    });
    ag.excludedAudiences = ag.excludedAudiences.map(function(x) {
      return listNames[x] || ('List ' + x);
    });
    return ag;
  });
}

function pullDemographics_(dateClause) {
  var out = [];
  [['age_range_view', 'Age'], ['gender_view', 'Gender']].forEach(function(pair) {
    var rows = gaql_(pair[1], pair[0],
        ['campaign.name', 'ad_group_criterion.criterion_id']
            .concat(CORE_METRICS),
        [ALL_CONV_METRICS,
         ['ad_group_criterion.age_range.type'],
         ['ad_group_criterion.gender.type']],
        DGEN + ' AND ' + dateClause);

    rows.forEach(function(r) {
      var row = metricsOf_(r);
      row.dimension = pair[1];
      row.campaign = get_(r, 'campaign.name');
      row.value = pretty_(get_(r, 'adGroupCriterion.ageRange.type') ||
                          get_(r, 'adGroupCriterion.gender.type') || 'Unknown');
      if (hasVolume_(row)) out.push(row);
    });
  });
  return out;
}

function pullDevices_(dateClause) {
  var rows = gaql_('Devices', 'campaign',
      ['campaign.name', 'segments.device'].concat(CORE_METRICS), [ALL_CONV_METRICS],
      DGEN + ' AND ' + dateClause);

  return rows.map(function(r) {
    var out = metricsOf_(r);
    out.campaign = get_(r, 'campaign.name');
    out.device = pretty_(get_(r, 'segments.device'));
    return out;
  }).filter(hasVolume_);
}

function pullPlacements_(dateClause) {
  var rows = gaql_('Placements', 'detail_placement_view',
      ['campaign.name', 'detail_placement_view.display_name',
       'detail_placement_view.placement_type',
       'metrics.impressions', 'metrics.clicks'],
      [ALL_CONV_METRICS,
       ['detail_placement_view.target_url'],
       ['metrics.cost_micros', 'metrics.conversions']],
      DGEN + ' AND ' + dateClause, 'metrics.impressions DESC', 1000);

  return rows.map(function(r) {
    var out = metricsOf_(r);
    out.campaign = get_(r, 'campaign.name');
    out.name = get_(r, 'detailPlacementView.displayName');
    out.type = pretty_(get_(r, 'detailPlacementView.placementType'));
    out.url = get_(r, 'detailPlacementView.targetUrl') || '';
    return out;
  }).filter(hasVolume_);
}

function pullDaily_(dateClause) {
  var rows = gaql_('Daily trend', 'campaign',
      ['segments.date'].concat(CORE_METRICS), [ALL_CONV_METRICS, VIDEO_METRICS],
      DGEN + ' AND ' + dateClause, 'segments.date ASC');

  var byDate = {};
  rows.forEach(function(r) {
    var date = get_(r, 'segments.date');
    if (!byDate[date]) byDate[date] = blankMetrics_({ date: date });
    addMetrics_(byDate[date], metricsOf_(r));
  });

  return Object.keys(byDate).sort().map(function(date) {
    return derive_(byDate[date]);
  });
}

/**
 * Video assets rolled up per video, not per ad group placement.
 *
 * The same video usually runs in several ad groups, so raw rows understate any
 * single video's reach. Aggregating first is what makes the tab readable.
 * Field type and asset type are tried in turn, since coverage differs by
 * account.
 */
/**
 * Where a video came from, inferred from its title. Google's asset-optimisation
 * features (Shorter / Resized / Enhanced videos) republish a creative under a
 * prefixed title — "Shortened: ...", "Enhanced by Google AI", a vertical/resized
 * variant. The talk's POV is to review these AI-modified cuts directly, so we
 * surface the origin as its own column rather than burying it in the title.
 * Returns 'Enhanced by Google AI' or 'Advertiser'.
 */
function videoSource_(title) {
  var t = String(title || '').toLowerCase();
  if (/shortened|enhanced by google ai|enhanced video|vertical(ized)?|resized|flipped|generated by google/.test(t)) {
    return 'Enhanced by Google AI';
  }
  return 'Advertiser';
}

function pullVideos_(dateClause) {
  // The YouTube ID is required, not optional: without it a card has no
  // thumbnail, no link and no title, which makes the whole tab pointless.
  // The asset performance pull proves it is selectable here.
  var required = ['campaign.name', 'ad_group.name', 'asset.id',
                  'asset.youtube_video_asset.youtube_video_id',
                  'metrics.impressions', 'metrics.clicks'];

  // Ordered most important first. When the API rejects something without
  // naming it, gaql_ sheds from the end, so the tail is what we can spare.
  var optional = [
    ['metrics.cost_micros', 'metrics.conversions', 'metrics.conversions_value',
     'metrics.view_through_conversions'],
    ALL_CONV_METRICS,
    ['ad_group_ad_asset_view.performance_label'],
    ['asset.name'],
    ['asset.youtube_video_asset.youtube_video_title'],
    VIDEO_METRICS,
    QUARTILE_METRICS
  ];

  // Asset type first: field_type = VIDEO returns nothing on Demand Gen.
  var attempts = [
    ["asset.type = 'YOUTUBE_VIDEO'", 'Video assets'],
    ["ad_group_ad_asset_view.field_type = 'VIDEO'", 'Video assets (by field type)']
  ];

  var rows = [];
  for (var i = 0; i < attempts.length && !rows.length; i++) {
    rows = gaql_(attempts[i][1], 'ad_group_ad_asset_view', required, optional,
        DGEN + ' AND ' + attempts[i][0] + ' AND ' + dateClause);
  }
  if (!rows.length) return [];

  var byVideo = {};
  rows.forEach(function(r) {
    var id = get_(r, 'asset.id');
    if (!byVideo[id]) {
      var ytId = get_(r, 'asset.youtubeVideoAsset.youtubeVideoId') || '';
      byVideo[id] = blankMetrics_({
        id: id,
        videoId: ytId,
        title: get_(r, 'asset.youtubeVideoAsset.youtubeVideoTitle') ||
               get_(r, 'asset.name') || ('Video ' + id),
        url: ytId ? 'https://www.youtube.com/watch?v=' + ytId : '',
        thumb: ytId ? 'https://i.ytimg.com/vi/' + ytId + '/mqdefault.jpg' : '',
        label: pretty_(get_(r, 'adGroupAdAssetView.performanceLabel')) || '',
        campaigns: {},
        adGroups: {}
      });
    }
    var v = byVideo[id];
    addMetrics_(v, metricsOf_(r));
    v.campaigns[get_(r, 'campaign.name')] = true;
    v.adGroups[get_(r, 'adGroup.name')] = true;
    // Keep the strongest rating Google has given this video anywhere.
    var rank = { 'Best': 3, 'Good': 2, 'Low': 1 };
    if ((rank[pretty_(get_(r, 'adGroupAdAssetView.performanceLabel'))] || 0) >
        (rank[v.label] || 0)) {
      v.label = pretty_(get_(r, 'adGroupAdAssetView.performanceLabel'));
    }
  });

  return Object.keys(byVideo).map(function(id) {
    var v = byVideo[id];
    ['p25', 'p50', 'p75', 'p100'].forEach(function(key) {
      v[key] = safeDiv_(v['_w' + key] || 0, v.impressions);
      delete v['_w' + key];
    });
    v.campaignList = Object.keys(v.campaigns);
    v.adGroupCount = Object.keys(v.adGroups).length;
    delete v.campaigns;
    delete v.adGroups;
    return derive_(v);
  }).filter(hasVolume_).sort(function(a, b) { return b.cost - a.cost; });
}

/**
 * Watch depth is not selectable on ad_group_ad_asset_view, so borrow it from
 * ads carrying exactly one video. Ads with several videos cannot be attributed
 * to a single asset, so they are skipped rather than guessed at.
 */
/**
 * How many videos are packed into single ads.
 *
 * This is the root cause of the missing per-video watch depth, so it is
 * measured rather than left as an aside. Google reports one blended rate per
 * ad, which means every video inside a multi-video ad becomes unmeasurable
 * individually.
 */
function packingOf_(ads) {
  var multi = 0, worst = 0, affected = {};
  (ads || []).forEach(function(ad) {
    var count = (ad.videoLinks || []).length;
    if (count > 1) {
      multi++;
      if (count > worst) worst = count;
      ad.videoLinks.forEach(function(link) { affected[link.id] = true; });
    }
  });
  return {
    multiVideoAds: multi,
    maxVideosInOneAd: worst,
    videosAffected: Object.keys(affected).length,
    singleVideoAds: (ads || []).filter(function(ad) {
      return (ad.videoLinks || []).length === 1;
    }).length
  };
}

function backfillVideoQuartiles_(videos, ads) {
  if (!videos || !videos.length || !ads || !ads.length) return;
  if (videos.some(function(v) { return v.p25 || v.p100; })) return;

  var byYouTubeId = {};
  videos.forEach(function(v) {
    if (v.videoId) byYouTubeId[v.videoId] = v;
  });

  // Only ads carrying exactly one video say anything about that video. An ad
  // with several videos reports one blended rate across all of them, so
  // copying it onto each card invents per-video differences that do not exist.
  var totals = {};
  var sharedAd = {};
  ads.forEach(function(ad) {
    if (!ad.videoLinks || !ad.videoLinks.length) return;
    if (ad.videoLinks.length > 1) {
      ad.videoLinks.forEach(function(link) { sharedAd[link.id] = true; });
      return;
    }
    var id = ad.videoLinks[0].id;
    if (!byYouTubeId[id]) return;
    if (!totals[id]) {
      totals[id] = { impressions: 0, p25: 0, p50: 0, p75: 0, p100: 0 };
    }
    var bucket = totals[id];
    bucket.impressions += ad.impressions || 0;
    ['p25', 'p50', 'p75', 'p100'].forEach(function(key) {
      bucket[key] += (ad[key] || 0) * (ad.impressions || 0);
    });
  });

  var filled = 0;
  Object.keys(totals).forEach(function(id) {
    var bucket = totals[id];
    if (!bucket.impressions) return;
    var video = byYouTubeId[id];
    ['p25', 'p50', 'p75', 'p100'].forEach(function(key) {
      video[key] = bucket[key] / bucket.impressions;
    });
    video.quartileSource = 'ad';
    filled++;
  });

  var unavailable = 0;
  videos.forEach(function(v) {
    if (v.quartileSource) return;
    v.depthNote = sharedAd[v.videoId] ? 'shared-ad' : 'unmatched';
    unavailable++;
  });

  if (filled) {
    log_('Watch depth', 'Not selectable per asset. Estimated for ' + filled +
        ' video(s) from ads carrying a single video.' +
        (unavailable ? ' ' + unavailable + ' left blank — no single-video ad.' : ''));
  } else {
    log_('Watch depth', 'Unavailable per video. Every video shares an ad with ' +
        'others, and a multi-video ad reports one blended rate, so per-video ' +
        'watch depth would be identical and meaningless. Use ad-level or ' +
        'account-level watch depth instead.');
  }
}

/**
 * Conversion actions per campaign. Segmenting by conversion action makes cost
 * and impression metrics unselectable, so this pull carries conversion
 * counters only and is reported as its own slice.
 */
function pullConversionActions_(dateClause) {
  var rows = gaql_('Conversion actions', 'campaign',
      ['campaign.name', 'segments.conversion_action_name',
       'metrics.all_conversions'],
      [['metrics.all_conversions_value'],
       ['metrics.conversions', 'metrics.conversions_value'],
       ['segments.conversion_action_category']],
      DGEN + ' AND ' + dateClause, 'metrics.all_conversions DESC');

  return rows.map(function(r) {
    return {
      campaign: get_(r, 'campaign.name'),
      action: get_(r, 'segments.conversionActionName') || 'Unnamed action',
      category: pretty_(get_(r, 'segments.conversionActionCategory')) || '',
      allConversions: num_(get_(r, 'metrics.allConversions')),
      allConvValue: num_(get_(r, 'metrics.allConversionsValue')),
      conversions: num_(get_(r, 'metrics.conversions')),
      convValue: num_(get_(r, 'metrics.conversionsValue'))
    };
  }).filter(function(r) {
    return r.allConversions > 0 || r.conversions > 0;
  });
}

/**
 * Conversion actions per video. Tries asset level first; if the API will not
 * segment an asset view by conversion action, falls back to ad level and
 * attributes to videos through ads carrying exactly one video, which is the
 * only unambiguous mapping available.
 */
function attachVideoConversions_(videos, ads, dateClause) {
  if (!videos || !videos.length) return;

  var byAssetId = {};
  var byYouTubeId = {};
  videos.forEach(function(v) {
    byAssetId[v.id] = v;
    if (v.videoId) byYouTubeId[v.videoId] = v;
    v.conversionActions = [];
  });

  function record(video, row, weight) {
    var action = get_(row, 'segments.conversionActionName') || 'Unnamed action';
    var found = null;
    for (var i = 0; i < video.conversionActions.length; i++) {
      if (video.conversionActions[i].action === action) {
        found = video.conversionActions[i];
        break;
      }
    }
    if (!found) {
      found = {
        action: action,
        category: pretty_(get_(row, 'segments.conversionActionCategory')) || '',
        allConversions: 0, allConvValue: 0, conversions: 0
      };
      video.conversionActions.push(found);
    }
    found.allConversions += num_(get_(row, 'metrics.allConversions')) * weight;
    found.allConvValue += num_(get_(row, 'metrics.allConversionsValue')) * weight;
    found.conversions += num_(get_(row, 'metrics.conversions')) * weight;
  }

  var assetRows = gaql_('Video conversion actions', 'ad_group_ad_asset_view',
      ['asset.id', 'segments.conversion_action_name', 'metrics.all_conversions'],
      [['metrics.all_conversions_value'], ['metrics.conversions'],
       ['segments.conversion_action_category']],
      DGEN + " AND asset.type = 'YOUTUBE_VIDEO' AND " + dateClause);

  var source = '';
  if (assetRows.length) {
    assetRows.forEach(function(r) {
      var video = byAssetId[get_(r, 'asset.id')];
      if (video) record(video, r, 1);
    });
    source = 'asset';
  } else {
    var single = {};
    ads.forEach(function(ad) {
      if (ad.videoLinks && ad.videoLinks.length === 1) {
        single[ad.id] = byYouTubeId[ad.videoLinks[0].id];
      }
    });

    var adRows = gaql_('Video conversion actions (from ads)', 'ad_group_ad',
        ['ad_group_ad.ad.id', 'segments.conversion_action_name',
         'metrics.all_conversions'],
        [['metrics.all_conversions_value'], ['metrics.conversions'],
         ['segments.conversion_action_category']],
        DGEN + ' AND ' + dateClause);

    adRows.forEach(function(r) {
      var video = single[get_(r, 'adGroupAd.ad.id')];
      if (video) record(video, r, 1);
    });
    if (adRows.length) source = 'ad';
  }

  var withData = 0;
  videos.forEach(function(v) {
    v.conversionActions.sort(function(a, b) {
      return b.allConversions - a.allConversions;
    });
    v.conversionSource = source;
    if (v.conversionActions.length) withData++;
  });

  if (source) {
    log_('Video conversion split', withData + ' video(s) broken out at ' +
        source + ' level.');
  }
}

// ===========================================================================
// VIEWER LABELS
// ===========================================================================

/** Called from the dashboard via google.script.run. */
function saveLabels(json) {
  if (!CONFIG.ALLOW_LABELING) return 'disabled';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return 'no-spreadsheet';
  var sheet = ss.getSheetByName(LABELS_SHEET);
  if (!sheet) sheet = ss.insertSheet(LABELS_SHEET);
  sheet.clear();
  sheet.getRange(1, 1).setValue(String(json).substring(0, PAYLOAD_CHUNK));
  try {
    sheet.hideSheet();
  } catch (e) {
    // Cannot hide the only visible sheet; harmless.
  }
  return 'ok';
}

function readLabels_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return '{}';
  var sheet = ss.getSheetByName(LABELS_SHEET);
  if (!sheet || !sheet.getLastRow()) return '{}';
  var value = sheet.getRange(1, 1).getValue();
  return value ? String(value) : '{}';
}

// ===========================================================================
// CREATIVE INVENTORY
// ===========================================================================

function attachCreatives_(ads) {
  if (!ads.length) return;

  var byId = {};
  ads.forEach(function(ad) { byId[ad.id] = ad; });
  var assetRefs = {};

  [{ type: 'DEMAND_GEN_MULTI_ASSET_AD', field: 'demandGenMultiAssetAd',
     select: ['ad_group_ad.ad.demand_gen_multi_asset_ad.headlines',
              'ad_group_ad.ad.demand_gen_multi_asset_ad.descriptions',
              'ad_group_ad.ad.demand_gen_multi_asset_ad.marketing_images',
              'ad_group_ad.ad.demand_gen_multi_asset_ad.square_marketing_images',
              'ad_group_ad.ad.demand_gen_multi_asset_ad.portrait_marketing_images',
              'ad_group_ad.ad.demand_gen_multi_asset_ad.logo_images',
              'ad_group_ad.ad.demand_gen_multi_asset_ad.business_name',
              'ad_group_ad.ad.demand_gen_multi_asset_ad.call_to_action_text'] },
   { type: 'DEMAND_GEN_VIDEO_RESPONSIVE_AD', field: 'demandGenVideoResponsiveAd',
     select: ['ad_group_ad.ad.demand_gen_video_responsive_ad.headlines',
              'ad_group_ad.ad.demand_gen_video_responsive_ad.long_headlines',
              'ad_group_ad.ad.demand_gen_video_responsive_ad.descriptions',
              'ad_group_ad.ad.demand_gen_video_responsive_ad.videos',
              'ad_group_ad.ad.demand_gen_video_responsive_ad.logo_images',
              'ad_group_ad.ad.demand_gen_video_responsive_ad.business_name',
              'ad_group_ad.ad.demand_gen_video_responsive_ad.call_to_actions'] },
   { type: 'DEMAND_GEN_CAROUSEL_AD', field: 'demandGenCarouselAd',
     select: ['ad_group_ad.ad.demand_gen_carousel_ad.headline',
              'ad_group_ad.ad.demand_gen_carousel_ad.description',
              'ad_group_ad.ad.demand_gen_carousel_ad.carousel_cards',
              'ad_group_ad.ad.demand_gen_carousel_ad.logo_image',
              'ad_group_ad.ad.demand_gen_carousel_ad.business_name',
              'ad_group_ad.ad.demand_gen_carousel_ad.call_to_action_text'] }
  ].forEach(function(spec) {
    var rows = gaql_('Creative: ' + pretty_(spec.type), 'ad_group_ad',
        ['ad_group_ad.ad.id'], [spec.select],
        DGEN + " AND ad_group_ad.ad.type = '" + spec.type + "'");

    rows.forEach(function(r) {
      var ad = byId[get_(r, 'adGroupAd.ad.id')];
      if (!ad) return;
      var creative = get_(r, 'adGroupAd.ad.' + spec.field);
      if (!creative) return;

      ad.businessName = creative.businessName || '';
      ad.cta = creative.callToActionText || textOf_(creative.callToActions) || '';
      ad.headlines = textOf_(creative.headlines) ||
          (creative.headline ? [creative.headline] : []);
      ad.descriptions = textOf_(creative.descriptions) ||
          (creative.description ? [creative.description] : []);

      ['marketingImages', 'squareMarketingImages', 'portraitMarketingImages',
       'classicDisplayImages', 'logoImages'].forEach(function(key) {
        (creative[key] || []).forEach(function(item) {
          if (item && item.asset) {
            ad.images.push(item.asset);
            assetRefs[item.asset] = true;
          }
        });
      });
      (creative.videos || []).forEach(function(item) {
        if (item && item.asset) {
          ad.videos.push(item.asset);
          assetRefs[item.asset] = true;
        }
      });
    });
  });

  var urls = resolveAssetUrls_(Object.keys(assetRefs));

  ads.forEach(function(ad) {
    ad.imageUrls = dedupe_(ad.images.map(function(ref) {
      return (urls[ref] || {}).imageUrl;
    }).filter(Boolean)).slice(0, 6);

    ad.videoLinks = dedupe_(ad.videos.map(function(ref) {
      var id = (urls[ref] || {}).videoId;
      return id ? { id: id, url: 'https://www.youtube.com/watch?v=' + id,
                    thumb: 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg' }
                : null;
    }).filter(Boolean), 'id').slice(0, 6);

    if (!ad.name) ad.name = ad.headlines[0] || ad.businessName || ('Ad ' + ad.id);
    ad.thumb = ad.videoLinks.length ? ad.videoLinks[0].thumb
                                    : (ad.imageUrls[0] || '');
    delete ad.images;
    delete ad.videos;
  });

  return urls;
}

/**
 * A video row without a YouTube ID has no thumbnail and no link. Creative
 * resolution already mapped asset resource names to YouTube IDs, so reuse that
 * rather than leaving the card blank.
 */
function backfillVideoIdentity_(videos, assetUrls) {
  if (!videos || !videos.length || !assetUrls) return;

  var byAssetId = {};
  Object.keys(assetUrls).forEach(function(resourceName) {
    byAssetId[resourceName.split('/').pop()] = assetUrls[resourceName];
  });

  var fixed = 0;
  videos.forEach(function(v) {
    if (v.videoId) return;
    var match = byAssetId[String(v.id)];
    if (!match || !match.videoId) return;
    v.videoId = match.videoId;
    v.url = 'https://www.youtube.com/watch?v=' + match.videoId;
    v.thumb = 'https://i.ytimg.com/vi/' + match.videoId + '/mqdefault.jpg';
    fixed++;
  });

  if (fixed) {
    log_('Video identity', 'Recovered YouTube IDs for ' + fixed +
        ' video(s) from creative resolution.');
  }
}

function resolveAssetUrls_(refs) {
  var map = {};
  var ids = refs.map(function(ref) { return ref.split('/').pop(); });

  chunk_(ids, 400).forEach(function(batch) {
    var rows = gaql_('Resolve assets', 'asset',
        ['asset.id', 'asset.resource_name', 'asset.type'],
        [['asset.image_asset.full_size.url'],
         ['asset.youtube_video_asset.youtube_video_id']],
        'asset.id IN (' + batch.join(',') + ')');

    rows.forEach(function(r) {
      map[get_(r, 'asset.resourceName')] = {
        imageUrl: get_(r, 'asset.imageAsset.fullSize.url') || '',
        videoId: get_(r, 'asset.youtubeVideoAsset.youtubeVideoId') || ''
      };
    });
  });
  return map;
}

// ===========================================================================
// METRICS
// ===========================================================================

function blankMetrics_(seed) {
  var m = seed || {};
  m.impressions = 0; m.clicks = 0; m.cost = 0; m.conversions = 0;
  m.convValue = 0; m.viewThrough = 0; m.videoViews = 0;
  m.allConversions = 0; m.allConvValue = 0;
  m.engagements = 0; m.interactions = 0;
  m.p25 = 0; m.p50 = 0; m.p75 = 0; m.p100 = 0;
  return m;
}

/** REST omits zero-valued fields and returns int64 as strings — num_ handles both. */
function metricsOf_(row) {
  var m = row.metrics || {};
  return derive_({
    impressions: num_(m.impressions),
    clicks: num_(m.clicks),
    cost: micros_(m.costMicros),
    conversions: num_(m.conversions),
    convValue: num_(m.conversionsValue),
    viewThrough: num_(m.viewThroughConversions),
    allConversions: num_(m.allConversions),
    allConvValue: num_(m.allConversionsValue),
    videoViews: num_(m.videoTrueviewViews !== undefined
        ? m.videoTrueviewViews : m.videoViews),
    engagements: num_(m.engagements),
    interactions: num_(m.interactions),
    p25: num_(m.videoQuartileP25Rate),
    p50: num_(m.videoQuartileP50Rate),
    p75: num_(m.videoQuartileP75Rate),
    p100: num_(m.videoQuartileP100Rate)
  });
}

/** Rates are computed from raw counters so grouped rows stay correct. */
function derive_(m) {
  m.ctr = safeDiv_(m.clicks, m.impressions);
  m.cpc = safeDiv_(m.cost, m.clicks);
  m.cpm = safeDiv_(m.cost, m.impressions) * 1000;
  m.cvr = safeDiv_(m.conversions, m.clicks);
  m.cpa = safeDiv_(m.cost, m.conversions);
  m.roas = safeDiv_(m.convValue, m.cost);
  m.viewRate = safeDiv_(m.videoViews, m.impressions);
  m.cpv = safeDiv_(m.cost, m.videoViews);
  m.allCvr = safeDiv_(m.allConversions, m.clicks);
  m.allCpa = safeDiv_(m.cost, m.allConversions);
  m.allRoas = safeDiv_(m.allConvValue, m.cost);
  // Actions tracked but excluded from the bidding column.
  m.convGap = Math.max(0, m.allConversions - m.conversions);
  m.totalConv = m.conversions + m.viewThrough;
  m.vtcShare = safeDiv_(m.viewThrough, m.totalConv);
  // Cost per conversion counting view-through alongside click/engaged conv.
  // The full-funnel efficiency number Demand Gen should be judged on.
  m.cpaVtc = safeDiv_(m.cost, m.totalConv);
  return m;
}

function addMetrics_(target, source) {
  ['impressions', 'clicks', 'cost', 'conversions', 'convValue', 'viewThrough',
   'allConversions', 'allConvValue', 'videoViews', 'engagements',
   'interactions'].forEach(function(key) {
    target[key] = (target[key] || 0) + (source[key] || 0);
  });
  // Quartiles arrive as rates, so weight them by impressions.
  ['p25', 'p50', 'p75', 'p100'].forEach(function(key) {
    target['_w' + key] = (target['_w' + key] || 0) +
        (source[key] || 0) * (source.impressions || 0);
  });
  return target;
}

function rollup_(rows) {
  var total = blankMetrics_({});
  rows.forEach(function(row) { addMetrics_(total, row); });
  ['p25', 'p50', 'p75', 'p100'].forEach(function(key) {
    total[key] = safeDiv_(total['_w' + key] || 0, total.impressions);
    delete total['_w' + key];
  });
  return derive_(total);
}

function rollupBy_(rows, key) {
  var groups = {};
  rows.forEach(function(row) {
    var k = row[key] || 'Unattributed';
    if (!groups[k]) groups[k] = [];
    groups[k].push(row);
  });
  return Object.keys(groups).map(function(k) {
    var out = rollup_(groups[k]);
    out[key] = k;
    out.color = colorFor_(k);
    return out;
  }).sort(function(a, b) { return b.cost - a.cost; });
}

// ===========================================================================
// HELPERS
// ===========================================================================

function get_(obj, path) {
  var parts = path.split('.');
  var cur = obj;
  for (var i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined) return null;
    cur = cur[parts[i]];
  }
  return cur === undefined ? null : cur;
}

function num_(v) {
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

function micros_(v) { return num_(v) / 1000000; }
function safeDiv_(a, b) { return b ? a / b : 0; }
function digits_(v) { return String(v).replace(/[^0-9]/g, ''); }

function formatId_(v) {
  var d = digits_(v);
  return d.length === 10
      ? d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6) : d;
}

/** Records how many entities exist vs how many actually delivered. */
function tally_(key, rows) {
  var kept = rows.filter(hasVolume_);
  COUNTS[key] = { total: rows.length, active: kept.length };
  return kept;
}

function hasVolume_(row) {
  return !CONFIG.HIDE_ZERO_IMPRESSION_ROWS || row.impressions > 0;
}

function pretty_(value) {
  if (!value) return '';
  return String(value).toLowerCase().split('_').map(function(word) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

function textOf_(list) {
  if (!list || !list.length) return null;
  return list.map(function(item) {
    return typeof item === 'string' ? item : (item.text || '');
  }).filter(Boolean);
}

function dedupe_(list, key) {
  var seen = {};
  return list.filter(function(item) {
    var id = key ? item[key] : item;
    if (seen[id]) return false;
    seen[id] = true;
    return true;
  });
}

function chunk_(list, size) {
  var out = [];
  for (var i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function channelLabel_(key) {
  var entry = CHANNELS[key];
  return entry ? entry.label : (pretty_(key) || 'Unattributed');
}

function colorFor_(label) {
  for (var key in CHANNELS) {
    if (CHANNELS[key].label === label) return CHANNELS[key].color;
  }
  return '#8A8F9E';
}

function buildDateRange_() {
  var tz = Session.getScriptTimeZone();
  var day = 24 * 60 * 60 * 1000;
  var end = new Date(new Date().getTime() - day);
  var start = new Date(end.getTime() - (CONFIG.LAST_N_DAYS - 1) * day);

  var range = {
    start: fmtDate_(start, tz),
    end: fmtDate_(end, tz),
    current: "segments.date BETWEEN '" + fmtDate_(start, tz) + "' AND '" +
        fmtDate_(end, tz) + "'"
  };

  if (CONFIG.COMPARE_PRIOR_PERIOD) {
    var priorEnd = new Date(start.getTime() - day);
    var priorStart = new Date(priorEnd.getTime() - (CONFIG.LAST_N_DAYS - 1) * day);
    range.priorStart = fmtDate_(priorStart, tz);
    range.priorEnd = fmtDate_(priorEnd, tz);
    range.prior = "segments.date BETWEEN '" + range.priorStart + "' AND '" +
        range.priorEnd + "'";
  }
  return range;
}

function fmtDate_(date, tz) {
  return Utilities.formatDate(date, tz, 'yyyy-MM-dd');
}

// ===========================================================================
// PLAIN-LANGUAGE READ-OUT
// ===========================================================================

/**
 * The "what the numbers say" lines, generated once on the server so the
 * dashboard and the slide deck cannot drift apart. Numbers are wrapped in **
 * markers; the dashboard turns them bold, the deck strips them.
 *
 * @param {!Object} data Audited account data.
 * @param {string} mode 'conversions' or 'all'.
 * @return {!Array<string>}
 */
function buildReadout_(data, mode) {
  var t = data.totals;
  var k = (mode === 'all')
      ? { conv: 'allConversions', cpa: 'allCpa', word: 'all conversions' }
      : { conv: 'conversions', cpa: 'cpa', word: 'conversions' };
  var cur = data.account.currency;
  var lines = [];

  function money(v) {
    return cur + ' ' + (Number(v) || 0).toLocaleString(undefined,
        { maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 });
  }
  function pct0(v) { return Math.round((Number(v) || 0) * 100) + '%'; }
  function int(v) { return Math.round(Number(v) || 0).toLocaleString(); }

  var mix = (data.channelMix || []).filter(function(c) { return c.cost > 0; });
  var spend = mix.reduce(function(sum, c) { return sum + c.cost; }, 0);

  if (mix.length && spend) {
    var top = mix[0];
    var convTotal = mix.reduce(function(sum, c) { return sum + (c[k.conv] || 0); }, 0);
    var verdict = (top[k.cpa] && t[k.cpa])
        ? (top[k.cpa] < t[k.cpa] ? 'cheaper than' : 'costlier than')
        : 'in line with';
    lines.push('**' + top.channel + '** took **' + pct0(top.cost / spend) +
        '** of spend and returned **' +
        pct0(convTotal ? (top[k.conv] || 0) / convTotal : 0) + '** of ' + k.word +
        ', at ' + (top[k.cpa] ? money(top[k.cpa]) : 'no') + ' per action — ' +
        verdict + ' the account at ' + (t[k.cpa] ? money(t[k.cpa]) : 'n/a') + '.');
  }

  var surfaces = (data.surfaceMix || []).filter(function(r) { return r.cost > 0; });
  if (surfaces.length > 1) {
    var surfaceSpend = surfaces.reduce(function(sum, r) { return sum + r.cost; }, 0);
    var lead = surfaces[0];
    var efficient = surfaces.slice().filter(function(r) { return r[k.conv] > 0; })
        .sort(function(a, b) { return a[k.cpa] - b[k.cpa]; })[0];
    lines.push('**' + lead.surface + '** is the biggest surface at **' +
        pct0(lead.cost / surfaceSpend) + '** of spend across ' + surfaces.length +
        ' formats.' +
        ((efficient && efficient.surface !== lead.surface)
            ? ' The cheapest action came from **' + efficient.surface +
              '** at **' + money(efficient[k.cpa]) + '**.'
            : ''));
  }

  if (t.allConversions && t.convGap > 0.5) {
    lines.push('All-conversions tracking counts **' + int(t.allConversions) +
        '** actions against **' + int(t.conversions) + '** in the Conversions ' +
        'column, so **' + int(t.convGap) + '** tracked actions sit outside what ' +
        'Smart Bidding optimises toward.');
  }

  if (t.viewThrough > 0 && t.vtcShare > 0.15) {
    lines.push('**' + pct0(t.vtcShare) + '** of attributed action is ' +
        'view-through (**' + int(t.viewThrough) + '** conversions), which is ' +
        'not counted in cost per action or ROAS.');
  }

  var counts = data.counts || {};
  var dormant = [];
  [['campaigns', 'campaigns'], ['adGroups', 'ad groups'], ['ads', 'ads'],
   ['audiences', 'audiences']].forEach(function(pair) {
    var c = counts[pair[0]];
    if (c && c.total > c.active) {
      dormant.push((c.total - c.active) + ' of ' + c.total + ' ' + pair[1]);
    }
  });
  if (dormant.length) {
    lines.push('Most of the build is dormant: **' + dormant.join('**, **') +
        '** recorded no impressions in this window.');
  }

  var packing = data.creativePacking;
  if (packing && packing.multiVideoAds) {
    lines.push('**' + packing.multiVideoAds + ' ad' +
        (packing.multiVideoAds === 1 ? '' : 's') + '** carr' +
        (packing.multiVideoAds === 1 ? 'ies' : 'y') + ' more than one video' +
        (packing.maxVideosInOneAd > 1
            ? ' (up to **' + packing.maxVideosInOneAd + '** in a single ad)'
            : '') + ', which is why **' + packing.videosAffected +
        '** video' + (packing.videosAffected === 1 ? '' : 's') +
        ' have no individual watch depth: Google reports one blended rate per ' +
        'ad. Splitting each video into its own ad restores completion rate and ' +
        'per-creative reporting.');
  }

  var vids = data.videos || [];
  if (vids.length) {
    var best = vids.slice().filter(function(v) { return v[k.conv] > 0; })
        .sort(function(a, b) { return a[k.cpa] - b[k.cpa]; })[0];
    if (best) {
      lines.push('Most efficient video is **' + best.title + '** at **' +
          money(best[k.cpa]) + '** per action on ' + money(best.cost) + ' of spend.');
    }
    var byView = vids.slice().filter(function(v) { return v.impressions > 1000; })
        .sort(function(a, b) { return b.viewRate - a.viewRate; });
    if (byView.length > 1 && byView[0].viewRate > byView[byView.length - 1].viewRate * 2) {
      lines.push('View rate spreads from **' + pct0(byView[0].viewRate) +
          '** on ' + byView[0].title + ' down to **' +
          pct0(byView[byView.length - 1].viewRate) + '** on ' +
          byView[byView.length - 1].title + ', a gap worth explaining before ' +
          'the next creative round.');
    }
  }

  var settings = data.settings;
  if (settings && settings.campaigns && settings.campaigns.length) {
    var noAcquisition = settings.campaigns.filter(function(c) {
      return c.acquisition === 'Not configured' ||
          c.acquisition === ACQUISITION_MODES.TARGET_ALL_EQUALLY;
    });
    if (noAcquisition.length === settings.campaigns.length) {
      lines.push('No campaign distinguishes new from existing customers — ' +
          'bidding treats both equally, so prospecting budget can be spent ' +
          'reaching people who already buy.');
    }

    var automationOff = [];
    settings.campaigns.forEach(function(c) {
      (c.automation || []).forEach(function(a) {
        if (!a.on && automationOff.indexOf(a.name) === -1) {
          automationOff.push(a.name);
        }
      });
    });
    if (automationOff.length) {
      lines.push('Asset optimisation is off for **' + automationOff.join('**, **') +
          '**, which limits how many placements the existing creative can fill.');
    }

    var noExclusions = settings.campaigns.filter(function(c) {
      return !(c.excludedAudiences || []).length;
    }).length;
    if (noExclusions === settings.campaigns.length) {
      lines.push('No campaign excludes an existing-customer list, so ' +
          'prospecting and retention are competing for the same impressions.');
    }
  }

  var vtcActions = ((data.settings || {}).conversionActions || [])
      .filter(function(a) { return a.inColumn && a.viewThroughDays > 0; });
  if (vtcActions.length === 0 && (data.settings || {}).conversionActions &&
      data.settings.conversionActions.length) {
    lines.push('No conversion action in the Conversions column counts ' +
        'view-through, so bidding sees none of the impression-driven response ' +
        'that Demand Gen is built to create.');
  }

  if (data.prior && data.prior.cost) {
    var change = (t.cost - data.prior.cost) / data.prior.cost;
    var cpaWord = '';
    if (data.prior[k.cpa] && t[k.cpa]) {
      var cd = (t[k.cpa] - data.prior[k.cpa]) / data.prior[k.cpa];
      cpaWord = ' while cost per action ' + (cd >= 0 ? 'rose' : 'fell') +
          ' **' + Math.abs(cd * 100).toFixed(0) + '%**';
    }
    lines.push('Spend ' + (change >= 0 ? 'rose' : 'fell') + ' **' +
        Math.abs(change * 100).toFixed(0) + '%** against the previous period' +
        cpaWord + '.');
  }

  return lines.length ? lines : ['No spend recorded in this window.'];
}

/** Strips the ** emphasis markers for surfaces that cannot render them. */
function plainText_(line) {
  return String(line).replace(/\*\*/g, '');
}

// ===========================================================================
// ANALYSIS BRIEF
// ===========================================================================

/**
 * A compact, self-describing markdown digest built for a language model.
 *
 * Handing an LLM the raw Sheet is worse than this: fifteen tabs of rows burn
 * context on redundancy and, more importantly, strip the caveats that change
 * how the numbers should be read. Inferred watch depth, conversion actions
 * excluded from bidding, fields the API refused — none of that survives a CSV.
 * So the caveats lead, the aggregates follow, and long tables are capped with
 * an explicit note about what was omitted.
 */
/**
 * The instruction half of the export. The brief supplies evidence; this
 * supplies the job. Kept with the data so the two never separate.
 */
// Built from POV so the strategic lens and the prompt never drift apart.
var ANALYSIS_PROMPT = (function() {
  var lens = [
    'You are auditing a Google Ads Demand Gen account for Lockhern Digital, a',
    'paid-search-focused agency. The data below is the complete export. Work',
    'only from it.',
    '',
    'THE LENS — audit this as Demand Gen, not as Search.',
    POV.thesis,
    '',
    'Judge the account against these principles:'
  ].concat(POV.principles.map(function(p) { return '- ' + p; }))
   .concat([
    '',
    'And read it on the signals a purchase-only lens misses:'
  ]).concat(POV.metrics.map(function(m) { return '- ' + m; }))
   .concat([
    '',
    'Foundation for measurement:'
  ]).concat(POV.foundation.map(function(f) { return '- ' + f; }))
   .concat(['', 'Expectation: ' + POV.expectation, '']);

  var body = [
    'Produce, in this order:',
    '',
    '1. VERDICT — three sentences. Is this account working as a Demand Gen',
    '   programme should? The single biggest problem, and the single biggest',
    '   opportunity. Lead with the number that makes the case.',
    '',
    '2. WHAT IS WORKING — up to four points. Each names the entity, quotes the',
    '   figure, and says why it matters. Credit attention and mid-funnel signal',
    '   (view rate, watch-through, view-through), not only last-click purchases.',
    '   Skip anything you cannot quantify.',
    '',
    '3. WHAT IS NOT — up to five points, ordered by money at stake. Quantify the',
    '   waste where the data allows: dormant structure, surfaces or audiences',
    '   above account cost per action, creative with spend and no conversions.',
    '',
    '4. THE CONVERSION QUESTION — compare the Conversions column against all',
    '   conversions. Say what the bidding algorithm is and is not optimising',
    '   toward, and name the specific actions sitting outside the column. Our',
    '   stance is deliberate: feeding the algorithm mid-funnel signal by setting',
    '   Add to Cart and Begin Checkout to Primary is intended, not a mistake.',
    '   Judge whether this account has done that or is optimising to purchase',
    '   only — and say what that choice is costing in learning and volume.',
    '',
    '5. SETTINGS REVIEW — read the campaign settings section against the results.',
    '   Flag specifically: whether new vs existing customers are distinguished,',
    '   whether existing-customer lists are excluded from prospecting, whether',
    '   asset optimisation toggles are off, whether the ad schedule or location',
    '   targeting is narrowing delivery, whether the daily budget is plausible',
    '   for the conversion volume, and whether conversion actions in the bidding',
    '   column credit view-through. Say what each misconfiguration costs.',
    '',
    '6. CREATIVE PACKING — if any ad carries more than one video, call it out.',
    '   Google reports one blended watch-depth figure per ad, so every video in',
    '   a multi-video ad is individually unmeasurable. Recommend splitting each',
    '   video into its own ad, and state exactly which metrics that recovers.',
    '',
    '7. CREATIVE READ — per video, using spend, cost per action, view rate and',
    '   the 25/50/75/100% watch funnel. View rate is measured per video and is',
    '   the reliable creative signal. Compare advertiser uploads against the',
    '   AI-modified cuts (Enhanced by Google AI / shortened / resized): do the',
    '   machine edits hold attention or convert differently? Watch depth may be',
    '   inferred or absent; if it is, say so rather than substituting another',
    '   metric. You cannot see the creative, so mark any claim about WHY a video',
    '   performs as a hypothesis.',
    '',
    '8. RECOMMENDATIONS — up to six, each as: action, expected effect, and how to',
    '   know it worked. Order by expected impact. Treat creative and landing',
    '   pages as the primary levers. Mark each OBSERVED (the data supports it',
    '   directly) or TEST (plausible but unproven). Never present a test as a',
    '   finding.',
    '',
    '9. WHAT I COULD NOT ASSESS — what the data does not cover (e.g. attributed',
    '   brand search, brand lift, cost per quiz/email submit, CRM-tied revenue),',
    '   and what you would need to answer it.',
    '',
    'Rules:',
    '- Every claim carries a number. No adjectives without evidence.',
    '- Respect the caveats in the "Read this before interpreting" section. Where',
    '  a caveat undermines a conclusion, say so instead of working around it.',
    '- Correlation is not causation. One period is not a trend.',
    '- Small denominators are not results. Flag them.',
    '- Demand Gen is not supposed to work off the rip. Do not condemn early',
    '  spend that is building signal; distinguish "not working" from "not yet".',
    '- If the data contradicts a conventional best practice, say that plainly.',
    '- No filler, no restating the tables, no generic paid-media advice.',
    '',
    '---',
    ''
  ];
  return lens.concat(body).join('\n');
})();

/** Exposed so the dashboard can copy the prompt on its own. */
function getAnalysisPrompt() {
  return ANALYSIS_PROMPT;
}

/**
 * The design brief for the exported deck.
 *
 * Built per account rather than kept static, because a redesign instruction
 * without the findings produces generic polish. Handing over the actual
 * takeaways lets whoever redesigns it write assertion titles instead of
 * relabelling "Audiences" as "Audience Performance".
 */
function buildDeckPrompt_(data) {
  var a = data.account;
  var t = data.totals || {};
  var p = data.prior || null;
  var lines = [];
  function push(line) { lines.push(line === undefined ? '' : String(line)); }
  function money0(v) {
    return (a.currency || '') + ' ' + Math.round(Number(v) || 0).toLocaleString();
  }
  function pct1(v) { return ((Number(v) || 0) * 100).toFixed(1) + '%'; }
  function pct0(v) { return Math.round((Number(v) || 0) * 100) + '%'; }
  function dlt(key) {
    if (!p || !p[key]) return 'n/a';
    var ch = ((t[key] || 0) - p[key]) / p[key];
    return (ch >= 0 ? '+' : '') + Math.round(ch * 100) + '%';
  }

  var notes = {};
  try { notes = readCommentary_(); } catch (e) { notes = {}; }
  var overrides = {};
  try { overrides = readOverrides_(); } catch (e) { overrides = {}; }
  var groundTruth = overrides['settingsGroundTruth'] || '';

  push('Build a polished, client-ready Lockhern Digital audit deck from the');
  push('material below and the rough .pptx attached (auto-exported from Google');
  push('Slides). The numbers are correct; your job is the argument, the design,');
  push('and the point of view. Use a strong model for this (Opus). Do not just');
  push('reformat the rough deck. Rebuild it as a designed, visual document.');
  push('');
  push('## Account');
  push('');
  push('- Account: ' + a.name + ' (' + a.id + ')');
  push('- Window: ' + a.start + ' to ' + a.end +
       (a.priorStart ? ', vs prior ' + a.priorStart + ' to ' + a.priorEnd : ''));
  push('- Currency: ' + a.currency + '. Channel: Google Ads Demand Gen only.');
  push('');

  push('## Hard rules (read first)');
  push('');
  push('1. NEVER use an em dash or en dash (the long or medium hyphen) anywhere');
  push('   in the deck. They are the clearest tell of AI writing. Use periods,');
  push('   commas, colons, or a new line instead. A normal hyphen inside a word');
  push('   is fine.');
  push('2. Every content slide is VISUAL, not a table dump. See the design');
  push('   system below. If a slide would be a wall of numbers, redesign it as');
  push('   stat callouts, a chart, a comparison, or an icon-led list.');
  push('3. Every content slide has one assertion title (a finding, with its');
  push('   number) and one supporting line. No label titles like "Audiences".');
  push('4. Connect the point of view to specific settings and structure. The');
  push('   reader should always see WHY a finding matters through our lens.');
  push('5. Treat any settings, campaign, or ad-group screenshots or pasted text');
  push('   the analyst attached to this conversation as the AUTHORITATIVE source.');
  push('   Where they conflict with a value in the rough deck or below, trust the');
  push('   screenshot and correct the number. This is how we fix settings the API');
  push('   cannot read. Pay special attention to ad-group AUDIENCE screenshots:');
  push('   the API often cannot see the exclusion inside a Demand Gen audience');
  push('   signal, so if a screenshot shows the audience and its exclusions (for');
  push('   example excluding past purchasers), use that as truth for slide 9.');
  push('');

  push('## Our point of view. Carry this argument through the whole deck.');
  push('');
  push('The thesis: ' + POV.title + '.');
  push('');
  push(POV.thesis);
  push('');
  push('Principles the reader should leave with:');
  POV.principles.forEach(function(p) { push('- ' + p); });
  push('');
  push('Judge and present performance on the signals a purchase-only lens misses:');
  POV.metrics.forEach(function(m) { push('- ' + m); });
  push('');
  push('Frame expectations plainly: ' + POV.expectation);
  push('');
  push("## Lockhern brand system");
  push('');
  push("Use only these colors:");
  push('- Primary blue ' + BRAND.primary + ': headlines, key figures, the single accent that marks what matters.');
  push('- Secondary blue ' + BRAND.secondary + ': secondary chart series.');
  push('- Tertiary navy ' + BRAND.tertiary + ': the title and closing backgrounds, deep fills.');
  push('- Ink ' + BRAND.ink + ': body text. Dark gray ' + BRAND.grayDark + ': captions.');
  push('- Mid gray ' + BRAND.grayMid + ': rules and gridlines. Light gray ' + BRAND.grayLight + ': card fills and table banding. White ' + BRAND.white + '.');
  push('- Status accents only where needed: green ' + '#1B7F5A' + ' aligned, amber ' + '#C98A1B' + ' worth a look, red ' + '#C24B3C' + ' fix.');
  push('');
  push('Type: ' + BRAND.titleFont + ' for titles and display, ' + BRAND.bodyFont + ' for body and figures. If unavailable, substitute a clean serif for titles and a humanist sans for body. Never a default font.');
  push('');
  push('Logo: the Lockhern logo on the title and closing slides, white version on the navy background, and a small mark in a consistent corner of content slides. Logo files are attached. Embed them, do not redraw the logo.');
  push('');
  push("## Design system. This is where the last version fell short. Follow it.");
  push('');
  push("- Pick one motif and repeat it: a small filled circle holding a number or a simple line icon, beside every section title. Carry it across every slide.");
  push("- One navy title slide and one navy closing slide bookend light content slides.");
  push("- Give numbers hierarchy. The one or two figures that carry a slide are large, 40 to 72 point. Everything else is small and quiet.");
  push("- Use big stat callouts (a large number with a short label beneath) instead of sentences for key metrics.");
  push("- For settings and account health, use a status treatment: a green, amber, or red dot or check beside each item. Not a full grid of colored cells.");
  push("- Turn any ranking into a horizontal bar so the shape reads at a glance. Keep a table only when the reader must look up a specific value.");
  push("- Charts are native PowerPoint charts with a quiet frame and brand colors. Never paste a screenshot of a chart.");
  push("- Keep a slide title and its supporting line close together, about 0.1 inch apart, so they read as one unit. Do not leave a large gap between them.");
  push("- Simple line icons in a brand-blue circle beside section headers. No stock photos, no clip art, no decorative shapes that carry no information.");
  push("- Canvas 13.3 by 7.5 inches. Left align body copy. Center only the title slide.");
  push('');
  push("## The narrative. Build these slides, in this order.");
  push('');
  push("Adapt the exact count to the content, but keep this spine and these four buckets: settings, structure, video performance, video and content strategy, all tied to the point of view.");
  push('');
  push('1. TITLE. Navy, white logo, account name, window, and the line: ' + POV.title + '.');
  push("2. HOW WE JUDGE DEMAND GEN. A visual one-slide framework of our lens. Three pillars, each an icon in a blue circle with a short bold claim and one supporting line: The channel (Demand Gen buys attention on YouTube, a social and creative environment, judge it like social not search), The levers (creative and landing pages move this channel, a standard product page is usually not enough), The signal (we grade attention and mid funnel signal, not last click alone). Then a compact strip of the exact signals we grade on: video completion at 25, 50, 75, 100 percent, view-through, attributed brand search, brand lift, and cost per micro conversion. This slide must feel like a point of view. Do not render it as three columns of body text, which is how the last version failed.");
  push("3. EXECUTIVE SUMMARY. Three findings that matter for THIS account, as large stat callouts, chosen from the findings list below. Do NOT lead with the percent of conversions outside the bidding column, and do NOT use the percent of ads that got an impression: most campaigns were intentionally paused this window, so that number is meaningless. The real headlines here are that creative is unmeasurable because one ad carries every video, that view-through carries most of the attributed action, and the single settings or structure point that matters most.");
  push("4. SETTINGS: WHAT IS ALIGNED, WHAT TO FIX. A core bucket. Show only high-signal settings, each marked aligned, worth a look, or fix, and tie each to the point of view. Prioritize: conversion goals (which actions the campaign optimizes toward, and whether Add to Cart and Begin Checkout are among them), the AI asset enhancements (which are on or off, and which we would change and why), new versus existing customer bidding and whether the existing-customer list is excluded from prospecting, and view-through conversion optimization. Do not show any setting you cannot confirm. If the analyst attached settings screenshots, they are the source of truth here.");
  push("5. CAMPAIGN STRUCTURE. Frame it correctly. Campaigns paused in this window are intentional and seasonal, not broken, so never call a paused campaign a failure or imply the account is mostly dead. The real structural finding is creative packing: one ad carries several videos, so Google reports a single blended completion rate and no individual video can be measured. Make that the headline. Show live versus paused simply, as context, not as the story.");
  push("6. VIDEO PERFORMANCE. The one-page creative scorecard, a thumbnail per creative, all on one slide. Columns: source, impressions, cost, view rate, the 25 / 50 / 75 / 100 completion funnel, conversions, view-through, cost per conversion, and cost per conversion including view-through. Keep the title and subline close. Add one takeaway line: which creative is most efficient and which holds attention. Where watch depth is blank, add a small footnote saying it is blended because the videos share one ad.");
  push("7. VIDEO AND CONTENT STRATEGY. Our creative recommendations through the lens, specific to what the scorecard shows: split every ad to one video each to recover per-creative measurement, seed audiences from watch behavior and top organic and Meta content, and review the AI shortened and enhanced cuts against the originals. Make it concrete and prioritized, not generic.");
  push("8. LANDING PAGE AND CONVERSION PATH. A core bucket, and it was missing before. Show where the ads actually drive (the destination URLs are listed in the data below, with the spend behind each). Open and review those pages if you can. Then recommend, specifically for THIS client's business (read the destination pages and the account name to understand what they sell), what a better Demand Gen landing experience would be: Demand Gen buys cold attention, so a standard product page is usually the wrong destination. Recommend a purpose-built page, and state plainly which KPI we should test as the primary conversion for this audience: a quiz, an email or SMS capture, or a direct order. Tie the choice to the funnel stage this traffic is at. Make it a real recommendation, not a platitude.");
  push("9. AUDIENCE STRATEGY, INCLUSIONS AND EXCLUSIONS. Who each ad group targets, and just as important, who it excludes. Call out clearly whether existing customers (past purchasers) are excluded from prospecting: excluding them is correct and worth crediting; failing to exclude them wastes prospecting budget on people who already buy. Use the ad-group audience data below and any audience screenshots the analyst attached as the source of truth, since the API cannot always read the exclusion inside a Demand Gen audience signal. Pair this with the age and gender skew as a visual talking-point slide, not four tables.");
  push("10. CHANNEL AND SURFACE EFFICIENCY. A donut or bar of spend by surface plus efficiency. Drop any surface under about one percent of spend rather than cluttering the slide with it. State the takeaway plainly: where the money goes and where it is most and least efficient, comparing view rate against cost per action. If a surface shows a zero percent view rate, add a small caveat that view rate is not measured for that surface. Do not present zero percent as a real result.");
  push("11. THE ONE THING. Navy closing slide. The single highest-leverage action stated plainly with why it matters, then a short list of the next moves.");
  push('');
  push("Do not include a daily pacing slide, and do not include a separate methodology-notes slide. Fold only the two caveats that matter into small footnotes where they apply: view-through sits outside cost per action and ROAS, and watch depth is blended because the videos share an ad.");
  push('');
  if ((data.readout || {}).conversions) {
    push('## Findings you may use for the executive summary and titles');
    push('');
    data.readout.conversions.forEach(function(line) { push('- ' + plainText_(line)); });
    push('');
  }
  var noteKeys = Object.keys(notes || {}).filter(function(k) { return String(notes[k] || '').trim(); });
  if (noteKeys.length) {
    push('## Analyst direction. Emphasize these; they override generic emphasis.');
    push('');
    noteKeys.forEach(function(k) { push('- ' + k + ': ' + String(notes[k]).trim()); });
    push('');
  }
  if (groundTruth) {
    push('## Analyst-provided settings, authoritative');
    push('');
    push('The analyst pasted the real settings below from Google Ads. Trust these over any API-derived value, and over the rough deck, wherever they conflict.');
    push('');
    push(groundTruth);
    push('');
  }
  push('## Authoritative data. Use these exact numbers.');
  push('');
  push('The analyst may also attach the full data spreadsheet (.xlsx) exported');
  push('from this audit. If present, treat it as the complete, authoritative');
  push('dataset: use it to verify any figure here and to reach detail this');
  push('summary trims, for example the full audience or conversion-action list,');
  push('every ad group, or the full daily series. Never paste raw spreadsheet');
  push('rows onto a slide. Pull only the specific number or short ranking a slide');
  push('needs, and keep the deck visual.');
  push('');
  push('Totals this window:');
  push('- Spend ' + money0(t.cost) + ' (' + dlt('cost') + ' vs prior).');
  push('- Conversions ' + (Number(t.conversions) || 0).toFixed(0) + ' (' + dlt('conversions') + '), cost per conversion ' + money0(t.cpa) + '.');
  push('- View-through conversions ' + Math.round(t.viewThrough || 0) + ', which is ' + pct0(t.vtcShare) + ' of total attributed action.');
  push('- Cost per conversion including view-through ' + money0(t.cpaVtc) + '.');
  push('- Impressions ' + Math.round(t.impressions || 0).toLocaleString() + ' (' + dlt('impressions') + '), clicks ' + Math.round(t.clicks || 0).toLocaleString() + ' (' + dlt('clicks') + '), CTR ' + pct1(t.ctr) + '.');
  push('');
  var pk = data.creativePacking || {};
  push('Structure: ' + (data.campaigns || []).length + ' campaigns, ' + (data.adGroups || []).length + ' ad groups, ' + (data.ads || []).length + ' ads delivered in this window. Creative packing: ' + (pk.multiVideoAds || 0) + ' ad(s) carry more than one video, up to ' + (pk.maxVideosInOneAd || 0) + ' in one ad, so ' + (pk.videosAffected || 0) + ' video(s) have no individual completion rate.');
  push('');
  if ((data.settings || {}).campaigns && data.settings.campaigns.length) {
    push('Settings per campaign the API returned (paused campaigns are intentional):');
    data.settings.campaigns.slice(0, 6).forEach(function(c) {
      push('- ' + c.name + ' [' + c.status + ']: conversion goals ' + ((c.goals || []).join(', ') || 'account default') + '; bidding ' + (c.bidding || '') + (c.target ? ' ' + c.target : '') + '; new vs existing ' + (c.acquisition || '') + '; excluded audiences ' + ((c.excludedAudiences || []).join(', ') || 'none') + '.');
      var ai = (c.automation || []).filter(function(x) { return x.verified; }).map(function(x) { return x.name + '=' + (x.on ? 'on' : 'off'); });
      if (ai.length) push('  AI enhancements confirmed by API: ' + ai.join(', ') + '.');
      var ver = CAMPAIGN_REVIEW_FIELDS.map(function(f) { var v = overrides[c.id + '|' + f[0]]; return v ? (f[1] + '=' + v) : null; }).filter(function(x) { return x; });
      if (ver.length) push('  Analyst-verified: ' + ver.join('; ') + '.');
    });
    push('');
  }
  if ((data.surfaceMix || []).length) {
    push('Surface split (surface, spend, share, conversions, cost per action, view rate):');
    var stot = data.surfaceMix.reduce(function(s, r) { return s + (r.cost || 0); }, 0);
    data.surfaceMix.forEach(function(r) {
      push('- ' + r.surface + ': ' + money0(r.cost) + ', ' + pct0(stot ? r.cost / stot : 0) + ' of spend, ' + (Number(r.conversions) || 0).toFixed(0) + ' conv, ' + (r.conversions ? money0(r.cpa) : 'n/a') + ' CPA, ' + pct1(r.viewRate) + ' view rate.');
    });
    push('');
  }
  if ((data.landingPages || []).length) {
    push('Landing pages, where the ads drive (destination, spend, conversions, cost per conversion, ads pointing there). Review these pages for slide 8:');
    data.landingPages.slice(0, 12).forEach(function(lp) {
      push('- ' + lp.url + ' : ' + money0(lp.spend) + ' spend, ' + (Number(lp.conversions) || 0).toFixed(0) + ' conv, ' + (lp.conversions ? money0(lp.cpa) : 'n/a') + ' CPA, ' + lp.ads + ' ad(s).');
    });
    push('');
  }
  if ((data.adGroupSettings || []).length) {
    push('Ad-group audience targeting and exclusions (API view; a screenshot may show more inside a Demand Gen signal). "excludes" is who is kept out, which is the important prospecting signal:');
    data.adGroupSettings.slice(0, 12).forEach(function(ag) {
      push('- ' + ag.adGroup + ' [' + (ag.status || '') + ']: lists targeted ' + ((ag.audiences || []).join(', ') || 'none read') + '; excludes ' + ((ag.excludedAudiences || []).join(', ') || 'none read') + '.');
    });
    push('');
  }
  var vids = (data.videos || []).slice(0, DECK.CREATIVE_ROWS_PER_PAGE * 3);
  if (vids.length) {
    push('Creative appendix, highest spend first. thumb is the poster to embed. src is advertiser or Enhanced by Google AI. q25..q100 are completion shares. cpa_all includes view-through.');
    push('');
    push('| Creative | src | thumb | impr | cost | view_rate | q25 | q50 | q75 | q100 | conv | view_thru | cpa | cpa_all |');
    push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    vids.forEach(function(v) {
      function q(x) { return (v.p25 || v.p50 || v.p75 || v.p100) ? ((Number(v[x]) || 0) * 100).toFixed(0) + '%' : '-'; }
      var tc = (Number(v.conversions) || 0) + (Number(v.viewThrough) || 0);
      push('| ' + [
        String(v.title || '').replace(/\|/g, '/').slice(0, 48),
        videoSource_(v.title) === 'Advertiser' ? 'advertiser' : 'ai',
        v.thumb || '-',
        Math.round(v.impressions || 0),
        (Number(v.cost) || 0).toFixed(0),
        ((Number(v.viewRate) || 0) * 100).toFixed(1) + '%',
        q('p25'), q('p50'), q('p75'), q('p100'),
        (Number(v.conversions) || 0).toFixed(1),
        Math.round(v.viewThrough || 0),
        v.conversions ? (Number(v.cost) / v.conversions).toFixed(0) : '-',
        tc ? (Number(v.cost) / tc).toFixed(0) : '-'
      ].join(' | ') + ' |');
    });
    push('');
  }
  push('## Constraints');
  push('');
  push("- Never change a number, label, or date, unless a settings screenshot the analyst attached corrects it. If a figure looks wrong and you have no screenshot, flag it in your reply rather than editing the slide.");
  push("- Keep the two caveats above as small footnotes where they apply.");
  push("- Build with pptxgenjs at LAYOUT_WIDE, or python-pptx. Return a new .pptx and run the pptx validator, fixing whatever it flags.");
  push("- Final check before returning: search the whole deck for an em dash or en dash and remove every one.");
  push('');
  push("Before you build, tell me in three sentences the three executive-summary findings you chose and the design direction you will take. Then build it.");

  return lines.join('\n');
}

/** Exposed for the dashboard's copy button. */
function getDeckPrompt() {
  var accounts = cachedAccounts_();
  if (!accounts.length) return '';
  var raw = readPayload_(accounts[0].id);
  return raw ? buildDeckPrompt_(JSON.parse(raw)) : '';
}

/**
 * The client-deck storyboard: the ordered slides the branded deck will contain,
 * as lightweight cards the dashboard can render BEFORE any .pptx exists. Each
 * card carries a stable `key` (which is also the note key wired through to the
 * deck and the deck prompt), a title, a `kind` the UI switches on to draw a
 * data preview, and a one-line `summary` of what the slide will say.
 *
 * Keys are aligned with DECK.SECTIONS where a section exists, so a note written
 * on a storyboard card lands on the matching deck slide via commentary().
 */
function buildStoryboard_(data) {
  var t = data.totals || {};
  var cur = (data.account || {}).currency || '';
  function money(v) {
    return cur + ' ' + (Number(v) || 0).toLocaleString(undefined,
        { maximumFractionDigits: 0 });
  }
  function pct(v) { return ((Number(v) || 0) * 100).toFixed(1) + '%'; }
  function count(arr) { return (arr || []).length; }

  var videos = data.videos || [];
  var aiCount = videos.filter(function(v) {
    return (v.source || videoSource_(v.title)) !== 'Advertiser';
  }).length;
  var findings = ((data.readout || {}).conversions || []).map(plainText_);
  var conv = data.conversionActions || [];
  var gap = Number(t.convGap || 0);

  var cards = [
    { key: 'title', kind: 'title', title: 'Title',
      summary: (data.account || {}).name + ' · ' + (data.account || {}).start +
               ' to ' + (data.account || {}).end + '. Framed as "' + POV.title + '".' },
    { key: 'summary', kind: 'summary', title: 'Executive summary',
      summary: findings.length
          ? findings.slice(0, 3).join('  |  ')
          : 'Three or four one-line findings, each carrying its number.' },
    { key: 'pov', kind: 'pov', title: 'How we judge Demand Gen',
      summary: 'The lens: social not search; creative + landing pages are the ' +
               'levers; judged on attention and mid-funnel signal.' },
    { key: 'headline', kind: 'headline', title: 'Headline numbers',
      summary: 'Spend ' + money(t.cost) + ' · ' +
               (Number(t.conversions) || 0).toFixed(1) + ' conv · CPA ' +
               (t.cpa ? money(t.cpa) : '—') + ' · view rate ' + pct(t.viewRate) +
               '. This period vs prior.' },
    { key: 'structure', kind: 'structure', title: 'What is actually delivering',
      summary: count(data.campaigns) + ' campaigns, ' + count(data.adGroups) +
               ' ad groups, ' + count(data.ads) + ' ads — exist vs deliver.' },
    { key: 'creative', kind: 'creative', title: 'Creative scorecard (one page)',
      summary: videos.length + ' creatives on one page' +
               (aiCount ? ', ' + aiCount + ' AI-modified (Enhanced by Google AI)' : '') +
               '. Source, view rate, the 25–100% funnel, conversions, view-through.' },
    { key: 'channels', kind: 'channels', title: 'Where the budget went',
      summary: count(data.channelMix) + ' channels' +
               ((data.channelMix || [])[0]
                 ? ' · top: ' + data.channelMix[0].channel : '') + '.' },
    { key: 'surfaces', kind: 'surfaces', title: 'Which ad formats',
      summary: count(data.surfaceMix) + ' ad-format surfaces' +
               ((data.surfaceMix || [])[0]
                 ? ' · top: ' + data.surfaceMix[0].surface : '') + '.' },
    { key: 'conversions', kind: 'conversions', title: 'What counted as a conversion',
      summary: count(conv) + ' conversion actions. ' +
               (gap ? 'All-conv minus bidding-column gap: ' + gap.toFixed(1) +
                      ' actions the algorithm is blind to.'
                    : 'Check whether ATC/Begin Checkout are Primary.') },
    { key: 'settings', kind: 'settings', title: 'How the campaigns are configured',
      summary: (data.settings && count(data.settings.campaigns)) +
               ' campaigns: bidding, budgets, new-vs-existing, asset automation.' },
    { key: 'audiences', kind: 'audiences', title: 'Audiences',
      summary: count(data.audiences) + ' audience attachments.' },
    { key: 'demographics', kind: 'demographics', title: 'Demographics',
      summary: count(data.demographics) + ' age/gender rows.' },
    { key: 'daily', kind: 'daily', title: 'Spend over time',
      summary: count(data.daily) + ' days of spend trend.' },
    { key: 'caveats', kind: 'caveats', title: 'How to read these numbers',
      summary: 'The caveats — inferred watch depth, view-through handling, ' +
               'what the data does not cover. Kept in full.' },
    { key: 'closing', kind: 'closing', title: 'Closing',
      summary: 'The single recommendation that matters most, on brand navy.' }
  ];
  return cards;
}

/**
 * Save one storyboard/slide note from the dashboard. `key` is the slide key,
 * `text` the analyst's emphasis. Upserts a row in the Commentary tab (creating
 * it if needed), so the note flows into both the exported deck and the deck
 * prompt. Returns 'ok' or a short status string.
 */
function saveNote(key, text) {
  key = String(key || '').trim();
  if (!key) return 'no-key';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return 'no-spreadsheet';

  var sheet = ss.getSheetByName(COMMENTARY_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(COMMENTARY_SHEET);
    sheet.getRange(1, 1, 1, 2).setValues([['Slide key', 'Commentary']])
        .setFontWeight('bold').setBackground(BRAND.tertiary)
        .setFontColor(BRAND.white);
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 340);
    sheet.setColumnWidth(2, 760);
  }

  var value = String(text || '').substring(0, 4000);
  var lastRow = sheet.getLastRow();
  var found = 0;
  if (lastRow > 1) {
    var keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]).trim().toLowerCase() === key.toLowerCase()) {
        found = i + 2;
        break;
      }
    }
  }
  if (found) {
    sheet.getRange(found, 2).setValue(value);
  } else {
    sheet.appendRow([key, value]);
  }
  return 'ok';
}

/**
 * Manual setting overrides, keyed by "<campaignId>|<field>" (asset toggles use
 * "<campaignId>|asset|<TYPE>"). This is how the auditor records the truth for
 * settings the API cannot confirm — view-through optimisation, product feeds,
 * device targeting, and any toggle Google does not report. Overrides win over
 * the API value everywhere: dashboard, deck and brief. Stored one row per key
 * in a hidden sheet, and injected fresh in doGet so a reload always shows the
 * latest without a full refresh (same pattern as labels).
 */
function saveOverride(key, value) {
  key = String(key || '').trim();
  if (!key) return 'no-key';
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return 'no-spreadsheet';

  var sheet = ss.getSheetByName(OVERRIDES_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(OVERRIDES_SHEET);
    sheet.getRange(1, 1, 1, 2).setValues([['Key', 'Value']])
        .setFontWeight('bold');
    sheet.setFrozenRows(1);
    try { sheet.hideSheet(); } catch (e) {}
  }

  // Field overrides are short; the pasted settings ground-truth blob needs room.
  var value = String(value == null ? '' : value).substring(0, 12000);
  var lastRow = sheet.getLastRow();
  var found = 0;
  if (lastRow > 1) {
    var keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]) === key) { found = i + 2; break; }
    }
  }
  // Empty value clears the override so the API value shows again.
  if (!value) {
    if (found) sheet.getRange(found, 1, 1, 2).clearContent();
    return 'ok';
  }
  if (found) sheet.getRange(found, 2).setValue(value);
  else sheet.appendRow([key, value]);
  return 'ok';
}

function readOverrides_() {
  var out = {};
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss && ss.getSheetByName(OVERRIDES_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return out;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues()
      .forEach(function(row) {
        var key = String(row[0]).trim();
        if (key) out[key] = String(row[1] == null ? '' : row[1]);
      });
  return out;
}

function buildBrief_(data) {
  var a = data.account;
  var t = data.totals;
  var p = data.prior;
  var cur = a.currency;
  var out = [];

  function push(line) { out.push(line === undefined ? '' : String(line)); }
  function n(v, places) { return (Number(v) || 0).toFixed(places === undefined ? 2 : places); }
  function pc(v) { return ((Number(v) || 0) * 100).toFixed(1) + '%'; }
  function delta(key) {
    if (!p || !p[key]) return 'n/a';
    var change = ((t[key] || 0) - p[key]) / p[key];
    return (change >= 0 ? '+' : '') + (change * 100).toFixed(1) + '%';
  }
  function table(headers, rows) {
    push('| ' + headers.join(' | ') + ' |');
    push('|' + headers.map(function() { return '---'; }).join('|') + '|');
    rows.forEach(function(r) { push('| ' + r.join(' | ') + ' |'); });
    push('');
  }
  function capped(rows, limit, label) {
    if (rows.length > limit) {
      return { rows: rows.slice(0, limit),
               note: 'Showing top ' + limit + ' of ' + rows.length + ' ' +
                     label + ' by spend.' };
    }
    return { rows: rows, note: '' };
  }

  push(ANALYSIS_PROMPT);
  push('# Demand Gen audit — ' + a.name + ' (' + a.id + ')');
  push('');
  push('- Window: ' + a.start + ' to ' + a.end +
       (a.priorStart ? ' (prior period ' + a.priorStart + ' to ' + a.priorEnd + ')' : ''));
  push('- Currency: ' + cur + '. All money figures are in this currency.');
  push('- Pulled from the Google Ads API on ' + a.generated + '.');
  push('');

  push('## Read this before interpreting the numbers');
  push('');
  push('- Every rate here is computed from raw counters, not averaged from ' +
       'Google\u2019s reported rates, so grouped figures are arithmetically correct.');
  push('- "Conversions" counts only actions included in the Conversions column ' +
       'that Smart Bidding optimises toward. "All conv." counts every tracked ' +
       'action. Where they differ, the gap is spend the bidding algorithm is ' +
       'blind to.');
  push('- View-through conversions are reported separately and are NOT included ' +
       'in cost per action or ROAS.');
  push('- Watch-depth percentages are the share of impressions reaching each ' +
       'quartile.');
  // Fire when depth is present OR conspicuously absent. Silence on the
  // absent case is worse: a reader assumes the funnel simply was not requested.
  if ((data.videos || []).some(function(v) {
        return v.quartileSource || v.depthNote;
      })) {
    push('- Watch depth is not selectable per video asset in the API. Where a ' +
         'video shows watch depth it came from an ad carrying only that video. ' +
         'Videos sharing an ad with others show no watch depth, because a ' +
         'multi-video ad reports a single blended rate that says nothing about ' +
         'any individual creative. View rate IS measured per video.');
  }
  if ((data.videos || []).some(function(v) { return v.conversionSource === 'ad'; })) {
    push('- Per-video conversion actions were inferred from ads carrying a ' +
         'single video, not measured at asset level.');
  }
  push('- Legacy "Demand Gen video ad" creatives are not exposed by the API. ' +
       'Their spend appears in campaign totals but they have no creative rows, ' +
       'so creative-level totals may not reconcile to campaign totals.');
  push('- Do not infer causation from these tables alone. Flag where a ' +
       'recommendation would need a test rather than an observation.');
  push('');

  if ((data.readout || {}).conversions) {
    push('## What the numbers say');
    push('');
    push('Generated from the figures below; useful as a starting read, not a ' +
         'substitute for your own.');
    push('');
    data.readout.conversions.forEach(function(line) {
      push('- ' + plainText_(line));
    });
    push('');
  }

  push('## Account totals');
  push('');
  table(['Metric', 'Current', 'Prior', 'Change'], [
    ['Spend', n(t.cost), p ? n(p.cost) : 'n/a', delta('cost')],
    ['Impressions', n(t.impressions, 0), p ? n(p.impressions, 0) : 'n/a', delta('impressions')],
    ['Clicks', n(t.clicks, 0), p ? n(p.clicks, 0) : 'n/a', delta('clicks')],
    ['CTR', pc(t.ctr), p ? pc(p.ctr) : 'n/a', delta('ctr')],
    ['Avg CPC', n(t.cpc), p ? n(p.cpc) : 'n/a', delta('cpc')],
    ['Avg CPM', n(t.cpm), p ? n(p.cpm) : 'n/a', delta('cpm')],
    ['Conversions', n(t.conversions), p ? n(p.conversions) : 'n/a', delta('conversions')],
    ['Conv rate', pc(t.cvr), p ? pc(p.cvr) : 'n/a', delta('cvr')],
    ['Cost per conversion', n(t.cpa), p ? n(p.cpa) : 'n/a', delta('cpa')],
    ['Conv value', n(t.convValue), p ? n(p.convValue) : 'n/a', delta('convValue')],
    ['ROAS', n(t.roas) + 'x', p ? n(p.roas) + 'x' : 'n/a', delta('roas')],
    ['All conversions', n(t.allConversions), p ? n(p.allConversions) : 'n/a', delta('allConversions')],
    ['All conv cost per action', n(t.allCpa), p ? n(p.allCpa) : 'n/a', delta('allCpa')],
    ['Actions outside bidding column', n(t.convGap), p ? n(p.convGap) : 'n/a', delta('convGap')],
    ['View-through conversions', n(t.viewThrough, 0), p ? n(p.viewThrough, 0) : 'n/a', delta('viewThrough')],
    ['Video views', n(t.videoViews, 0), p ? n(p.videoViews, 0) : 'n/a', delta('videoViews')],
    ['View rate', pc(t.viewRate), p ? pc(p.viewRate) : 'n/a', delta('viewRate')],
    ['Watched in full', pc(t.p100), p ? pc(p.p100) : 'n/a', delta('p100')]
  ]);

  function perfTable(title, rows, labelHeader, labelFn, limit, label) {
    if (!rows || !rows.length) return;
    var slice = capped(rows, limit, label);
    push('## ' + title);
    push('');
    if (slice.note) { push(slice.note); push(''); }
    table([labelHeader, 'Spend', 'Impr', 'Clicks', 'CTR', 'Conv', 'CPA',
           'All conv', 'All conv CPA', 'View rate', 'Watched full'],
      slice.rows.map(function(r) {
        return [labelFn(r), n(r.cost), n(r.impressions, 0), n(r.clicks, 0),
                pc(r.ctr), n(r.conversions), r.conversions ? n(r.cpa) : '-',
                n(r.allConversions), r.allConversions ? n(r.allCpa) : '-',
                pc(r.viewRate), pc(r.p100)];
      }));
  }

  perfTable('Channels', data.channelMix, 'Channel',
      function(r) { return r.channel; }, 20, 'channels');
  perfTable('Surfaces (ad formats)', data.surfaceMix, 'Surface',
      function(r) { return r.surface; }, 20, 'surfaces');
  perfTable('Screens (devices)', data.deviceMix, 'Device',
      function(r) { return r.device; }, 20, 'devices');
  perfTable('Campaigns', data.campaigns, 'Campaign',
      function(r) { return r.name + ' [' + r.status + ', ' + r.bidding + ']'; },
      25, 'campaigns');
  perfTable('Ad groups', data.adGroups, 'Ad group',
      function(r) { return r.name + ' (' + r.campaign + ')'; }, 25, 'ad groups');
  perfTable('Audiences', data.audiences, 'Audience',
      function(r) { return r.name + ' [' + r.type + ']'; }, 25, 'audiences');

  if ((data.videos || []).length) {
    var vids = capped(data.videos, 25, 'videos');
    push('## Videos');
    push('');
    if (vids.note) { push(vids.note); push(''); }
    table(['Video', 'Google rating', 'Ad groups', 'Spend', 'Impr', 'Conv',
           'CPA', 'All conv', 'View rate', 'Watched full', 'Depth source'],
      vids.rows.map(function(v) {
        return [v.title, v.label || 'Unrated', v.adGroupCount, n(v.cost),
                n(v.impressions, 0), n(v.conversions),
                v.conversions ? n(v.cpa) : '-', n(v.allConversions),
                pc(v.viewRate), pc(v.p100),
                v.quartileSource === 'ad' ? 'from its single-video ad'
                    : (v.depthNote === 'shared-ad'
                        ? 'not available, shares an ad' : 'not available')];
      }));

    push('### Video media links');
    push('');
    push('Watch URLs and thumbnail stills. Thumbnails are the video\u2019s own ' +
         'poster frame, not a screenshot of an arbitrary moment.');
    push('');
    table(['Video', 'Watch', 'Thumbnail'],
      vids.rows.filter(function(v) { return v.videoId; }).map(function(v) {
        return [v.title, v.url,
                'https://i.ytimg.com/vi/' + v.videoId + '/maxresdefault.jpg'];
      }));

    var withActions = data.videos.filter(function(v) {
      return (v.conversionActions || []).length;
    }).slice(0, 15);
    if (withActions.length) {
      push('### Conversion actions per video');
      push('');
      var rows = [];
      withActions.forEach(function(v) {
        v.conversionActions.forEach(function(act) {
          rows.push([v.title, act.action, n(act.allConversions),
                     n(act.allConvValue), n(act.conversions)]);
        });
      });
      table(['Video', 'Action', 'All conv', 'All conv value',
             'In bidding column'], rows);
    }
  }

  if ((data.conversionActions || []).length) {
    var byAction = {};
    data.conversionActions.forEach(function(r) {
      var k = byAction[r.action];
      if (!k) {
        k = byAction[r.action] = { action: r.action, category: r.category,
            allConversions: 0, allConvValue: 0, conversions: 0, campaigns: {} };
      }
      k.allConversions += r.allConversions;
      k.allConvValue += r.allConvValue;
      k.conversions += r.conversions;
      k.campaigns[r.campaign] = true;
    });
    push('## Conversion actions');
    push('');
    push('"In bidding column" of 0 means the action is tracked but excluded ' +
         'from the Conversions column, so bidding does not optimise toward it.');
    push('');
    table(['Action', 'Category', 'All conv', 'All conv value',
           'In bidding column', 'Campaigns'],
      Object.keys(byAction).map(function(k) { return byAction[k]; })
        .sort(function(x, y) { return y.allConversions - x.allConversions; })
        .map(function(r) {
          return [r.action, r.category || '-', n(r.allConversions),
                  n(r.allConvValue), n(r.conversions),
                  Object.keys(r.campaigns).length];
        }));
  }

  if ((data.daily || []).length) {
    push('## Daily spend and conversions');
    push('');
    table(['Date', 'Spend', 'Clicks', 'Conv'],
      data.daily.map(function(d) {
        return [d.date, n(d.cost), n(d.clicks, 0), n(d.conversions)];
      }));
  }

  var counts = data.counts || {};
  if (Object.keys(counts).length) {
    push('## Structure: what exists vs what delivered');
    push('');
    push('Entities with no impressions in this window are excluded from the ' +
         'tables above but counted here.');
    push('');
    table(['Entity', 'Exists', 'Delivering', 'Dormant'],
      [['campaigns', 'Campaigns'], ['adGroups', 'Ad groups'], ['ads', 'Ads'],
       ['audiences', 'Audiences']].filter(function(pair) {
        return counts[pair[0]];
      }).map(function(pair) {
        var c = counts[pair[0]];
        return [pair[1], c.total, c.active, c.total - c.active];
      }));
  }

  var settings = data.settings;
  if (settings && (settings.campaigns || []).length) {
    push('## Campaign settings');
    push('');
    push('Configuration, not performance. Read the results above against these.');
    push('');
    table(['Campaign', 'Status', 'Bidding', 'Target', 'Daily budget',
           'Delivery', 'New vs existing customers'],
      settings.campaigns.map(function(c) {
        return [c.name, c.status, c.bidding, c.target || '-', n(c.budget),
                c.budgetDelivery || '-', c.acquisition];
      }));

    push('### Asset optimisation toggles');
    push('');
    push('These control how far Google can stretch existing creative across ' +
         'placements. "Shorter videos" and "Resized videos" are the two in the ' +
         'Asset optimization panel.');
    push('');
    var automationRows = [];
    settings.campaigns.forEach(function(c) {
      (c.automation || []).forEach(function(a) {
        automationRows.push([c.name, a.name, a.on ? 'ON' : 'OFF']);
      });
    });
    if (automationRows.length) {
      table(['Campaign', 'Setting', 'State'], automationRows);
    } else {
      push('No asset automation settings returned for these campaigns.');
      push('');
    }

    push('### Targeting and schedule');
    push('');
    table(['Campaign', 'Locations', 'Excluded locations', 'Languages',
           'Ad schedule', 'Excluded audiences'],
      settings.campaigns.map(function(c) {
        var schedule = (c.schedule || []).length
            ? c.schedule.map(function(s) {
                return s.day.slice(0, 3) + ' ' + s.start + '-' + s.end;
              }).join('; ')
            : 'All day, every day';
        return [c.name,
                (c.locations || []).join('; ') || 'All locations',
                (c.excludedLocations || []).join('; ') || 'None',
                (c.languages || []).join('; ') || 'All',
                schedule,
                (c.excludedAudiences || []).join('; ') || 'None'];
      }));

    push('### Conversion goals the campaign bids toward');
    push('');
    table(['Campaign', 'Biddable goal categories'],
      settings.campaigns.map(function(c) {
        return [c.name, (c.goals || []).join(', ') || 'Account default'];
      }));

    // Manually verified settings the API cannot confirm (analyst overrides).
    var ovr = {};
    try { ovr = readOverrides_(); } catch (e) { ovr = {}; }
    var reviewRows = [];
    settings.campaigns.forEach(function(c) {
      CAMPAIGN_REVIEW_FIELDS.forEach(function(f) {
        var v = ovr[c.id + '|' + f[0]];
        if (v) reviewRows.push([c.name, f[1], v]);
      });
      (c.automation || []).forEach(function(a) {
        var o = ovr[c.id + '|asset|' + a.type];
        if (o) reviewRows.push([c.name, a.name + ' (asset optimisation)',
            o.toUpperCase()]);
      });
    });
    push('### Manually verified settings (analyst-recorded; API could not confirm)');
    push('');
    if (reviewRows.length) {
      table(['Campaign', 'Setting', 'Value'], reviewRows);
    } else {
      push('Several campaign settings are not exposed by the Google Ads API — ' +
           'view-through conversion optimization, product feeds, device ' +
           'targeting, Google Display Network, third-party measurement, IP ' +
           'exclusions, URL options and brand guidelines. None were manually ' +
           'verified for this run, so treat them as unknown, not default.');
      push('');
    }
  }

  if ((data.adGroupSettings || []).length) {
    push('## Ad group settings');
    push('');
    push('Demand Gen frequently sets location, language and audience targeting ' +
         'at the ad group, so campaign-level targeting can read "All" while the ' +
         'real targeting lives here.');
    push('');
    table(['Ad group', 'Campaign', 'Status', 'Locations', 'Languages',
           'Audience lists', 'Excluded audiences'],
      data.adGroupSettings.map(function(ag) {
        return [ag.adGroup, ag.campaign, ag.status || '',
                (ag.locations || []).join('; ') || 'All',
                (ag.languages || []).join('; ') || 'All',
                (ag.audiences || []).join('; ') || 'None',
                (ag.excludedAudiences || []).join('; ') || 'None'];
      }));
    push('Note: the API often cannot read the exclusion inside a Demand Gen ' +
         'audience signal. Whether existing customers (past purchasers) are ' +
         'excluded is a key prospecting signal and may need an ad-group ' +
         'audience screenshot to confirm.');
    push('');
  }

  if ((data.landingPages || []).length) {
    push('## Landing pages (where the ads drive)');
    push('');
    push('Demand Gen buys cold attention, so the destination matters. A standard ' +
         'product page is usually the wrong landing experience. Assess whether ' +
         'these are purpose-built and what primary KPI (quiz, email/SMS capture, ' +
         'or direct order) the page should test.');
    push('');
    table(['Destination', 'Spend', 'Conversions', 'Cost per conv', 'Ads'],
      data.landingPages.slice(0, 15).map(function(lp) {
        return [lp.url, n(lp.spend, 0), n(lp.conversions, 0),
                lp.conversions ? n(lp.cpa, 2) : 'n/a', String(lp.ads)];
      }));
  }

  if ((settings || {}).conversionActions && settings.conversionActions.length) {
    push('### Conversion action setup');
    push('');
    push('"In column" means the action feeds the Conversions column that ' +
         'bidding optimises toward. A view-through window of 0 means ' +
         'impression-driven response is never credited for that action.');
    push('');
    table(['Action', 'Category', 'In column', 'View-through days',
           'Click-through days', 'Counting'],
      settings.conversionActions.map(function(a) {
        return [a.name, a.category, a.inColumn ? 'yes' : 'no',
                a.viewThroughDays, a.clickThroughDays, a.counting];
      }));
  }

  var packing = data.creativePacking;
  if (packing && packing.multiVideoAds) {
    push('## Creative packing');
    push('');
    push('- **' + packing.multiVideoAds + '** ad(s) contain more than one ' +
         'video, up to ' + packing.maxVideosInOneAd + ' in a single ad.');
    push('- **' + packing.videosAffected + '** video(s) therefore have no ' +
         'individual watch depth, completion rate, or isolated performance ' +
         'signal. Google reports one blended figure per ad.');
    push('- **' + packing.singleVideoAds + '** ad(s) carry exactly one video ' +
         'and are fully measurable.');
    push('- This is a structural reporting limitation, not a data gap in this ' +
         'export. Treat "split each video into its own ad" as a measurement ' +
         'recommendation, and say what it would unlock.');
    push('');
  }

  push('## Data completeness');
  push('');
  push('Anything the API refused, or that had to be inferred, is listed here. ' +
       'Weigh conclusions accordingly.');
  push('');
  var notable = (data.runLog || []).filter(function(entry) {
    return /rejected|Removed to recover|SKIPPED|Estimated|Recovered|inferred|level\./i
        .test(String(entry[1]));
  });
  if (notable.length) {
    notable.forEach(function(entry) {
      push('- ' + entry[0] + ': ' + String(entry[1]).slice(0, 300));
    });
  } else {
    push('- Every requested field returned successfully.');
  }
  push('');

  push('## Not present in this data');
  push('');
  push('- Audience retention curves, co-viewed impressions and persona ' +
       'insights are Google Ads UI only and are not in the API.');
  push('- Search terms, placements and brand-safety detail are not included ' +
       'unless a Placements section appears above.');
  push('- No cross-channel or offline data. Conclusions are limited to what ' +
       'Google Ads observed for Demand Gen in this window.');
  push('');

  push('---');
  push('');
  push('Suggested use: identify what is working and what is not, quantify each ' +
       'claim with figures from the tables above, separate observations from ' +
       'hypotheses, and state which recommendations need a test to validate. ' +
       'Where a caveat above undermines a conclusion, say so rather than ' +
       'working around it.');

  return out.join('\n');
}

// ===========================================================================
// SLIDE DECK
// ===========================================================================

/**
 * Deck configuration. Everything cosmetic lives here so restyling is a config
 * change rather than a rewrite.
 */
var DECK = {
  VIDEOS: 8,
  ROWS_PER_TABLE: 8,
  // Slides API calls are round trips. Non-essential sections stop being added
  // past this point so the deck finishes instead of dying mid-build.
  TIME_BUDGET_SECONDS: 200,
  // Turn any section off without touching the builder.
  // Thumbnails on the one-page creative grid before it spills to another page.
  // 4 columns x 2 rows fits legibly on a 10in slide.
  CREATIVE_COLS: 4,
  CREATIVE_ROWS_PER_PAGE: 8,
  // One comprehensive settings slide per campaign, up to this many.
  SETTINGS_CAMPAIGNS: 6,
  SECTIONS: {
    headline: true, structure: true, settings: true, packing: true,
    channels: true, surfaces: true,
    conversions: true, campaigns: true, adGroups: true, audiences: true,
    demographics: true, assets: true, daily: true,
    // creative = the single one-page scorecard. creativeDetail = the optional
    // per-video appendix (one slide each), off by default so the client deck
    // stays tight. Flip it on for an internal deep-dive.
    creative: true, creativeDetail: false, adGroupSettings: true,
    landingPages: true
  },
  THEME: {
    ink: BRAND.ink,
    muted: BRAND.grayDark,
    rule: BRAND.grayLight,
    accent: BRAND.primary,
    deep: BRAND.tertiary,
    good: '#1B7F5A',
    bad: '#C24B3C',
    band: BRAND.grayLight,
    titleFont: BRAND.titleFont,
    bodyFont: BRAND.bodyFont
  }
};

var COMMENTARY_SHEET = 'Commentary';
var CHART_SHEET = '_charts';
var PROGRESS_KEY = 'DECK_PROGRESS';

/**
 * Builds a Google Slides deck from the cached pull.
 *
 * Slides fetches images server-side, so a public i.ytimg.com URL becomes a real
 * picture in the deck without anything downloading the file first. Charts come
 * from a hidden sheet via insertSheetsChart, which renders far better than a
 * table of the same numbers.
 *
 * Commentary is read from a "Commentary" tab keyed by slide, so an analysis
 * written elsewhere lands on the right slide without hand-assembly.
 */
/** Records deck progress so the dashboard can poll it during a build. */
function setProgress_(done, total, label) {
  try {
    PropertiesService.getScriptProperties().setProperty(PROGRESS_KEY,
        JSON.stringify({ done: done, total: total, label: label,
                         at: new Date().getTime() }));
  } catch (e) {
    // Progress is cosmetic; never let it break a build.
  }
}

/** Polled by the dashboard while a deck builds. */
function deckProgress() {
  try {
    var raw = PropertiesService.getScriptProperties().getProperty(PROGRESS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/** Called from the dashboard button. Returns a link, not just a log line. */
function buildDeckForWeb() {
  setProgress_(0, 1, 'Starting');
  try {
    var urls = buildDeck();
    // Complete at the running total, not 1 of 1, so the bar never jumps back.
    var state = deckProgress() || { total: 1 };
    setProgress_(state.total || 1, state.total || 1, 'Done');
    return { ok: true, urls: urls };
  } catch (e) {
    var current = deckProgress() || { total: 1 };
    setProgress_(current.total || 1, current.total || 1, 'Failed');
    return { ok: false, error: String(e.message || e).slice(0, 300) };
  }
}

/**
 * Export the whole bound spreadsheet as a real .xlsx and hand the bytes to the
 * dashboard as base64, so "Download data" is one click. Uses the docs export
 * endpoint with the script's OAuth token (drive.readonly scope), which avoids
 * having to enable the Drive Advanced Service.
 */
function exportXlsx() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return { ok: false, error: 'No bound spreadsheet.' };
  try {
    var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() +
        '/export?format=xlsx';
    var resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) {
      return { ok: false, error: 'Export failed (' + resp.getResponseCode() +
          '). Re-run installTrigger to grant Drive access.' };
    }
    var name = (ss.getName() || 'Demand Gen audit').replace(/[\\/:*?"<>|]/g, ' ') +
        '.xlsx';
    return { ok: true, name: name,
             b64: Utilities.base64Encode(resp.getBlob().getBytes()) };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 200) };
  }
}

function buildDeck() {
  loadSettings_();
  var accounts = cachedAccounts_();
  if (!accounts.length) throw new Error('No cached data. Run refresh first.');

  var urls = [];
  accounts.forEach(function(account) {
    var raw = readPayload_(account.id);
    if (!raw) return;
    urls.push(deckForAccount_(JSON.parse(raw)));
  });

  var message = urls.length ? 'Deck ready:\n' + urls.join('\n')
                            : 'No cached payloads found. Run refresh first.';
  Logger.log(message);
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    // No UI when run from the editor or a trigger.
  }
  return urls;
}

function readCommentary_() {
  var notes = {};
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss && ss.getSheetByName(COMMENTARY_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return notes;

  sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues()
      .forEach(function(row) {
        var key = String(row[0]).trim();
        if (key) notes[key.toLowerCase()] = String(row[1] || '');
      });
  return notes;
}

/** Creates the Commentary tab with every slide key already filled in. */
function setupCommentary() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Open this from the bound spreadsheet.');

  var sheet = ss.getSheetByName(COMMENTARY_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(COMMENTARY_SHEET);
    sheet.getRange(1, 1, 1, 2).setValues([['Slide key', 'Commentary']])
        .setFontWeight('bold').setBackground('#23262F').setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 340);
    sheet.setColumnWidth(2, 760);
  }

  var existing = {};
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues()
        .forEach(function(r) { existing[String(r[0]).trim().toLowerCase()] = true; });
  }

  var keys = Object.keys(DECK.SECTIONS);
  cachedAccounts_().forEach(function(account) {
    var raw = readPayload_(account.id);
    if (!raw) return;
    (JSON.parse(raw).videos || []).slice(0, DECK.VIDEOS).forEach(function(v) {
      keys.push(v.title);
    });
  });

  keys.forEach(function(key) {
    if (!existing[key.toLowerCase()]) sheet.appendRow([key, '']);
  });

  Logger.log('Commentary tab ready. Fill column B, then run buildDeck.');
  return 'ok';
}

function deckForAccount_(data) {
  var notes = readCommentary_();
  var overrides = {};
  try { overrides = readOverrides_(); } catch (e) { overrides = {}; }
  function ovr_(key) { return overrides[key] || ''; }
  var account = data.account;
  var T = DECK.THEME;
  var W = 720, H = 405, M = 44;

  var deck = SlidesApp.create('Demand Gen audit — ' + account.name + ' — ' +
      account.start + ' to ' + account.end);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var chartsMade = [];

  function fmtMoney(v) {
    return (Number(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  function dec(v) { return (Number(v) || 0).toFixed(2); }
  function pct(v) { return ((Number(v) || 0) * 100).toFixed(1) + '%'; }
  function int(v) { return Math.round(Number(v) || 0).toLocaleString(); }

  function box(slide, text, left, top, width, height, size, bold, color, font) {
    var shape = slide.insertTextBox(String(text), left, top, width, height);
    var style = shape.getText().getTextStyle();
    style.setFontSize(size).setBold(!!bold).setForegroundColor(color || T.ink);
    try {
      style.setFontFamily(font || T.bodyFont);
    } catch (e) {
      // Font unavailable in this account; the default is acceptable.
    }
    return shape;
  }

  function rule(slide, top) {
    var line = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, M, top,
        W - M * 2, 1.5);
    line.getFill().setSolidFill(T.accent);
    line.getBorder().setTransparent();
    return line;
  }

  function header(slide, title) {
    box(slide, title, M, 30, W - M * 2, 32, 21, true, T.ink, T.titleFont);
    rule(slide, 66);
  }

  /**
   * Decode a base64 data URI ("data:image/png;base64,...") to a Blob so Slides
   * can place it. Returns null for an empty or malformed URI, so every caller
   * can guard on the result and fall back to the wordmark.
   */
  function brandBlob_(dataUri) {
    if (!dataUri || String(dataUri).indexOf('base64,') === -1) return null;
    try {
      var parts = String(dataUri).split('base64,');
      var meta = parts[0];
      var type = (meta.match(/data:([^;]+)/) || [null, 'image/png'])[1];
      var bytes = Utilities.base64Decode(parts[1]);
      return Utilities.newBlob(bytes, type, 'logo');
    } catch (e) {
      return null;
    }
  }

  /**
   * Place a logo on a slide. `variant` picks the colour version. `w` is the
   * target width in points; height scales to the image's aspect ratio. Falls
   * back to setting the brand name in text when no logo file is present, so the
   * deck is never unbranded.
   */
  function logo(slide, variant, left, top, w, fallbackColor) {
    var uri = variant === 'white' ? BRAND.logoWhite
            : variant === 'mark'  ? (BRAND.logoMark || BRAND.logoColor)
            : BRAND.logoColor;
    var blob = brandBlob_(uri);
    if (blob) {
      try {
        var img = slide.insertImage(blob);
        var ratio = img.getHeight() / img.getWidth();
        img.setWidth(w).setHeight(w * ratio).setLeft(left).setTop(top);
        return img;
      } catch (e) {
        // fall through to the text wordmark
      }
    }
    box(slide, BRAND.name, left, top, w * 1.6, 20, 11, true,
        fallbackColor || T.accent, T.titleFont);
    return null;
  }

  function commentary(slide, key) {
    var note = notes[String(key).toLowerCase()] || '';
    if (!note) return 0;
    box(slide, note, M, H - 92, W - M * 2, 74, 11, false, T.ink);
    return 92;
  }

  function tableSlide(key, title, headers, rows) {
    if (!DECK.SECTIONS[key] || !rows.length) return null;
    var slide = deck.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    header(slide, title);

    var reserved = commentary(slide, key);
    var capped = rows.slice(0, DECK.ROWS_PER_TABLE);
    var top = 84;
    var height = Math.min(H - top - reserved - 16, 24 + capped.length * 22);

    var table = slide.insertTable(capped.length + 1, headers.length,
        M, top, W - M * 2, height);

    headers.forEach(function(head, c) {
      var cell = table.getCell(0, c);
      cell.getText().setText(String(head));
      cell.getText().getTextStyle().setFontSize(9).setBold(true)
          .setForegroundColor(T.muted);
    });
    capped.forEach(function(row, r) {
      row.forEach(function(value, c) {
        var cell = table.getCell(r + 1, c);
        cell.getText().setText(String(value));
        cell.getText().getTextStyle().setFontSize(10)
            .setForegroundColor(T.ink);
      });
    });

    if (rows.length > capped.length) {
      box(slide, 'Top ' + capped.length + ' of ' + rows.length + ' by spend.',
          M, top + height + 6, W - M * 2, 16, 9, false, T.muted);
    }
    return slide;
  }

  /** Real chart via a hidden sheet. Falls back to the caller's table. */
  function chartSlide(key, title, headers, rows, type) {
    if (!DECK.SECTIONS[key] || !rows.length || !ss) return false;
    try {
      var sheet = ss.getSheetByName(CHART_SHEET);
      if (!sheet) sheet = ss.insertSheet(CHART_SHEET);
      sheet.clear();
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);

      var builder = sheet.newChart()
          .addRange(sheet.getRange(1, 1, rows.length + 1, headers.length))
          .setPosition(1, headers.length + 2, 0, 0)
          .setOption('legend', { position: type === 'pie' ? 'right' : 'none' })
          .setOption('titleTextStyle', { fontSize: 14, color: T.ink })
          .setOption('width', 620).setOption('height', 300);

      builder = (type === 'pie')
          ? builder.setChartType(Charts.ChartType.PIE)
              .setOption('pieHole', 0.55)
              .setOption('colors', ['#E8503A', '#2F6BE0', '#7B58C8', '#1F8A8A',
                                    '#E0A030', '#9C6BD6'])
          : builder.setChartType(Charts.ChartType.LINE)
              .setOption('colors', [T.accent])
              .setOption('curveType', 'none');

      var chart = builder.build();
      sheet.insertChart(chart);
      chartsMade.push(chart);

      var slide = deck.appendSlide(SlidesApp.PredefinedLayout.BLANK);
      header(slide, title);
      var reserved = commentary(slide, key);
      slide.insertSheetsChart(sheet.getCharts()[sheet.getCharts().length - 1],
          M, 84, W - M * 2, H - 84 - reserved - 16);
      return true;
    } catch (e) {
      log_('Deck chart', title + ' fell back to a table: ' +
          String(e.message || e).slice(0, 120));
      return false;
    }
  }

  // --- title ---------------------------------------------------------------
  var first = deck.getSlides()[0];
  first.getPageElements().forEach(function(element) { element.remove(); });
  box(first, 'Demand Gen audit', M, 132, W - M * 2, 26, 13, false, T.muted);
  box(first, account.name, M, 158, W - M * 2, 58, 34, true, T.ink, T.titleFont);
  rule(first, 224);
  box(first, account.start + '  to  ' + account.end + '     ·     account ' +
      account.id + '     ·     ' + account.currency,
      M, 236, W - M * 2, 26, 12, false, T.muted);

  // Every Slides call is a round trip, so a deck is a budget of API writes,
  // not of content. Sections run in priority order and each is isolated, so a
  // failure or a timeout costs the tail rather than the whole deck.
  var startedAt = new Date().getTime();
  // Creative is now one scorecard page (rarely two or three), plus an optional
  // per-video appendix (divider + one slide each) only when creativeDetail is on.
  var creativeCount = (data.videos || []).length;
  var scorecardPages = DECK.SECTIONS.creative && creativeCount
      ? Math.ceil(Math.min(creativeCount, DECK.CREATIVE_ROWS_PER_PAGE * 3) /
                  DECK.CREATIVE_ROWS_PER_PAGE) : 0;
  var appendixSlides = DECK.SECTIONS.creativeDetail && creativeCount
      ? Math.min(creativeCount, DECK.VIDEOS) + 1 : 0;
  var FIXED_SECTIONS = 14;
  var totalSteps = FIXED_SECTIONS + scorecardPages + appendixSlides;
  var step = 0;
  var skipped = [];

  function elapsed() { return (new Date().getTime() - startedAt) / 1000; }

  // Clamped so a miscount can never drive the progress bar past 100%.
  function tick(label) {
    step = Math.min(step + 1, totalSteps);
    setProgress_(step, totalSteps, label);
  }

  /**
   * @param {string} label Shown in the progress bar and the log.
   * @param {boolean} essential Essential sections ignore the time budget.
   * @param {!Function} fn Section body.
   */
  function section(label, essential, fn) {
    if (!essential && elapsed() > DECK.TIME_BUDGET_SECONDS) {
      skipped.push(label);
      return;
    }
    tick(label);
    try {
      fn();
    } catch (e) {
      skipped.push(label);
      log_('Deck', label + ' failed: ' + String(e.message || e).slice(0, 160));
    }
  }

  // --- title ---------------------------------------------------------------
  section('Title', true, function() {
    var first = deck.getSlides()[0];
    first.getPageElements().forEach(function(element) { element.remove(); });
    // Navy title slide — the brand's dark surface for opening/closing.
    var bg = first.insertShape(SlidesApp.ShapeType.RECTANGLE, 0, 0, W, H);
    bg.getFill().setSolidFill(T.deep);
    bg.getBorder().setTransparent();
    bg.sendToBack();
    logo(first, 'white', M, 40, 150, BRAND.white);
    box(first, 'Demand Gen audit', M, 150, W - M * 2, 26, 13, false,
        BRAND.grayMid);
    box(first, account.name, M, 176, W - M * 2, 58, 34, true, BRAND.white,
        T.titleFont);
    var line = first.insertShape(SlidesApp.ShapeType.RECTANGLE, M, 242,
        W - M * 2, 1.5);
    line.getFill().setSolidFill(T.accent);
    line.getBorder().setTransparent();
    box(first, account.start + '  to  ' + account.end + '     ·     account ' +
        account.id + '     ·     ' + account.currency,
        M, 254, W - M * 2, 26, 12, false, BRAND.grayMid);
    box(first, POV.title, M, H - 46, W - M * 2, 24, 11, false, BRAND.grayMid,
        T.titleFont);
  });

  // --- what the numbers say ------------------------------------------------
  section('Read-out', true, function() {
    var readout = (data.readout || {}).conversions || [];
    if (!readout.length) return;
    var slide = deck.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    header(slide, 'What the numbers say');
    box(slide, readout.map(function(line) {
          return '\u2022   ' + plainText_(line);
        }).join('\n\n'),
        M, 88, W - M * 2, H - 110, 12, false, T.ink);
  });

  // --- headline ------------------------------------------------------------
  var t = data.totals, p = data.prior;
  function delta(key) {
    if (!p || !p[key]) return '—';
    var change = ((t[key] || 0) - p[key]) / p[key];
    return (change >= 0 ? '+' : '') + (change * 100).toFixed(0) + '%';
  }

  section('Headline', true, function() {
    tableSlide('headline', 'Headline numbers',
      ['Metric', 'This period', 'Prior', 'Change'], [
        ['Spend', fmtMoney(t.cost), p ? fmtMoney(p.cost) : '—', delta('cost')],
        ['Impressions', int(t.impressions), p ? int(p.impressions) : '—', delta('impressions')],
        ['Clicks', int(t.clicks), p ? int(p.clicks) : '—', delta('clicks')],
        ['Click rate', pct(t.ctr), p ? pct(p.ctr) : '—', delta('ctr')],
        ['Conversions', dec(t.conversions), p ? dec(p.conversions) : '—', delta('conversions')],
        ['Cost per conversion', fmtMoney(t.cpa), p ? fmtMoney(p.cpa) : '—', delta('cpa')],
        ['View-through conv.', dec(t.viewThrough), p ? dec(p.viewThrough) : '—', delta('viewThrough')],
        ['View-through share', pct(t.vtcShare), p ? pct(p.vtcShare) : '—', '—'],
        ['Cost per conv. incl. view-through', fmtMoney(t.cpaVtc), p ? fmtMoney(p.cpaVtc) : '—', delta('cpaVtc')]
      ]);
  });

  // --- structure -----------------------------------------------------------
  section('Structure', true, function() {
    var counts = data.counts || {};
    var rows = [];
    [['campaigns', 'Campaigns'], ['adGroups', 'Ad groups'], ['ads', 'Ads'],
     ['audiences', 'Audiences']].forEach(function(pair) {
      var c = counts[pair[0]];
      if (!c) return;
      rows.push([pair[1], c.total, c.active, c.total - c.active,
          Math.round((c.total ? c.active / c.total : 0) * 100) + '%']);
    });
    tableSlide('structure', 'What is actually delivering',
        ['Entity', 'Exists', 'Delivering', 'Dormant', 'Active share'], rows);
  });

  // --- creative, built early because it is the point of the deck -----------
  // --- creative scorecard (one page, not one slide per video) --------------
  // The whole creative read lands on a single scorecard, styled after the
  // Google Ads video table: source, view rate, the 25/50/75/100% funnel,
  // conversions and view-through, every creative on one page. It only spills
  // to a second page past CREATIVE_ROWS_PER_PAGE rows. Per-video detail slides
  // are an opt-in appendix (DECK.SECTIONS.creativeDetail).
  var scorecard = (data.videos || []).slice(0, DECK.CREATIVE_ROWS_PER_PAGE * 3);

  function watchStr(v) {
    if (!(v.p25 || v.p50 || v.p75 || v.p100)) return 'watch —';
    function w(k) { return Math.round((v[k] || 0) * 100); }
    return 'watch ' + w('p25') + '/' + w('p50') + '/' + w('p75') + '/' +
        w('p100') + '%';
  }

  /** One creative tile: thumbnail plus four compact metric lines. */
  function creativeTile(slide, v, x, y, tileW, thumbH) {
    var placed = false;
    if (v.thumb) {
      try { slide.insertImage(v.thumb, x, y, tileW, thumbH); placed = true; }
      catch (e) { placed = false; }
    }
    if (!placed) {
      var ph = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, x, y, tileW, thumbH);
      ph.getFill().setSolidFill(T.band);
      ph.getBorder().setTransparent();
      box(slide, 'no thumbnail', x, y + thumbH / 2 - 6, tileW, 12, 7, false,
          T.muted);
    }
    var ai = videoSource_(v.title) !== 'Advertiser';
    if (ai) {
      // Small badge in the thumbnail corner flags the AI-modified cuts.
      var badge = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, x + 4, y + 4,
          58, 14);
      badge.getFill().setSolidFill(T.accent);
      badge.getBorder().setTransparent();
      box(slide, 'AI cut', x + 4, y + 4, 58, 14, 7, true, BRAND.white);
    }

    var ty = y + thumbH + 3;
    box(slide, String(v.title || '').slice(0, 34), x, ty, tileW, 12, 8, true,
        T.ink);
    box(slide, (ai ? 'Enhanced by Google AI' : 'Advertiser') + '  ·  VR ' +
        pct(v.viewRate), x, ty + 12, tileW, 11, 7, false,
        ai ? T.accent : T.muted);
    box(slide, watchStr(v), x, ty + 22, tileW, 11, 7, false, T.muted);
    var tc = (Number(v.conversions) || 0) + (Number(v.viewThrough) || 0);
    box(slide, dec(v.conversions) + ' conv · ' + int(v.viewThrough) + ' vt · $' +
        fmtMoney(v.cost),
        x, ty + 32, tileW, 11, 7, false, T.muted);
    box(slide, (v.conversions ? 'CPA $' + fmtMoney(v.cost / v.conversions) : 'CPA n/a') +
        ' · ' + (tc ? 'w/ vt $' + fmtMoney(v.cost / tc) : 'w/ vt n/a'),
        x, ty + 42, tileW, 11, 7, false, T.muted);
  }

  function creativeGridPage(chunk, pageIndex, pageCount) {
    var slide = deck.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    header(slide, 'Creative scorecard' +
        (pageCount > 1 ? '  (' + (pageIndex + 1) + ' of ' + pageCount + ')' : ''));
    box(slide, scorecard.length + ' creatives, highest spend first  ·  every ' +
        'creative on one page, not one slide each', M, 70, W - M * 2, 16, 10,
        false, T.muted);

    var note = pageIndex === 0 ? (notes['creative'] || '') : '';
    var gridTop = 92;
    if (note) {
      box(slide, '▶  ' + note, M, 88, W - M * 2, 14, 9, false, T.accent);
      gridTop = 108;
    }

    var cols = DECK.CREATIVE_COLS;
    var gx = 14, gy = 14;
    var tileW = (W - M * 2 - (cols - 1) * gx) / cols;
    var thumbH = Math.round(tileW * 9 / 16);
    var rowInc = thumbH + 3 + 43 + gy;

    chunk.forEach(function(v, i) {
      var col = i % cols, row = Math.floor(i / cols);
      creativeTile(slide, v, M + col * (tileW + gx), gridTop + row * rowInc,
          tileW, thumbH);
    });

    box(slide, 'AI cut = Enhanced by Google AI (shortened/resized). VR = view ' +
        'rate. watch = share reaching 25/50/75/100%. vt = view-through conv.',
        M, H - 16, W - M * 2, 12, 7, false, T.muted);
    return slide;
  }

  if (DECK.SECTIONS.creative && scorecard.length) {
    var per = DECK.CREATIVE_ROWS_PER_PAGE;
    var pages = Math.ceil(scorecard.length / per);
    for (var pg = 0; pg < pages; pg++) {
      (function(pageIndex) {
        section('Creative scorecard' + (pages > 1 ? ' ' + (pageIndex + 1) : ''),
            true, function() {
          creativeGridPage(scorecard.slice(pageIndex * per, pageIndex * per + per),
              pageIndex, pages);
        });
      })(pg);
    }
  }

  // Optional per-video appendix — off by default to keep the client deck tight.
  if (DECK.SECTIONS.creativeDetail) {
    var detail = (data.videos || []).slice(0, DECK.VIDEOS);
    if (detail.length) {
      section('Creative appendix', true, function() {
        var divider = deck.appendSlide(SlidesApp.PredefinedLayout.BLANK);
        box(divider, 'Creative — per-video detail', M, 158, W - M * 2, 44, 28,
            true, T.ink, T.titleFont);
        rule(divider, 208);
        box(divider, detail.length + ' videos, highest spend first', M, 220,
            W - M * 2, 24, 12, false, T.muted);
        commentary(divider, 'creativeDetail');
      });
      detail.forEach(function(v) {
        section('Video: ' + String(v.title).slice(0, 32), true, function() {
          videoSlide_(deck, v, data, notes, {
            W: W, H: H, M: M, T: T, box: box, rule: rule,
            fmtMoney: fmtMoney, dec: dec, pct: pct, int: int
          });
        });
      });
    }
  }

  // --- channels and surfaces ----------------------------------------------
  section('Channels', false, function() {
    if (!(data.channelMix || []).length) return;
    var total = data.channelMix.reduce(function(sum, r) { return sum + r.cost; }, 0);
    if (!chartSlide('channels', 'Where the budget went', ['Channel', 'Spend'],
        data.channelMix.map(function(r) { return [r.channel, r.cost]; }), 'pie')) {
      tableSlide('channels', 'Where the budget went',
        ['Channel', 'Spend', 'Share', 'Conv', 'Per action'],
        data.channelMix.map(function(r) {
          return [r.channel, fmtMoney(r.cost),
                  Math.round((total ? r.cost / total : 0) * 100) + '%',
                  dec(r.conversions), r.conversions ? fmtMoney(r.cpa) : '—'];
        }));
    }
  });

  section('Surfaces', false, function() {
    if (!(data.surfaceMix || []).length) return;
    var total = data.surfaceMix.reduce(function(sum, r) { return sum + r.cost; }, 0);
    chartSlide('surfaces', 'Which surfaces', ['Surface', 'Spend'],
        data.surfaceMix.map(function(r) { return [r.surface, r.cost]; }), 'pie');
    tableSlide('surfaces', 'Surface performance',
      ['Surface', 'Spend', 'Share', 'Conv', 'Per action', 'View rate'],
      data.surfaceMix.map(function(r) {
        return [r.surface, fmtMoney(r.cost),
                Math.round((total ? r.cost / total : 0) * 100) + '%',
                dec(r.conversions), r.conversions ? fmtMoney(r.cpa) : '—',
                pct(r.viewRate)];
      }));
  });

  // --- landing pages -------------------------------------------------------
  section('Landing pages', false, function() {
    var lps = data.landingPages || [];
    if (!lps.length) return;
    tableSlide('landingPages', 'Where the ads drive',
      ['Destination', 'Spend', 'Conv', 'Per action', 'Ads'],
      lps.map(function(lp) {
        return [String(lp.url).replace(/^https?:\/\//, '').slice(0, 48),
                fmtMoney(lp.spend), dec(lp.conversions),
                lp.conversions ? fmtMoney(lp.cpa) : '—', String(lp.ads)];
      }));
  });

  // --- settings ------------------------------------------------------------
  // One comprehensive settings slide per campaign: every Demand Gen setting the
  // API exposes — bidding + target, budget, conversion goals, new-vs-existing,
  // schedule, locations targeted and excluded, languages, audience exclusions,
  // and the AI asset-enhancement toggles (on/off). Then an account-wide
  // conversion-action setup table.
  function settingsList(arr, n) {
    arr = arr || [];
    if (!arr.length) return '';
    var s = arr.slice(0, n).join('; ');
    if (arr.length > n) s += '  +' + (arr.length - n) + ' more';
    return s;
  }

  function settingsSlideFor(c) {
    var slide = deck.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    header(slide, 'Campaign settings — ' + String(c.name || '').slice(0, 42));
    var reserved = commentary(slide, 'settings');
    var contentH = H - 100 - reserved - 12;

    var goal = /value|roas/i.test((c.bidding || '') + ' ' + (c.target || ''))
        ? 'Conversion value' : 'Conversions';
    var locationLine = c.targetingAtAdGroup
        ? 'Location & language:  Set at ad group (see Ad group settings)'
        : 'Locations:  ' + (settingsList(c.locations, 4) || 'All locations') +
          '\n\nExcluded locations:  ' +
              (settingsList(c.excludedLocations, 4) || 'None') +
          '\n\nLanguages:  ' + ((c.languages || []).join(', ') || 'All');

    var left = [
      'Status:  ' + (c.status || '—') +
          (c.startDate ? '   ·   since ' + c.startDate : '') +
          (c.endDate ? '   ·   ends ' + c.endDate : ''),
      'Campaign goal:  ' + goal,
      'Bidding:  ' + (c.bidding || '—') + (c.target ? '   ·   ' + c.target : ''),
      'Daily budget:  ' + fmtMoney(c.budget) +
          (c.budgetShared ? '  (shared)' : '') +
          (c.budgetDelivery ? '   ·   ' + c.budgetDelivery + ' delivery' : ''),
      'Conversion goals:  ' + ((c.goals || []).join(', ') || 'Account default'),
      'New vs existing:  ' + (c.acquisition || '—'),
      'Ad schedule:  ' + ((c.schedule || []).length
          ? c.schedule.length + ' window(s)' : 'All day, every day'),
      locationLine,
      'Excluded audiences:  ' + (settingsList(c.excludedAudiences, 4) || 'None')
    ].join('\n\n');

    box(slide, 'TARGETING & BIDDING', M, 82, 316, 14, 10, true, T.accent);
    box(slide, left, M, 100, 316, contentH, 9.5, false, T.ink);

    // AI enhancements — analyst override wins, then the API's verified state.
    // Toggles the API never reported and the analyst never set are omitted:
    // an unconfirmed setting should not appear as a loud "review" line.
    var automation = c.automation || [];
    var toggleItems = automation.map(function(a) {
      var o = ovr_(c.id + '|asset|' + a.type);
      if (o) return '●  ' + a.name + ':  ' + (o === 'on' ? 'ON' : 'OFF') +
          ' (verified)';
      if (a.verified) return (a.on ? '●' : '○') + '  ' + a.name +
          ':  ' + (a.on ? 'ON' : 'OFF');
      return null;
    }).filter(function(x) { return x; });
    var toggles = toggleItems.length ? toggleItems.join('\n')
        : 'Not reported by the API. Verify AI enhancements in the platform.';

    var reviewItems = CAMPAIGN_REVIEW_FIELDS.map(function(f) {
      var v = ovr_(c.id + '|' + f[0]);
      return v ? ('●  ' + f[1] + ':  ' + v) : null;
    }).filter(function(x) { return x; });

    box(slide, 'AI ASSET ENHANCEMENTS', M + 336, 82, 296, 14, 10, true, T.accent);
    box(slide, toggles, M + 336, 100, 296, 150, 9, false, T.ink);
    if (reviewItems.length) {
      box(slide, 'VERIFIED IN PLATFORM', M + 336, 258, 296, 14, 10, true,
          T.accent);
      box(slide, reviewItems.join('\n'), M + 336, 276, 296, contentH - 194, 9,
          false, T.ink);
    }
    return slide;
  }

  section('Settings', true, function() {
    var settings = data.settings;
    if (!settings || !(settings.campaigns || []).length) return;

    settings.campaigns.slice(0, DECK.SETTINGS_CAMPAIGNS).forEach(settingsSlideFor);
    if (settings.campaigns.length > DECK.SETTINGS_CAMPAIGNS) {
      var extra = deck.appendSlide(SlidesApp.PredefinedLayout.BLANK);
      header(extra, 'Campaign settings');
      box(extra, 'Showing the first ' + DECK.SETTINGS_CAMPAIGNS + ' of ' +
          settings.campaigns.length + ' campaigns. The full data sheet lists ' +
          'every campaign.', M, 100, W - M * 2, 40, 12, false, T.muted);
    }

    tableSlide('settings', 'Conversion action setup',
      ['Action', 'Category', 'In column', 'Primary', 'View-through', 'Click',
       'Counting'],
      (settings.conversionActions || []).map(function(a) {
        return [String(a.name || '').slice(0, 28), a.category || '—',
                a.inColumn ? 'yes' : 'excluded',
                a.primary ? 'primary' : 'secondary',
                a.viewThroughDays ? a.viewThroughDays + 'd' : 'none',
                a.clickThroughDays ? a.clickThroughDays + 'd' : '—',
                a.counting || '—'];
      }));
  });

  // --- ad group settings ---------------------------------------------------
  // Demand Gen frequently targets at the ad group, so campaign-level targeting
  // can read "All" while the real geo/language/audience lives here.
  section('Ad group settings', false, function() {
    var ags = data.adGroupSettings || [];
    if (!ags.length) return;
    tableSlide('adGroupSettings', 'Ad group settings — targeting',
      ['Ad group', 'Campaign', 'Status', 'Locations', 'Languages', 'Lists'],
      ags.map(function(ag) {
        return [String(ag.adGroup || '').slice(0, 22),
                String(ag.campaign || '').slice(0, 18), ag.status || '—',
                (ag.locations || []).slice(0, 2).join('; ') || 'All',
                (ag.languages || []).join(', ') || 'All',
                String((ag.audiences || []).length)];
      }));
  });

  // --- creative packing ----------------------------------------------------
  section('Creative packing', true, function() {
    var packing = data.creativePacking;
    if (!packing || !packing.multiVideoAds) return;
    var slide = deck.appendSlide(SlidesApp.PredefinedLayout.BLANK);
    header(slide, 'Why per-video watch depth is missing');
    box(slide, [
      '\u2022   ' + packing.multiVideoAds + ' ad(s) carry more than one video, ' +
        'up to ' + packing.maxVideosInOneAd + ' in a single ad.',
      '\u2022   ' + packing.videosAffected + ' video(s) therefore have no ' +
        'individual completion rate. Google reports one blended figure per ad, ' +
        'so every video inside that ad shares the same number.',
      '\u2022   ' + packing.singleVideoAds + ' ad(s) carry exactly one video ' +
        'and are fully measurable.',
      '\u2022   Recommendation: build one ad per video. It costs nothing in ' +
        'delivery and recovers watch depth, completion rate and isolated ' +
        'conversion data for every creative — which is what makes the next ' +
        'creative decision evidence-led rather than a guess.'
    ].join('\n\n'), M, 88, W - M * 2, H - 110, 12, false, T.ink);
    commentary(slide, 'packing');
  });

  // --- conversions ---------------------------------------------------------
  section('Conversions', false, function() {
    if (!(data.conversionActions || []).length) return;
    var byAction = {};
    data.conversionActions.forEach(function(r) {
      var a = byAction[r.action] || (byAction[r.action] =
          { action: r.action, allConversions: 0, allConvValue: 0, conversions: 0 });
      a.allConversions += r.allConversions;
      a.allConvValue += r.allConvValue;
      a.conversions += r.conversions;
    });
    tableSlide('conversions', 'What counted as a conversion',
      ['Action', 'All conv.', 'Value', 'In bidding column'],
      Object.keys(byAction).map(function(k) { return byAction[k]; })
        .sort(function(a, b) { return b.allConversions - a.allConversions; })
        .map(function(r) {
          return [r.action, dec(r.allConversions),
                  r.allConvValue ? fmtMoney(r.allConvValue) : '—',
                  r.conversions > 0 ? dec(r.conversions) : 'excluded'];
        }));
  });

  // --- structure detail ----------------------------------------------------
  section('Campaigns and ad groups', false, function() {
    tableSlide('campaigns', 'Campaigns',
      ['Campaign', 'Status', 'Spend', 'Conv', 'Per action', 'All conv'],
      (data.campaigns || []).map(function(r) {
        return [r.name, r.status, fmtMoney(r.cost), dec(r.conversions),
                r.conversions ? fmtMoney(r.cpa) : '—', dec(r.allConversions)];
      }));
    tableSlide('adGroups', 'Ad groups',
      ['Ad group', 'Campaign', 'Spend', 'Conv', 'Per action', 'CTR'],
      (data.adGroups || []).map(function(r) {
        return [r.name, r.campaign, fmtMoney(r.cost), dec(r.conversions),
                r.conversions ? fmtMoney(r.cpa) : '—', pct(r.ctr)];
      }));
  });

  section('Audiences', false, function() {
    tableSlide('audiences', 'Audiences',
      ['Audience', 'Type', 'Spend', 'Conv', 'Per action', 'All conv'],
      (data.audiences || []).map(function(r) {
        return [r.name, r.type, fmtMoney(r.cost), dec(r.conversions),
                r.conversions ? fmtMoney(r.cpa) : '—', dec(r.allConversions)];
      }));
  });

  section('Demographics and assets', false, function() {
    tableSlide('demographics', 'Age and gender',
      ['Segment', 'Dimension', 'Spend', 'Conv', 'Per action', 'CTR'],
      (data.demographics || []).map(function(r) {
        return [r.value, r.dimension, fmtMoney(r.cost), dec(r.conversions),
                r.conversions ? fmtMoney(r.cpa) : '—', pct(r.ctr)];
      }));
    tableSlide('assets', 'Assets',
      ['Asset', 'Field', 'Rating', 'Impr', 'Clicks', 'CTR'],
      (data.assets || []).map(function(r) {
        return [String(r.text).slice(0, 60), r.fieldType, r.label,
                int(r.impressions), int(r.clicks), pct(r.ctr)];
      }));
  });

  // --- daily trend ---------------------------------------------------------
  // Daily pacing and a standalone methodology-notes slide are intentionally
  // omitted: pacing is rarely the story, and the deck-design prompt folds the
  // two caveats that matter into footnotes on the slides where they apply.

  try {
    var scratch = ss && ss.getSheetByName(CHART_SHEET);
    if (scratch) {
      scratch.getCharts().forEach(function(c) { scratch.removeChart(c); });
      scratch.clear();
      scratch.hideSheet();
    }
  } catch (e) {
    // Leaving the scratch sheet behind is harmless.
  }

  if (skipped.length) {
    log_('Deck', 'Skipped: ' + skipped.join(', ') + ' after ' +
        Math.round(elapsed()) + 's.');
  }
  setProgress_(totalSteps, totalSteps, 'Saving');
  deck.saveAndClose();
  return deck.getUrl();
}

/**
 * One video slide, deliberately cheap in API calls.
 *
 * The earlier version drew the watch funnel from sixteen shapes and the action
 * list from a table of twenty-five cells. At roughly fifty-seven writes per
 * video that alone exhausted the execution budget before the deck finished.
 * Block characters and column text boxes get the same information across in
 * about a dozen.
 */
function videoSlide_(deck, v, data, notes, ui) {
  var W = ui.W, H = ui.H, M = ui.M, T = ui.T;
  var box = ui.box, rule = ui.rule;
  var slide = deck.appendSlide(SlidesApp.PredefinedLayout.BLANK);

  box(slide, v.title, M, 24, W - M * 2, 32, 16, true, T.ink, T.titleFont);
  rule(slide, 60);
  box(slide, (v.adGroupCount || 1) + ' ad group' +
      ((v.adGroupCount || 1) === 1 ? '' : 's') + '   ·   ' +
      (v.campaignList || []).join(', ') + '   ·   ' + (v.label || 'Unrated'),
      M, 64, W - M * 2, 18, 9, false, T.muted);

  var imgW = 250, imgH = 141, imgTop = 88;
  if (v.videoId) {
    try {
      slide.insertImage('https://i.ytimg.com/vi/' + v.videoId +
          '/maxresdefault.jpg', M, imgTop, imgW, imgH);
    } catch (e) {
      try {
        slide.insertImage('https://i.ytimg.com/vi/' + v.videoId +
            '/hqdefault.jpg', M, imgTop, imgW, imgH);
      } catch (e2) {
        box(slide, 'Thumbnail unavailable', M, imgTop, imgW, imgH, 10, false,
            T.muted);
      }
    }
    box(slide, v.url, M, imgTop + imgH + 3, imgW, 14, 8, false, T.muted);
  } else {
    box(slide, 'No YouTube ID returned for this asset', M, imgTop, imgW, imgH,
        10, false, T.muted);
  }

  // Watch depth as block characters: one write instead of sixteen shapes.
  var t = data.totals;
  var own = !!v.quartileSource;
  var depth = own ? v : t;
  var funnel = [own ? 'How far people watch'
                    : 'How far people watch — account level'];
  ['p25', 'p50', 'p75', 'p100'].forEach(function(key, i) {
    var value = Math.max(0, Math.min(1, depth[key] || 0));
    var filled = Math.round(value * 18);
    funnel.push(['25%', '50%', '75%', 'End'][i] + '  ' +
        new Array(filled + 1).join('\u2588') +
        new Array(18 - filled + 1).join('\u2591') + '  ' +
        Math.round(value * 100) + '%');
  });
  if (!own) {
    funnel.push('Shared ad — describes the ad, not this video.');
  }
  box(slide, funnel.join('\n'), M, imgTop + imgH + 22, imgW + 10, 92, 8.5,
      false, T.ink);

  // Metrics as two column text boxes rather than twelve separate ones.
  var x = M + imgW + 30;
  var w = W - x - M;
  var metrics = [
    ['Spend', ui.fmtMoney(v.cost)],
    ['Conversions', ui.dec(v.conversions)],
    ['Cost per action', v.conversions ? ui.fmtMoney(v.cpa) : '—'],
    ['View rate', ui.pct(v.viewRate)],
    ['All conversions', ui.dec(v.allConversions)],
    ['Impressions', ui.int(v.impressions)]
  ];
  box(slide, metrics.map(function(m) { return m[0]; }).join('\n'),
      x, 88, w * 0.55, 120, 10, false, T.muted);
  box(slide, metrics.map(function(m) { return m[1]; }).join('\n'),
      x + w * 0.55, 88, w * 0.45, 120, 10, true);

  // Conversion actions as three column text boxes rather than a 25-cell table.
  var actions = (v.conversionActions || []).slice(0, 7);
  if (actions.length) {
    box(slide, 'Conversion actions' +
        (v.conversionSource === 'ad' ? ' (inferred)' : ''),
        x, 214, w, 14, 9, false, T.muted);
    box(slide, ['Action'].concat(actions.map(function(a) {
          return String(a.action).slice(0, 26);
        })).join('\n'), x, 230, w * 0.5, 130, 8.5, false, T.ink);
    box(slide, ['All conv.'].concat(actions.map(function(a) {
          return ui.dec(a.allConversions);
        })).join('\n'), x + w * 0.5, 230, w * 0.25, 130, 8.5, false, T.ink);
    box(slide, ['In column'].concat(actions.map(function(a) {
          return a.conversions > 0 ? ui.dec(a.conversions) : 'excluded';
        })).join('\n'), x + w * 0.75, 230, w * 0.25, 130, 8.5, false, T.ink);
  }

  var note = notes[String(v.title).toLowerCase()] || '';
  if (note) box(slide, note, M, H - 30, W - M * 2, 26, 9, false, T.ink);
  return slide;
}

// ===========================================================================
// PAYLOAD CACHE
// ===========================================================================

/**
 * One hidden sheet per account, named _payload_<customerId>.
 *
 * Drive would need the full drive scope, which is far more access than a
 * reporting tool should hold. Script Properties cap values at 9KB, well under
 * what a real account produces. Row 1 carries the account name so the
 * dashboard picker can label accounts without parsing the whole blob.
 */
function savePayload_(data) {
  // Order settings by enabled campaigns first, then by spend — so the deck and
  // dashboard lead with the campaigns that matter. Spend comes from the
  // campaigns pull, joined by id.
  if (data.settings && (data.settings.campaigns || []).length) {
    var spendById = {};
    (data.campaigns || []).forEach(function(c) {
      spendById[String(c.id)] = c.cost || 0;
    });
    data.settings.campaigns.forEach(function(c) {
      c.spend = spendById[String(c.id)] || 0;
    });
    data.settings.campaigns.sort(function(a, b) {
      var ae = a.status === 'ENABLED' ? 0 : 1;
      var be = b.status === 'ENABLED' ? 0 : 1;
      if (ae !== be) return ae - be;
      return (b.spend || 0) - (a.spend || 0);
    });

    // Flag campaigns whose location targeting actually lives at the ad group,
    // so the UI can say "Set at ad group" instead of a misleading "All".
    var agByCampaign = {};
    (data.adGroupSettings || []).forEach(function(ag) {
      (agByCampaign[ag.campaignId] = agByCampaign[ag.campaignId] || []).push(ag);
    });
    data.settings.campaigns.forEach(function(c) {
      var ags = agByCampaign[String(c.id)] || [];
      c.targetingAtAdGroup = !(c.locations || []).length && ags.some(function(a) {
        return (a.locations || []).length || (a.languages || []).length;
      });
    });
  }

  // Ad-group settings, sorted enabled-first then by spend (joined from adGroups).
  var agSpend = {};
  (data.adGroups || []).forEach(function(g) { agSpend[String(g.id)] = g.cost || 0; });
  (data.adGroupSettings || []).forEach(function(ag) {
    ag.spend = agSpend[String(ag.id)] || 0;
  });
  (data.adGroupSettings || []).sort(function(a, b) {
    var ae = a.status === 'ENABLED' ? 0 : 1;
    var be = b.status === 'ENABLED' ? 0 : 1;
    if (ae !== be) return ae - be;
    return (b.spend || 0) - (a.spend || 0);
  });

  var payload = {
    account: data.account,
    totals: data.totals,
    prior: data.prior,
    channelMix: data.channelMix,
    campaigns: trim_(data.campaigns),
    adGroups: trim_(data.adGroups),
    ads: trim_(data.ads).map(function(ad) {
      ad.channelMix = data.adChannels[ad.id] || {};
      return ad;
    }),
    audiences: trim_(data.audiences),
    assets: trim_(data.assets),
    videos: trim_(data.videos).map(function(v) {
      v.source = videoSource_(v.title);
      return v;
    }),
    conversionActions: data.conversionActions || [],
    surfaceMix: data.surfaceMix || [],
    deviceMix: data.deviceMix || [],
    demographics: trim_(data.demographics),
    devices: trim_(data.devices),
    placements: trim_(data.placements),
    daily: data.daily,
    sheetUrl: data.sheetUrl || '',
    brief: data.brief || '',
    placementsSkipped: !!CONFIG.SKIP_PLACEMENTS,
    counts: data.counts || {},
    settings: data.settings || null,
    adGroupSettings: data.adGroupSettings || [],
    landingPages: data.landingPages || [],
    creativePacking: data.creativePacking || null,
    readout: data.readout || null,
    deckPrompt: buildDeckPrompt_(data),
    storyboard: buildStoryboard_(data),
    notes: readCommentary_(),
    runLog: data.runLog || RUN_LOG
  };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    log_('Payload', 'SKIPPED — no bound spreadsheet.');
    return;
  }

  var name = PAYLOAD_PREFIX + data.account.rawId;
  var json = JSON.stringify(payload);
  var sheet = ss.getSheetByName(name);
  if (sheet) {
    sheet.clear();
  } else {
    sheet = ss.insertSheet(name);
  }

  // Row 1: account label for the picker. Row 2 onward: the JSON, chunked.
  sheet.getRange(1, 1, 1, 2).setValues([['account', data.account.name]]);

  var chunks = [];
  for (var i = 0; i < json.length; i += PAYLOAD_CHUNK) {
    chunks.push([json.substring(i, i + PAYLOAD_CHUNK)]);
  }
  sheet.getRange(2, 1, chunks.length, 1).setValues(chunks);
  try {
    sheet.hideSheet();
  } catch (e) {
    // Cannot hide the only visible sheet; harmless.
  }

  log_('Payload', Math.round(json.length / 1024) + 'KB across ' +
      chunks.length + ' cells.');
}

function readPayload_(customerId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) return null;
  var sheet = ss.getSheetByName(PAYLOAD_PREFIX + digits_(customerId));
  if (!sheet || sheet.getLastRow() < 2) return null;

  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues()
      .map(function(row) { return row[0]; }).join('');
}

function trim_(rows) {
  return rows.slice().sort(function(a, b) { return b.cost - a.cost; })
      .slice(0, CONFIG.TOP_N);
}

// ===========================================================================
// SHEET OUTPUT
// ===========================================================================

/**
 * Writes every audited account into one set of tabs. With more than one
 * account an Account column is prepended, so the Sheet stays a single
 * pivotable data layer instead of fragmenting into per-client tabs.
 */
function writeSheets_(results) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    Logger.log('No bound spreadsheet — skipping Sheet output.');
    return;
  }

  var multi = results.length > 1;
  var money = results[0].account.currency;

  var perf = ['Impr', 'Clicks', 'Cost (' + money + ')', 'CTR', 'CPC', 'CPM',
              'Conv', 'CVR', 'CPA', 'Conv value', 'ROAS',
              'All conv', 'All conv rate', 'All conv CPA', 'All conv value',
              'All conv ROAS', 'Conv gap',
              'View-thru conv', 'VTC share', 'Video views', 'View rate', 'CPV',
              '25%', '50%', '75%', '100%'];

  function cells(r) {
    return [r.impressions, r.clicks, r.cost, r.ctr, r.cpc, r.cpm,
            r.conversions, r.cvr, r.cpa, r.convValue, r.roas,
            r.allConversions, r.allCvr, r.allCpa, r.allConvValue, r.allRoas,
            r.convGap,
            r.viewThrough, r.vtcShare, r.videoViews, r.viewRate, r.cpv,
            r.p25, r.p50, r.p75, r.p100];
  }

  /**
   * @param {string} name Tab name.
   * @param {!Array<string>} headers Columns after the optional Account column.
   * @param {function(!Object): !Array<!Array>} build Rows for one account.
   */
  function write(name, headers, build) {
    var rows = [];
    results.forEach(function(data) {
      build(data).forEach(function(row) {
        rows.push(multi ? [data.account.name].concat(row) : row);
      });
    });
    tab_(ss, name, multi ? ['Account'].concat(headers) : headers, rows);
  }

  write('Summary', ['Metric', 'Current', 'Prior', 'Change'], summaryRows_);

  write('Channels', ['Channel'].concat(perf), function(d) {
    return d.channelMix.map(function(r) { return [r.channel].concat(cells(r)); });
  });

  write('Campaigns',
      ['Campaign', 'Status', 'Bid strategy', 'Daily budget'].concat(perf),
      function(d) {
        return d.campaigns.map(function(r) {
          return [r.name, r.status, r.bidding, r.budget].concat(cells(r));
        });
      });

  write('Ad groups', ['Ad group', 'Campaign', 'Status'].concat(perf),
      function(d) {
        return d.adGroups.map(function(r) {
          return [r.name, r.campaign, r.status].concat(cells(r));
        });
      });

  write('Ads',
      ['Ad', 'Type', 'Campaign', 'Ad group', 'Status', 'Approval', 'Headlines',
       'Descriptions', 'Video links', 'Image links', 'Final URL'].concat(perf),
      function(d) {
        return d.ads.map(function(r) {
          return [r.name, r.type, r.campaign, r.adGroup, r.status, r.approval,
                  (r.headlines || []).join(' | '),
                  (r.descriptions || []).join(' | '),
                  (r.videoLinks || []).map(function(v) { return v.url; }).join('\n'),
                  (r.imageUrls || []).join('\n'),
                  r.finalUrl].concat(cells(r));
        });
      });

  write('Videos',
      ['Video', 'Rating', 'Ad groups', 'Campaigns', 'YouTube link'].concat(perf),
      function(d) {
        return (d.videos || []).map(function(r) {
          return [r.title, r.label || 'Unrated', r.adGroupCount,
                  (r.campaignList || []).join(' | '), r.url].concat(cells(r));
        });
      });

  write('Surfaces', ['Surface'].concat(perf), function(d) {
    return (d.surfaceMix || []).map(function(r) {
      return [r.surface].concat(cells(r));
    });
  });

  write('Campaign settings',
      ['Campaign', 'Status', 'Bidding', 'Target', 'Daily budget', 'Delivery',
       'Shared budget', 'New vs existing', 'Goals', 'Locations',
       'Excluded locations', 'Languages', 'Ad schedule', 'Excluded audiences',
       'Start', 'End'],
      function(d) {
        return (((d.settings || {}).campaigns) || []).map(function(c) {
          return [c.name, c.status, c.bidding, c.target || '', c.budget,
                  c.budgetDelivery, c.budgetShared ? 'yes' : 'no', c.acquisition,
                  (c.goals || []).join(', '),
                  (c.locations || []).join('; ') || 'All locations',
                  (c.excludedLocations || []).join('; '),
                  (c.languages || []).join('; '),
                  (c.schedule || []).length
                      ? c.schedule.map(function(x) {
                          return x.day + ' ' + x.start + '-' + x.end;
                        }).join('; ')
                      : 'All day, every day',
                  (c.excludedAudiences || []).join('; '),
                  c.startDate, c.endDate];
        });
      });

  write('Asset optimisation', ['Campaign', 'Setting', 'State'], function(d) {
    var rows = [];
    (((d.settings || {}).campaigns) || []).forEach(function(c) {
      (c.automation || []).forEach(function(a) {
        rows.push([c.name, a.name, a.on ? 'ON' : 'OFF']);
      });
    });
    return rows;
  });

  write('Conversion action setup',
      ['Action', 'Category', 'In Conversions column', 'View-through days',
       'Click-through days', 'Counting'],
      function(d) {
        return (((d.settings || {}).conversionActions) || []).map(function(a) {
          return [a.name, a.category, a.inColumn ? 'yes' : 'no',
                  a.viewThroughDays, a.clickThroughDays, a.counting];
        });
      });

  write('Conversion actions',
      ['Conversion action', 'Category', 'Campaign', 'All conv',
       'All conv value', 'In Conversions column', 'Conv value'],
      function(d) {
        return (d.conversionActions || []).map(function(r) {
          return [r.action, r.category, r.campaign, r.allConversions,
                  r.allConvValue, r.conversions, r.convValue];
        });
      });

  write('Video conversions',
      ['Video', 'Conversion action', 'Category', 'All conv', 'All conv value',
       'In Conversions column', 'Attribution'],
      function(d) {
        var rows = [];
        (d.videos || []).forEach(function(v) {
          (v.conversionActions || []).forEach(function(a) {
            rows.push([v.title, a.action, a.category, a.allConversions,
                       a.allConvValue, a.conversions,
                       v.conversionSource === 'ad'
                           ? 'Inferred from single-video ads'
                           : 'Asset level']);
          });
        });
        return rows;
      });

  write('Audiences', ['Audience', 'Type', 'Campaign', 'Ad group'].concat(perf),
      function(d) {
        return d.audiences.map(function(r) {
          return [r.name, r.type, r.campaign, r.adGroup].concat(cells(r));
        });
      });

  write('Assets',
      ['Asset', 'Type', 'Field', 'Rating', 'Campaign', 'Ad group',
       'View link'].concat(perf),
      function(d) {
        return d.assets.map(function(r) {
          return [r.text, r.type, r.fieldType, r.label, r.campaign, r.adGroup,
                  r.viewUrl].concat(cells(r));
        });
      });

  write('Demographics', ['Dimension', 'Value', 'Campaign'].concat(perf),
      function(d) {
        return d.demographics.map(function(r) {
          return [r.dimension, r.value, r.campaign].concat(cells(r));
        });
      });

  write('Devices', ['Device', 'Campaign'].concat(perf), function(d) {
    return d.devices.map(function(r) {
      return [r.device, r.campaign].concat(cells(r));
    });
  });

  write('Placements', ['Placement', 'Type', 'Campaign', 'URL'].concat(perf),
      function(d) {
        return d.placements.map(function(r) {
          return [r.name, r.type, r.campaign, r.url].concat(cells(r));
        });
      });

  write('Daily', ['Date'].concat(perf), function(d) {
    return d.daily.map(function(r) { return [r.date].concat(cells(r)); });
  });

  write('Run log', ['Step', 'Detail'], function(d) {
    return d.runLog || [];
  });

  // One markdown line per row: readable in the Sheet, and clean for anything
  // reading the tab through a Drive connector.
  var briefRows = [];
  results.forEach(function(data) {
    String(data.brief || '').split('\n').forEach(function(line) {
      // A leading "=" would be parsed as a formula.
      briefRows.push(multi
          ? [data.account.name, line.indexOf('=') === 0 ? "'" + line : line]
          : [line.indexOf('=') === 0 ? "'" + line : line]);
    });
  });
  tab_(ss, 'Analysis brief',
      multi ? ['Account', 'Brief'] : ['Brief'], briefRows);

  results.forEach(function(data) { data.sheetUrl = ss.getUrl(); });
  Logger.log('Spreadsheet: ' + ss.getUrl());
}

function summaryRows_(data) {
  var now = data.totals;
  var was = data.prior;
  return [
    ['Impressions', 'impressions'], ['Clicks', 'clicks'], ['Cost', 'cost'],
    ['CTR', 'ctr'], ['Avg CPC', 'cpc'], ['Avg CPM', 'cpm'],
    ['Conversions', 'conversions'], ['Conv rate', 'cvr'], ['CPA', 'cpa'],
    ['Conv value', 'convValue'], ['ROAS', 'roas'],
    ['All conversions', 'allConversions'], ['All conv rate', 'allCvr'],
    ['All conv CPA', 'allCpa'], ['All conv value', 'allConvValue'],
    ['All conv ROAS', 'allRoas'],
    ['Conversions not in bidding column', 'convGap'],
    ['View-through conv', 'viewThrough'], ['VTC share of total', 'vtcShare'],
    ['Video views', 'videoViews'], ['View rate', 'viewRate'], ['CPV', 'cpv'],
    ['Watched 25%', 'p25'], ['Watched 50%', 'p50'],
    ['Watched 75%', 'p75'], ['Watched 100%', 'p100']
  ].map(function(pair) {
    var current = now[pair[1]] || 0;
    var prior = was ? (was[pair[1]] || 0) : '';
    return [pair[0], current, prior,
            (was && prior) ? (current - prior) / prior : ''];
  });
}

function tab_(ss, name, headers, rows) {
  var sheet = ss.getSheetByName(name);
  if (sheet) {
    sheet.clear();
  } else {
    sheet = ss.insertSheet(name);
  }
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#191C24').setFontColor('#FFFFFF');
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sheet.setFrozenRows(1);
}
