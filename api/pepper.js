import crypto from 'node:crypto';

const MAX_BODY_BYTES = 64 * 1024;

function originAllowed(req) {
  const allowed = process.env.ALLOWED_ORIGIN || '*';
  if (allowed === '*') return true;
  const list = allowed.split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.headers.origin || '';
  if (!origin) return true;
  return list.includes(origin);
}

function accessDenied(req) {
  const secret = process.env.IMPORT_SHARED_SECRET;
  if (secret && req.headers['x-budgetvault-key'] !== secret) return 'invalid or missing key';
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
