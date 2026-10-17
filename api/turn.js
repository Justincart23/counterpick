// Vercel serverless function: hands each browser short-lived TURN relay credentials from Cloudflare Realtime,
// so an online duel still connects when the two players' networks can't link directly.
// Env vars (Cloudflare dashboard > Realtime > TURN Server > create key): CF_TURN_KEY_ID, CF_TURN_KEY_TOKEN.
// Without them it returns STUN only (direct connections), and the game still works on friendly networks.
const ALLOWED_ORIGIN = /^https:\/\/((www\.)?cuued\.com|justincart23\.github\.io)$/;
const STUN_ONLY = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const TTL_SECONDS = 4 * 3600;

// Browsers refuse TURN on port 53, which Cloudflare includes in its list.
const usable = (server) => {
  const urls = [].concat(server.urls || []).filter((u) => !/:53(\?|$)/.test(u));
  return urls.length ? { ...server, urls } : null;
};

async function cloudflareIceServers(id, token) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const body = JSON.stringify({ ttl: TTL_SECONDS });
  const base = `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(id)}/credentials`;
  let r = await fetch(`${base}/generate-ice-servers`, { method: 'POST', headers, body });
  if (r.status === 404) r = await fetch(`${base}/generate`, { method: 'POST', headers, body }); // older endpoint
  if (!r.ok) throw new Error(`Cloudflare TURN responded ${r.status}`);
  const json = await r.json();
  return [].concat(json.iceServers || []).map(usable).filter(Boolean);
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGIN.test(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin') }
  res.setHeader('Cache-Control', 'no-store');
  const id = process.env.CF_TURN_KEY_ID, token = process.env.CF_TURN_KEY_TOKEN;
  if (!id || !token) return res.status(200).json({ relay: false, iceServers: STUN_ONLY });
  try {
    const servers = await cloudflareIceServers(id, token);
    if (!servers.some((s) => [].concat(s.urls).some((u) => u.startsWith('turn')))) throw new Error('no TURN servers returned');
    return res.status(200).json({ relay: true, iceServers: servers });
  } catch (err) {
    console.error('turn credentials:', err.message);
    return res.status(200).json({ relay: false, iceServers: STUN_ONLY });
  }
};
