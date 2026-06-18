const MAX_BODY_BYTES = 5 * 1024 * 1024;

import crypto from 'node:crypto';

// --- Rate limiting (in-instance; back with a shared store for hard guarantees) ---
const RL_WINDOW_MS = 60 * 1000;
const RL_MAX = Number(process.env.IMPORT_RATE_LIMIT || 12); // PDF imports per IP per window
const rlHits = new Map();
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
  // When an allow-list is configured, a request with NO Origin header is rejected.
  // Legitimate browser callers always send Origin on cross-origin POSTs; allowing
  // empty-Origin requests would let a plain curl bypass the origin check entirely.
  if (!origin) return false;
  return list.includes(origin);
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

// Server-side access control. Setting ALLOWED_ORIGIN blocks cross-origin browser
// abuse; setting IMPORT_SHARED_SECRET additionally blocks any caller (including
// curl) that does not present the matching x-budgetvault-key header.
function accessDenied(req) {
  const secret = process.env.IMPORT_SHARED_SECRET;
  if (secret && !safeEqual(req.headers['x-budgetvault-key'], secret)) return 'invalid or missing key';
  if (!originAllowed(req)) return 'origin not allowed';
  return null;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('The upload is too large for this import endpoint. Try a smaller/compressed PDF.'), { status: 413 }));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(Object.assign(new Error('Invalid JSON request body.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function parseJsonFromResponse(data) {
  if (data.output_text) return JSON.parse(data.output_text);
  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) chunks.push(content.text);
      if (content.type === 'text' && content.text) chunks.push(content.text);
    }
  }
  if (!chunks.length) throw new Error('OpenAI returned no text output.');
  return JSON.parse(chunks.join('\n'));
}

const statementSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    institution: { type: 'string' },
    accountLast4: { type: 'string' },
    statementPeriod: {
      type: 'object',
      additionalProperties: false,
      properties: { from: { type: 'string' }, to: { type: 'string' } },
      required: ['from', 'to']
    },
    currency: { type: 'string' },
    transactions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          date: { type: 'string', description: 'ISO date YYYY-MM-DD' },
          description: { type: 'string' },
          merchant: { type: 'string' },
          type: { type: 'string', enum: ['income', 'expense'] },
          amount: { type: 'number', description: 'Positive amount in statement currency' },
          suggestedCategory: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          needsReview: { type: 'boolean' },
          sourcePage: { type: 'integer' },
          merchantKeyword: { type: 'string' },
          notes: { type: 'string' }
        },
        required: ['date', 'description', 'merchant', 'type', 'amount', 'suggestedCategory', 'confidence', 'needsReview', 'sourcePage', 'merchantKeyword', 'notes']
      }
    },
    warnings: { type: 'array', items: { type: 'string' } }
  },
  required: ['institution', 'accountLast4', 'statementPeriod', 'currency', 'transactions', 'warnings']
};

export default async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  if (rateLimited(req)) { res.setHeader('Retry-After', '60'); return res.status(429).json({ error: 'Too many import requests. Please wait a minute and try again.' }); }
  const denied = accessDenied(req);
  if (denied) return res.status(403).json({ error: `Forbidden: ${denied}` });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY is not configured in Vercel.' });

  try {
    const body = await readJson(req);
    const filename = String(body.filename || 'statement.pdf').slice(0, 120);
    const mimeType = String(body.mimeType || 'application/pdf');
    const dataBase64 = String(body.dataBase64 || '');
    if (!dataBase64 || !/^application\/pdf$/.test(mimeType)) return res.status(400).json({ error: 'Upload a PDF statement.' });
    // Verify the bytes really are a PDF (%PDF-), not just a claimed MIME type.
    let pdfHeaderOk = false;
    try { pdfHeaderOk = Buffer.from(dataBase64.slice(0, 16), 'base64').slice(0, 5).toString('latin1') === '%PDF-'; } catch { pdfHeaderOk = false; }
    if (!pdfHeaderOk) return res.status(400).json({ error: 'That file does not look like a PDF.' });
    const categories = Array.isArray(body.categories) ? body.categories.map(String).slice(0, 80) : [];
    const learningRules = Array.isArray(body.learningRules) ? body.learningRules.slice(0, 150) : [];
    const existingHints = Array.isArray(body.existingHints) ? body.existingHints.slice(0, 80) : [];

    const prompt = `You are parsing a UK personal bank statement for BudgetVault. Extract visible transactions only. Return dates as YYYY-MM-DD. Use positive amounts and set type to income for money in/deposits, expense for money out/payments. Suggested categories must use the user's categories where possible. If a money-out transaction appears to be a transfer to savings, ISA, saver, savings pot, premium bonds, or another savings account, suggest the category Savings when that category is available. If uncertain, set needsReview true and lower confidence. Apply learning rules for merchant/category preferences when they clearly match. Do not invent missing transactions.\n\nUser categories: ${JSON.stringify(categories)}\nLearning rules: ${JSON.stringify(learningRules)}\nExisting recent transactions for duplicate awareness: ${JSON.stringify(existingHints)}\nCurrency preference: ${String(body.currency || 'GBP')}`;

    const openAiBody = {
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      input: [
        { role: 'system', content: 'You convert bank statement PDFs into strict JSON for a budgeting app. Be conservative and flag uncertainty.' },
        { role: 'user', content: [
          { type: 'input_text', text: prompt },
          { type: 'input_file', filename, file_data: `data:${mimeType};base64,${dataBase64}` }
        ] }
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'budgetvault_bank_statement_import',
          schema: statementSchema,
          strict: true
        }
      }
    };

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(openAiBody)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error?.message || `OpenAI request failed with HTTP ${response.status}`;
      return res.status(response.status).json({ error: message });
    }

    const parsed = parseJsonFromResponse(data);
    return res.status(200).json({ ...parsed, provider: 'openai', model: openAiBody.model });
  } catch (error) {
    const status = error.status || 500;
    return res.status(status).json({ error: error.message || 'Statement import failed.' });
  }
}
