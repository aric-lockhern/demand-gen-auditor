// The fast read path (netlify/lib/fastapi.mjs) must serve a published account's payload byte-for-byte to a
// signed-in lockherndigital.com viewer, and NOTHING to anyone it can't positively verify. Because the
// function serves the payload verbatim (no re-derivation), "same answer as Apps Script getPayload" is
// guaranteed by construction + the round-trip assertion here; this suite pins the access rules and ingest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createHmac, createHash } from 'node:crypto';
import { handle } from '../netlify/lib/fastapi.mjs';

const SECRET = 'x'.repeat(40);                 // INGEST_SECRET (>= 24 chars)
const SESSION_SECRET = 'sess-secret-' + 'y'.repeat(40);
const CID = '3513897342';                      // digits, like a real customer id
const PAYLOAD = { account: { id: '351-389-7342', name: 'Xero Shoes US', rawId: CID }, totals: { cost: 16251 }, ads: [{ id: '1', name: 'A' }] };

function memStore() {
  const m = new Map();
  return { m, get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), setJSON: async (k, v) => { m.set(k, JSON.stringify(v)); } };
}
// Mirror Apps Script's mint EXACTLY: body = base64url(email|expMs) no-pad; sig = base64url(HMAC(secret, body)).
function mintSession(email, secret = SESSION_SECRET, exp = Date.now() + 30 * 864e5) {
  const body = Buffer.from(email + '|' + exp).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest().toString('base64url');
  return 's1.' + body + '.' + sig;
}
const sha256hex = (s) => createHash('sha256').update(String(s)).digest('hex');

const env = { INGEST_SECRET: SECRET };
const url = (q) => 'https://dg.example.com/api?' + new URLSearchParams(q);
async function fast(store, q) { const r = await handle(new Request(url(q)), store, env); return { status: r.status, body: await r.json() }; }
async function ingest(store, kind, cid, data, e = env, auth = 'Bearer ' + SECRET) {
  const gz = gzipSync(JSON.stringify(data)).toString('base64');
  const r = await handle(new Request('https://dg.example.com/api/ingest', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify({ kind, cid, version: 'v1', gz }) }), store, e);
  return { status: r.status, body: await r.json() };
}
// The index Publish.gs sends: accounts, the session secret, the allowed domains, optional agency key hash.
async function publish(store, { keyHash = '' } = {}) {
  const index = { at: Date.now(), accounts: [{ id: CID, name: 'Xero Shoes US', hasData: true }], sessionSecret: SESSION_SECRET, adminDomains: ['lockherndigital.com'], adminEmails: [], keyHash, url: 'https://script.example/exec' };
  await ingest(store, 'index', '', index);
  await ingest(store, 'acct', CID, PAYLOAD);
  return index;
}

test('publish then read: a signed-in lockherndigital.com user gets the payload verbatim', async () => {
  const store = memStore();
  await publish(store);
  const r = await fast(store, { api: 'payload', account: CID, key: mintSession('aric@lockherndigital.com') });
  assert.equal(r.body.ok, true, r.body.error);
  assert.deepEqual(r.body.result, PAYLOAD);                        // byte-for-byte what getPayload returned
  // The account id in any format resolves to the same blob.
  const r2 = await fast(store, { api: 'payload', account: '351-389-7342', key: mintSession('sam@lockherndigital.com') });
  assert.deepEqual(r2.body.result, PAYLOAD);
  // accounts lists it.
  const ra = await fast(store, { api: 'accounts', key: mintSession('aric@lockherndigital.com') });
  assert.deepEqual(ra.body.result.accounts, [{ id: CID, name: 'Xero Shoes US' }]);
});

