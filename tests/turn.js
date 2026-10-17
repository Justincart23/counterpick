// Unit test for api/turn.js, the Vercel function that hands out TURN relay credentials.
//   node tests/turn.js
const path = require('path');
const handlerPath = path.join(__dirname, '..', 'api', 'turn.js');

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg) };
function call({ env = {}, origin = 'https://cuued.com', cloudflare } = {}) {
  delete require.cache[handlerPath];
  for (const k of ['CF_TURN_KEY_ID', 'CF_TURN_KEY_TOKEN']) delete process.env[k];
  Object.assign(process.env, env);
  const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return cloudflare(url, opts) };
  const handler = require(handlerPath);
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v }, status(c) { this.statusCode = c; return this }, json(o) { this.body = o; return this } };
  return handler({ headers: { origin } }, res).then(() => ({ res, calls }));
}
const ok = (json) => ({ ok: true, status: 200, json: async () => json });
const ICE = { iceServers: [
  { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
  { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' },
] };

(async () => {
  let r = await call({ cloudflare: () => { throw new Error('should not call Cloudflare without a key') } });
  check(r.res.body.relay === false && r.res.body.iceServers.length > 0, 'without a key: STUN only, relay=false');
  check(r.res.headers['Access-Control-Allow-Origin'] === 'https://cuued.com', 'allows the cuued.com origin');
  check(r.res.headers['Cache-Control'] === 'no-store', 'credentials must not be cached');

  r = await call({ env: { CF_TURN_KEY_ID: 'kid', CF_TURN_KEY_TOKEN: 'tok' }, cloudflare: () => ok(ICE) });
  const urls = r.res.body.iceServers.flatMap((s) => [].concat(s.urls));
  check(r.res.body.relay === true, 'with a key: relay=true');
  check(urls.some((u) => u.startsWith('turns:') && u.includes(':443')), 'keeps TURN over TLS on 443 (gets through strict firewalls)');
  check(!urls.some((u) => /:53(\?|$)/.test(u)), 'drops port-53 URLs, which browsers block');
  check(r.calls[0].url.endsWith('/kid/credentials/generate-ice-servers') && r.calls[0].opts.headers.Authorization === 'Bearer tok', 'calls Cloudflare with the key id and bearer token');

  r = await call({ env: { CF_TURN_KEY_ID: 'kid', CF_TURN_KEY_TOKEN: 'tok' }, cloudflare: (url) =>
    url.endsWith('generate-ice-servers') ? { ok: false, status: 404 } : ok({ iceServers: ICE.iceServers[1] }) });
  check(r.res.body.relay === true && r.calls.length === 2 && r.calls[1].url.endsWith('/credentials/generate'), 'falls back to the older endpoint on 404');

  r = await call({ env: { CF_TURN_KEY_ID: 'kid', CF_TURN_KEY_TOKEN: 'bad' }, cloudflare: () => ({ ok: false, status: 401 }) });
  check(r.res.statusCode === 200 && r.res.body.relay === false, 'a Cloudflare error degrades to STUN instead of failing');

  r = await call({ origin: 'https://evil.example', cloudflare: () => ok(ICE) });
  check(!('Access-Control-Allow-Origin' in r.res.headers), 'other sites get no CORS permission');

  console.log(JSON.stringify({ cases: 6, failures: fail.length }));
  if (fail.length) console.error(fail.map((f) => '  - ' + f).join('\n'));
  process.exit(fail.length ? 1 : 0);
})();
