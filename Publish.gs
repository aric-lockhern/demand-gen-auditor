/**
 * FAST LOADING: publishes what the dashboard reads to Netlify Blobs, so the page doesn't wait on Google's
 * web-app front end (measured 3-52 s, random 404s from script.googleusercontent.com). The Sheet and Apps
 * Script stay the source of truth and the only writer; this only moves the READ path.
 * -----------------------------------------------------------------------------
 * Every 5 minutes (time trigger) `publishAll` sends, to <FAST_API_URL>/api/ingest (netlify/functions/api.mjs):
 *   - the access index: the account list, the Google sign-in session secret, the allowed lockherndigital.com
 *     domain(s), and (optional) a SHA-256 of a shared agency key — so the function can check access itself;
 *   - each account whose payload changed (its version cell moved): exactly what getPayload returns.
 * A re-pull or settings save publishes at once (`publishSoon_`). The page asks Apps Script whenever the fast
 * path doesn't know the account, session or key yet, so Apps Script is always the authority.
 * Secret: Script Properties INGEST_SECRET == the Netlify env var INGEST_SECRET (Sheet menu > Fast loading:
 * set up). The Netlify site base lives in Script Property FAST_API_URL. Nothing is sent until both exist.
 *
 * (This is a separate .gs file but shares the project's global scope with Code.gs, so it calls
 *  cachedAccounts_ / digits_ / readPayload_ / webAppUrl_ directly.)
 */
var PUB_BUDGET_MS = 4 * 60 * 1000;
var FAST_ADMIN_DOMAINS_DEFAULT = ['lockherndigital.com'];
var SESSION_PREFIX = 's1.', SESSION_DAYS = 30;

// ---- config read from Script Properties -----------------------------------
function pubSecret_() { return PropertiesService.getScriptProperties().getProperty('INGEST_SECRET') || ''; }
function fastApiBase_() { return (PropertiesService.getScriptProperties().getProperty('FAST_API_URL') || '').replace(/\/+$/, ''); }
function pubUrl_() { var s = fastApiBase_(); return s ? s + '/api/ingest' : ''; }
function pubOn_() { return !!(pubSecret_() && pubUrl_()); }
function fastAdminDomains_() {
  var p = PropertiesService.getScriptProperties().getProperty('FAST_ADMIN_DOMAINS');
  return p ? p.split(/[\s,]+/).filter(String) : FAST_ADMIN_DOMAINS_DEFAULT;
}
function fastAdminEmails_() {
  var p = PropertiesService.getScriptProperties().getProperty('FAST_ADMIN_EMAILS');
  return p ? p.split(/[\s,]+/).filter(String) : [];
}
function fastAgencyKey_() { return PropertiesService.getScriptProperties().getProperty('FAST_ADMIN_KEY') || ''; }

// ---- signed sessions (verified by netlify/lib/fastapi.mjs readSession) -----
function sessionSecret_() {
  var props = PropertiesService.getScriptProperties(), s = props.getProperty('SESSION_SECRET');
  if (!s) { s = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); props.setProperty('SESSION_SECRET', s); }
  return s;
}
function b64url_(s) { return Utilities.base64EncodeWebSafe(s).replace(/=+$/, ''); }
function sessionSig_(body) { return b64url_(Utilities.computeHmacSha256Signature(body, sessionSecret_())); }
/** "s1.<b64url(email|expiryMs)>.<HMAC>", for a signed-in viewer (doGet runs as them). */
function mintSession_(email) {
  var exp = Date.now() + SESSION_DAYS * 864e5, body = b64url_(String(email) + '|' + exp);
  return SESSION_PREFIX + body + '.' + sessionSig_(body);
}

function hexDigest_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s))
      .map(function (b) { return ((b & 0xff) + 0x100).toString(16).slice(1); }).join('');
}

/** POSTs one gzipped payload to /api/ingest; returns '' or the reason it failed. */
function pubPost_(kind, cid, version, data) {
  var gz = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(data), 'application/json')).getBytes());
  var res = UrlFetchApp.fetch(pubUrl_(), {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + pubSecret_() },
    payload: JSON.stringify({ kind: kind, cid: cid || '', version: version || '', gz: gz })
  });
  var code = res.getResponseCode(), body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) {}
  return code === 200 && body.ok ? '' : 'HTTP ' + code + (body.error ? ': ' + body.error : '');
}

