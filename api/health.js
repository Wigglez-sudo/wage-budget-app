import crypto from 'node:crypto';

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
  if (!origin) return false;
  return list.includes(origin);
}

function accessDenied(req) {
  const secret = process.env.IMPORT_SHARED_SECRET;
  if (secret && !safeEqual(req.headers['x-budgetvault-key'], secret)) return 'invalid or missing key';
  if (!originAllowed(req)) return 'origin not allowed';
  return null;
}

export default function handler(req, res) {
  const allowed = process.env.ALLOWED_ORIGIN || '*';
  const requestOrigin = req.headers.origin || '';
  const list = allowed.split(',').map(s => s.trim()).filter(Boolean);
  const origin = allowed === '*' ? '*' : (list.includes(requestOrigin) ? requestOrigin : (list[0] || ''));
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-budgetvault-key');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const denied = accessDenied(req);
  if (denied) return res.status(403).json({ error: `Forbidden: ${denied}` });
  // Report only whether a key is configured (needed by the in-app connection test).
  // The model name is intentionally not disclosed.
  return res.status(200).json({ ok: true, service: 'BudgetVault AI import', openaiConfigured: Boolean(process.env.OPENAI_API_KEY) });
}
