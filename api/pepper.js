import crypto from 'node:crypto';

const MAX_BODY_BYTES = 64 * 1024;

// --- Rate limiting (in-instance) ----------------------------------------------
// The pepper endpoint is the entire basis of "online high-security mode": an
// attacker who steals the local vault must brute-force THROUGH this endpoint.
// Without a limiter that promise is empty, so enforce one here. Note: serverless
// instances don't share memory, so for hard guarantees back this with a shared
// store (e.g. Upstash/Vercel KV); this in-instance limiter still raises the bar a lot.
const RL_WINDOW_MS = 60 * 1000;
const RL_MAX = Number(process.env.PEPPER_RATE_LIMIT || 30); // requests per IP per window
const rlHits = new Map(); // ip -> [timestamps]
function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || req.socket?.remoteAddress || 'unknown';
}
function rateLimited(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const arr = (rlHits.get(ip) || []).filter(t => now - t < RL_WINDOW_MS);
  arr.push(now);
  rlHits.set(ip, arr);
  // opportunistic cleanup so the map can't grow unbounded
  if (rlHits.size > 5000) { for (const [k, v] of rlHits) { if (!v.some(t => now - t < RL_WINDOW_MS)) rlHits.delete(k); } }
  return arr.length > RL_MAX;
}

// Constant-time compare that won't throw on length mismatch.
function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function originAllowed(req) {
  const allowed = process.env.ALLOWED_ORIGIN || '*';
  if (allowed === '*') return true;
  const list = allowed.split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.headers.origin || '';
  // With an allow-list configured, reject requests with no Origin header — a
  // legitimate browser always sends one, and allowing empty Origin lets curl bypass.
  if (!origin) return false;
  return list.includes(origin);
}

function accessDenied(req) {
  const secret = process.env.IMPORT_SHARED_SECRET;
  if (secret && !safeEqual(req.headers['x-budgetvault-key'], secret)) return 'invalid or missing key';
  if (!originAllowed(req)) return 'origin not allowed';
  return null;
}

function setCors(req, res) {
  const allowed = process.env.ALLOWED_ORIGIN || '*';
  const requestOrigin = req.headers.origin || '';
  const list = allowed.split(',').map(s => s.trim()).filter(Boolean);
  const origin = allowed === '*' ? '*' : (list.includes(requestOrigin) ? requestOrigin : (list[0] || ''));
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-budgetvault-key');
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error('Body too large.'), { status: 413 })); req.destroy(); return; }
      body += chunk;
    });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { reject(Object.assign(new Error('Invalid JSON.'), { status: 400 })); } });
    req.on('error', reject);
  });
}

// Online high-security mode key server.
// Computes HMAC-SHA256(KDF_PEPPER, clientHash) where clientHash is the PBKDF2 output the
// browser derived from the user's password. The server never sees the password or the data,
// and cannot decrypt anything (it has no ciphertext). Because the secret pepper is required
// for EVERY guess, an attacker who copies the local encrypted file still cannot brute-force
// it offline — they would have to come through this endpoint, which can be rate-limited.
export default async function handler(req, res) {
  setCors(req, res);
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (rateLimited(req)) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'Too many requests. Slow down and try again shortly.' }); }
  const denied = accessDenied(req);
  if (denied) return res.status(403).json({ error: `Forbidden: ${denied}` });
  const pepper = process.env.KDF_PEPPER;
  if (!pepper || pepper.length < 16) {
    return res.status(500).json({ error: 'KDF_PEPPER is not configured on the server (set a long random value to enable online high-security mode).' });
  }
  try {
    const body = await readJson(req);
    let hash;
    try { hash = Buffer.from(String(body.hash || ''), 'base64'); } catch { hash = Buffer.alloc(0); }
    if (hash.length !== 32) return res.status(400).json({ error: 'Expected a 32-byte base64 hash.' });
    const key = crypto.createHmac('sha256', pepper).update(hash).digest('base64');
    return res.status(200).json({ key });
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || 'Key derivation failed.' });
  }
}