/** What the fast path needs to check access and list accounts. Never contains the agency key itself. */
function pubIndex_() {
  var key = fastAgencyKey_();
  return {
    at: Date.now(),
    accounts: cachedAccounts_().map(function (a) {
      return { id: digits_(a.id), name: a.name, hasData: true };
    }),
    sessionSecret: sessionSecret_(),
    adminDomains: fastAdminDomains_(),
    adminEmails: fastAdminEmails_(),
    keyHash: key ? hexDigest_(key) : '',
    url: webAppUrl_()
  };
}

function pubVerKey_(cid) { return 'PUB_V_' + digits_(cid); }

/** Sends one account's payload (exactly what getPayload returns). Returns '' or the reason. */
function publishAccount_(cid) {
  cid = digits_(cid);
  var version = readPayloadVersion_(cid);
  var raw = readPayload_(cid);
  if (!raw) return 'no payload';
  var data;
  try { data = JSON.parse(raw); } catch (e) { return 'unreadable payload'; }
  var err = pubPost_('acct', cid, version, data);
  if (!err) PropertiesService.getScriptProperties().setProperty(pubVerKey_(cid), version);
  return err;
}
function publishIndex_() { return pubOn_() ? pubPost_('index', '', '', pubIndex_()) : ''; }

/** Time trigger (every 5 minutes): the index, then every account whose payload changed, within the budget. */
function publishAll() {
  if (!pubOn_()) return;
  var cache = CacheService.getScriptCache();
  if (cache.get('pub_running')) return;                 // the previous run is still going
  cache.put('pub_running', '1', 300);
  try {
    var started = Date.now(), props = PropertiesService.getScriptProperties();
    var err = publishIndex_();
    if (err) { console.log('Fast loading: index not accepted: ' + err); return; }
    var done = 0, failed = [];
    cachedAccounts_().forEach(function (a) {
      if (Date.now() - started > PUB_BUDGET_MS) return;
      var cid = digits_(a.id), stored = props.getProperty(pubVerKey_(cid)), cur = readPayloadVersion_(cid);
      if (stored !== null && stored === cur) return;    // unchanged since last publish
      var e = '';
      try { e = publishAccount_(cid); } catch (ex) { e = String(ex && ex.message ? ex.message : ex); }
      if (e) failed.push(a.name + ': ' + e); else done++;
    });
    console.log('Fast loading: ' + done + ' account(s) published' + (failed.length ? '; failed: ' + failed.join(' | ') : '') + '.');
  } finally {
    cache.remove('pub_running');
  }
}

/** Right away, after a re-pull or a settings save. Never throws: the write itself succeeded. */
function publishSoon_(cid) {
  if (!pubOn_()) return;
  try {
    publishIndex_();
    if (cid) { publishAccount_(digits_(cid)); }
  } catch (e) { console.log('Fast loading: could not publish now: ' + e); }
}

/** Sheet menu: creates the shared secret, shows it for Netlify, turns the trigger on, and tests the link. */
function fastSetup() {
  var ui = SpreadsheetApp.getUi(), props = PropertiesService.getScriptProperties();
  if (!fastApiBase_()) {
    ui.alert('Set the Netlify site first', 'Add a Script Property FAST_API_URL = your Netlify site base URL ' +
      '(e.g. https://your-site.netlify.app), under Project Settings > Script properties. Then run this again.',
      ui.ButtonSet.OK);
    return;
  }
  var secret = pubSecret_();
  if (!secret) { secret = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''); props.setProperty('INGEST_SECRET', secret); }
  var have = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (have.indexOf('publishAll') < 0) ScriptApp.newTrigger('publishAll').timeBased().everyMinutes(5).create();
  var test = '';
  try { test = publishIndex_(); } catch (e) { test = String(e && e.message ? e.message : e); }
  ui.showModalDialog(HtmlService.createHtmlOutput(
    '<div style="font:14px Arial;padding:4px">' +
    (test
      ? '<p><b>One step left, in Netlify:</b> Site configuration &gt; Environment variables &gt; Add a variable</p>' +
        '<p>Key: <b>INGEST_SECRET</b><br>Value:</p><input style="width:100%;padding:6px" value="' + secret + '" onclick="this.select()" readonly>' +
        '<p>Then Deploys &gt; Trigger deploy, wait for it to finish, and run this menu item again.</p>' +
        '<p style="color:#64748b">Test send: ' + String(test).replace(/</g, '&lt;') + '</p>'
      : '<p><b>Fast loading is on.</b> Every account is being published now (the first round takes a few minutes); ' +
        'from then on, every 5 minutes when something changed.</p>') +
    '</div>').setWidth(560).setHeight(test ? 320 : 150), 'Fast loading');
}
