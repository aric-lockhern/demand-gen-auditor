// The dashboard's fast read path. Apps Script publishes each account's finished payload (exactly what
// getPayload returns) and a small access index to Netlify Blobs; this answers the page's reads from there,
// on a CDN, without Google's web-app front end (which measured 3-52 s and random 404s from
// script.googleusercontent.com). The Sheet + Apps Script stay the source of truth and the only writer.
//
// SECURITY: same rule as the Apps Script web app — only a signed-in lockherndigital.com user may read.
// Apps Script runs as the viewer (executeAs USER_ACCESSING) and mints a session "s1.<b64url(email|exp)>
// .<HMAC>" from SESSION_SECRET; this verifies it with the published secret and checks the domain. An
// optional agency key (checked by SHA-256 hash) also works. Anything this can't positively verify (no
// session, an unknown/forged/expired one, an account not published yet, nothing published) answers
// {fallback: true} and the page asks Apps Script, which stays the authority. tests/fastapi.test.mjs pins it.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

// Cross-origin: the page is served by Apps Script (/exec on googleusercontent.com), this API is on the
// Netlify site, so the browser needs CORS. The session key gates access, not the origin, so * is fine.
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type, authorization'
};
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex', ...CORS }
});
const ok = (result) => json({ ok: true, result });
const fail = (error, status = 200) => json({ ok: false, error }, status);
const fallback = (why) => json({ ok: false, fallback: true, error: why });

export function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}
/** Google customer ids are the digits; that's the blob key and the index id. */
export function normId(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');
const b64urlNoPad = (buf) => Buffer.from(buf).toString('base64url');

/** Code.gs mint: "s1.<b64url(email|expiryMs)>.<HMAC-SHA256(secret, body)>", signed with the published secret. */
export function readSession(tok, ix) {
  const parts = String(tok).slice(3).split('.');
  if (!String(tok).startsWith('s1.') || parts.length !== 2 || !ix.sessionSecret) return '';
  if (!same(b64urlNoPad(createHmac('sha256', ix.sessionSecret).update(parts[0]).digest()), parts[1])) return '';
  const m = Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8').match(/^(.+)\|(\d+)$/);
  if (!m || Number(m[2]) < Date.now()) return '';
  const email = m[1].toLowerCase();
  const listed = (ix.adminEmails || []).map((x) => x.toLowerCase()).includes(email);
  const domain = (ix.adminDomains || []).map((x) => x.toLowerCase()).includes(email.split('@')[1] || '');
  return listed || domain ? email : '';
}

/** {mode:'admin', email} when the index vouches for the key; null = not known here (ask Apps Script). */
export function resolveAccess(ix, key) {
  key = String(key || '').trim();
  if (key.startsWith('s1.')) { const who = readSession(key, ix); return who ? { mode: 'admin', email: who } : null; }
  if (key) return ix.keyHash && same(sha256(key), ix.keyHash) ? { mode: 'admin', email: '' } : null;
  return null;
}

function accountsFor(ix) {
  return {
    accounts: (ix.accounts || []).filter((a) => a.hasData)
      .map((a) => ({ id: a.id, name: a.name }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
    at: ix.at || 0, url: ix.url || ''
  };
}

/** GET /api?api=ping|accounts|payload&account=&key=  and POST /api/ingest. */
export async function handle(req, store, env) {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method === 'POST' && url.pathname.replace(/\/$/, '').endsWith('/ingest')) return ingest(req, store, env);
  if (req.method !== 'GET') return fail('Reads only.', 405);
  const p = Object.fromEntries(url.searchParams);
  const ix = await store.get('index', { type: 'json' });
  // ping says whether the Sheet has published yet, so "is fast loading on?" is answerable from a browser.
  if (p.api === 'ping') return ok({ ran: true, fast: true, published: !!ix, at: (ix && ix.at) || 0, accounts: ix ? (ix.accounts || []).length : 0 });
  if (!ix) return fallback('nothing published yet');
  const access = resolveAccess(ix, p.key);
  if (!access) return fallback('not known here');
  if (p.api === 'accounts') return ok(accountsFor(ix));
  if (p.api === 'payload' || p.api === 'data') {
    const id = normId(p.account);
    if (!id) return fail('No account.');
    if (!(ix.accounts || []).some((a) => normId(a.id) === id)) return fallback('account not published');
    const snap = await store.get('acct/' + id, { type: 'json' });
    if (!snap || !snap.data) return fallback('account not published');
    return ok(snap.data);   // the payload verbatim — same bytes getPayload returns, so answers match by construction
  }
  return fail('Unknown api action.');
}

/** POST /api/ingest from Apps Script: {kind:'index'|'acct', cid, version, gz: base64(gzip(JSON))}. */
async function ingest(req, store, env) {
  const secret = (env && env.INGEST_SECRET) || '';
  const auth = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (secret.length < 24 || !same(auth, secret)) return fail('Not accepted.', 403);   // fails closed with no secret set
  let b;
  try { b = await req.json(); } catch (e) { return fail('Bad body.', 400); }
  let data;
  try { data = JSON.parse(gunzipSync(Buffer.from(String(b.gz || ''), 'base64')).toString('utf8')); } catch (e) { return fail('Bad payload.', 400); }
  if (b.kind === 'index') {
    if (!data || !Array.isArray(data.accounts)) return fail('Bad index.', 400);
    await store.setJSON('index', data);
    return ok({ stored: 'index', accounts: data.accounts.length });
  }
  if (b.kind === 'acct') {
    const id = normId(b.cid);
    if (!/^\d{8,}$/.test(id) || !data || !data.account) return fail('Bad account.', 400);
    await store.setJSON('acct/' + id, { version: String(b.version || ''), at: Date.now(), data });
    return ok({ stored: id });
  }
  return fail('Unknown kind.', 400);
}