test('SECURITY: only a valid session or the agency key reads; everything else falls back', async () => {
  const store = memStore();
  const key = 'AGENCY-KEY-123456';
  const keyHash = sha256hex(key);
  await publish(store, { keyHash });

  // Valid session and valid agency key both work.
  assert.equal((await fast(store, { api: 'payload', account: CID, key: mintSession('aric@lockherndigital.com') })).body.ok, true);
  assert.equal((await fast(store, { api: 'payload', account: CID, key })).body.ok, true);

  // Anything unverifiable answers {fallback:true} (never data) so the page asks Apps Script.
  const forgedSig = (() => { const t = mintSession('aric@lockherndigital.com'); const p = t.split('.'); return p[0] + '.' + p[1] + '.' + 'A'.repeat(43); })();
  const otherSecret = mintSession('aric@lockherndigital.com', 'not-the-real-secret-' + 'z'.repeat(30));
  const expired = mintSession('aric@lockherndigital.com', SESSION_SECRET, Date.now() - 1000);
  const wrongDomain = mintSession('mallory@evil.com');
  for (const [label, q] of [
    ['no key', {}],
    ['unknown key', { key: 'nope' }],
    ['forged signature', { key: forgedSig }],
    ['session signed with another secret', { key: otherSecret }],
    ['expired session', { key: expired }],
    ['right secret, wrong domain', { key: wrongDomain }]
  ]) {
    const r = await fast(store, { api: 'payload', account: CID, ...q });
    assert.equal(r.body.ok, false, label);
    assert.equal(r.body.fallback, true, label + ' should fall back');
    assert.equal(r.body.result, undefined, label + ' must not leak data');
  }
  // A valid session asking for an account that isn't published falls back (never 403s a real user out).
  const miss = await fast(store, { api: 'payload', account: '9998887777', key: mintSession('aric@lockherndigital.com') });
  assert.equal(miss.body.fallback, true);
});

test('rotating the session secret revokes old sessions on the fast path', async () => {
  const store = memStore();
  const old = mintSession('aric@lockherndigital.com');     // minted under SESSION_SECRET
  await publish(store);
  assert.equal((await fast(store, { api: 'payload', account: CID, key: old })).body.ok, true);
  // Republish the index with a new secret (Apps Script's signEveryoneOut / rotate).
  const store2 = store;
  const newSecret = 'rotated-' + 'q'.repeat(40);
  await ingest(store2, 'index', '', { at: Date.now(), accounts: [{ id: CID, name: 'Xero Shoes US', hasData: true }], sessionSecret: newSecret, adminDomains: ['lockherndigital.com'], adminEmails: [], keyHash: '', url: '' });
  assert.equal((await fast(store2, { api: 'payload', account: CID, key: old })).body.fallback, true, 'the old session no longer verifies');
  assert.equal((await fast(store2, { api: 'payload', account: CID, key: mintSession('aric@lockherndigital.com', newSecret) })).body.ok, true);
});

test('ingest refuses a wrong, missing or short secret, and fails closed with none configured', async () => {
  const store = memStore();
  const body = { at: 0, accounts: [], sessionSecret: 's', adminDomains: [] };
  assert.equal((await ingest(store, 'index', '', body, env, 'Bearer wrong')).status, 403);
  assert.equal((await ingest(store, 'index', '', body, env, '')).status, 403);
  assert.equal((await ingest(store, 'index', '', body, {}, 'Bearer ' + SECRET)).status, 403, 'no INGEST_SECRET set: refuse everything');
  assert.equal((await ingest(store, 'index', '', body, { INGEST_SECRET: 'short' }, 'Bearer short')).status, 403, 'a secret < 24 chars is refused');
  assert.equal((await ingest(store, 'index', '', body, env, 'Bearer ' + SECRET.slice(0, -1))).status, 403);
  assert.equal((await ingest(store, 'index', '', body)).status, 200);
  // A malformed account payload is rejected before storing.
  assert.equal((await ingest(store, 'acct', CID, { not: 'a payload' })).status, 400);
  // Non-GET reads are refused.
  assert.equal((await handle(new Request('https://dg.example.com/api?api=ping', { method: 'DELETE' }), store, env)).status, 405);
});

test('ping answers whether anything is published, without naming a secret or a session', async () => {
  const store = memStore();
  let r = await fast(store, { api: 'ping' });
  assert.equal(r.body.result.published, false);
  // Before anything is published, every read falls back.
  assert.equal((await fast(store, { api: 'payload', account: CID, key: mintSession('aric@lockherndigital.com') })).body.fallback, true);
  await publish(store);
  r = await fast(store, { api: 'ping' });
  assert.equal(r.body.result.published, true);
  assert.equal(r.body.result.accounts, 1);
  assert.ok(!JSON.stringify(r.body).includes('lockherndigital'), 'ping names no session secret or email');
  assert.ok(!JSON.stringify(r.body).includes('s1.'), 'ping names no session');
});
