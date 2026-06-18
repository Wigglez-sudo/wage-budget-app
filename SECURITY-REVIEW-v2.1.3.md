# BudgetVault — independent security & code review (v2.1.2)

Method: this is an **independent** review, done the same way the earlier app reviews
were — read the code for every area, then actually run it to confirm behaviour rather
than trust claims. BudgetVault already ships a thorough self-audit (`SECURITY.md`),
so a large part of this pass was **verifying those claims against the real code and
attacking the app myself**, then hunting for what the self-audit missed. Findings are
labelled CRITICAL / HIGH / MEDIUM / LOW / INFO with realistic impact.

App shape: a local-first PWA (vanilla JS, strict CSP, encrypted-at-rest budget) plus
three Vercel serverless functions — `parse-statement` (PDF → OpenAI), `pepper`
(server-side KDF augmentation), `health`. No third-party runtime dependencies.

---

## Part 1 — Claims in SECURITY.md that I independently VERIFIED as true

These were tested, not taken on faith. All held up:

- **AES-256-GCM + PBKDF2-SHA256 @ 1,000,000 iters, random 16-byte salt, random
  12-byte IV.** I re-implemented `deriveKey`/`encrypt`/`decrypt` from `app.js` in
  Node Web Crypto and confirmed: encrypt→decrypt round-trips; a **wrong password is
  rejected** by the GCM tag; **tampered ciphertext is rejected**; the **salt is random
  per encryption**. (4/4 passed.)
- **No XSS.** I fired six payloads (`<script>`, `<img onerror>`, `<svg onload>`, quote-
  breakouts, `javascript:`) through the app's exact `escapeHTML` + `innerHTML` render
  pattern in a real browser. **All rendered as inert text; zero executed.** Every
  user/AI-controlled field in the render sinks (transaction description, merchant,
  category, source, notes, labels, dates) is escaped; numerics go through
  `Number(...).toFixed()`. The CSP (`script-src 'self'`, no inline) is a correct second
  layer.
- **CSV formula-injection blocked** — `csvCell` prefixes `= + - @` with `'` and doubles
  quotes. (One gap noted below as L2.)
- **No SSRF** — `parse-statement` only ever calls the fixed OpenAI URL; no user-supplied
  URL is fetched.
- **Service worker is safe** — GET + same-origin only, and it **explicitly excludes
  `/api/` from caching** (only the static APP_SHELL is cached), so no API/sensitive-data
  caching or cache-poisoning.
- **No hardcoded secrets** in client or server code; OpenAI key and pepper live only in
  Vercel env vars. The only sensitive value in `localStorage` is the user's *own*
  AI-import shared secret (expected).
- **Encryption envelope is versioned** (`v`, `kdf`, `iterations`, `mode`) so cost can be
  raised without locking out old vaults; key is cached in memory so PBKDF2 isn't re-run
  on every autosave.

The cryptography and the client-side handling are genuinely well done.

---

## Part 2 — NEW findings (gaps the self-audit missed or under-states)

### H1 — The pepper endpoint has NO rate limiting, which breaks online-mode's core promise (HIGH)
`api/pepper.js`
`SECURITY.md` §5 sells online high-security mode on this guarantee: an attacker who
copies the local file "cannot brute-force it at all — every single guess now requires a
call to your server, **which you can rate-limit**, monitor, or take offline." The word
"rate-limit" also appears in the code comment as the thing that makes the design safe.
**But there is no rate limiting anywhere in the code.** Each request just computes the
HMAC and returns it. So an attacker who stole an online-mode vault *and* knows the
endpoint can pipeline guesses through `/api/pepper` at whatever rate Vercel allows —
turning the "impossible to brute-force offline" claim into "brute-forceable online at
the server's throughput." This is the single biggest gap: a headline security property
is documented but not implemented.
**Fix:** add a real limiter to `/api/pepper` (and `/api/parse-statement`). Even a
lightweight in-instance IP+sliding-window limiter raises the bar enormously and makes
the documented claim true; ideally back it with a shared store (Upstash/KV) since
serverless instances don't share memory. At minimum, return `429` with `Retry-After`
when a per-IP threshold is exceeded.

### M1 — Origin-only protection is bypassable via a missing Origin header (MEDIUM)
`api/parse-statement.js`, `api/pepper.js`, `api/health.js` (`originAllowed`)
`originAllowed()` returns **`true` when there is no `Origin` header** ("can't be
origin-checked"). I confirmed by reproducing the logic: with `ALLOWED_ORIGIN` set but
**no** `IMPORT_SHARED_SECRET` (a setup many users will choose, since the secret is
described as optional), a plain `curl` with no `Origin` header **passes** and reaches
OpenAI. So "set ALLOWED_ORIGIN to block abuse" is defeated by simply not sending an
Origin. For an endpoint whose only legitimate caller is the user's own browser (which
*always* sends Origin on cross-origin POSTs), treating "no Origin" as allowed is a
weakness, not a convenience.
**Fix options (pick per appetite):** (a) when `ALLOWED_ORIGIN` is configured, **require**
an Origin and reject requests without one; or (b) make the docs/UI stop presenting the
shared secret as optional and **strongly** steer users to set it (it's the only control
that actually closes this). I implement (a) below behind the existing config, so
nothing changes for users who leave `ALLOWED_ORIGIN` unset.

### M2 — Shared-secret comparison is not timing-safe (MEDIUM→LOW)
`api/*.js` (`req.headers['x-budgetvault-key'] !== secret`)
The secret is compared with `!==`, which short-circuits on the first differing byte — a
classic (if hard-to-exploit over the internet) timing side-channel. Cheap to fix.
**Fix:** compare with `crypto.timingSafeEqual` on equal-length buffers (length-check
first, constant-time after).

### L1 — MIME check is cosmetic; no PDF magic-byte validation (LOW)
`api/parse-statement.js`
`mimeType` is regex-checked for `application/pdf`, but the actual `dataBase64` is never
verified to be a PDF (`%PDF` / `JVBER...` header). An attacker can claim `application/pdf`
and send arbitrary bytes; impact is low (it's forwarded to OpenAI, not parsed locally),
but it means the validation is theatre and lets junk burn an OpenAI call.
**Fix:** decode the first few base64 bytes and require the `%PDF-` signature; reject
otherwise with `400`.

### L2 — CSV injection guard misses tab/CR-prefixed and space-padded formulas (LOW)
`app.js` `csvCell` — `/^[=+\-@]/`
The guard covers `= + - @` but not a leading **tab** (`\t`) or **carriage return**
(`\r`), and not `"  =cmd"` (formula after leading whitespace) — both are in standard
CSV-injection guidance. Edge-casey, but trivial to harden.
**Fix:** broaden the test to also catch leading `\t`/`\r` and trim-then-test so a
space-padded formula is still neutralised.

### L3 — `aiImportSecret` stored in plaintext localStorage (LOW / arguably by design)
`app.js`
The user's AI-import shared secret sits unencrypted in `localStorage`. It's not the
vault password and only gates the user's own endpoint, so impact is limited, but anyone
with local access (or a future XSS, though none was found) could read it. Worth a one-
line note in `SECURITY.md` so it's a conscious choice, not an oversight.

### INFO — Version/cache hygiene
`sw.js` cache is `budgetvault-v2.1.2`, matching `package.json` — good. No action; noted
for completeness.

---

## Part 3 — Non-security code observations (minor)
- `parse-statement` trusts `OPENAI_MODEL` from env and echoes the model name back in the
  success response (`model: openAiBody.model`) even though `health` deliberately hides
  it. Minor inconsistency; not sensitive (the success path is authenticated), but if the
  intent is to never disclose the model, drop it from the parse response too.
- Error messages from OpenAI are passed straight through to the client
  (`data.error?.message`). Low risk, but consider a generic message to avoid leaking
  upstream detail.

---

## Recommended fix set (this pass)
Apply **H1** (rate limit — the important one), **M1** (reject no-Origin when an origin
allow-list is configured), **M2** (timing-safe secret compare), **L1** (PDF magic-byte
check), and **L2** (broaden CSV guard). Document **L3**. All are additive and
backwards-compatible: users who configure nothing keep today's behaviour, and the crypto
/ XSS posture (already strong) is untouched. Each fix is verified by re-running the
crypto, XSS, and access-control probes plus `node --check`.

---

## Part 4 — UI/UX review pass (render-and-inspect, both viewports)

After the security review I rendered all 8 tabs (Overview, Add, Plan, Activity,
Reports, AI import, Security, Settings) plus the unlock and onboarding screens on
**desktop (1280×900)** and **mobile (390×844)** and watched for runtime errors and
visual breakage. **No runtime/console errors on any tab**, and the layout is genuinely
well built — responsive side-nav → bottom-nav, clean card hierarchy, good empty states,
canvas charts that scale to mobile width, and security guidance baked into the Import
and Security tabs. Two small real issues surfaced and were fixed:

### U1 — Stale KDF label on the unlock screen (LOW) — FIXED
`index.html` auth card showed `AES-256-GCM · PBKDF2 600k` (title "PBKDF2 600,000
iterations"), but the app was upgraded to **1,000,000** iterations and the Security tab
already says so. The setup screen was the only place left showing the old figure —
misleading on the very screen where a user first judges the app's security.
**Fix:** updated the label and its tooltip to `PBKDF2 1,000,000`.

### U2 — `frame-ancestors` CSP directive was being ignored (MEDIUM, clickjacking) — FIXED
The CSP is delivered via a `<meta>` tag, and browsers **ignore `frame-ancestors` in
meta CSP** (it only works as an HTTP response header). The console flagged this on every
load. The practical effect: the intended clickjacking protection wasn't active, so the
app could be framed by a malicious site.
**Fix:** added an HTTP `Content-Security-Policy: frame-ancestors 'none'` plus
`X-Frame-Options: DENY` (and `Referrer-Policy: no-referrer`) to **all** routes in
`vercel.json`, where the other security headers live. The meta CSP is kept for the
directives that *do* work in meta. (Note: this protection is delivered by Vercel; on a
host that doesn't apply `vercel.json` headers, set the same headers there.)

Everything else in the UI pass was clean — no layout breaks, overflow, or unreadable
states found on either viewport.

---

## Part 5 — FULL UI review (populated data, modals, accessibility, interactions)

The earlier UI pass (Part 4) was a smoke test on empty screens. This is the proper
review: I drove the app through its **real UI** (created a vault, added wages and
expenses via the Add-money forms), then inspected every screen **populated**, opened
modals, tested interactions, and ran accessibility checks on desktop (1280×900) and
mobile (390×844).

**Method note / honesty:** two things I first flagged turned out to be *my test's* fault,
not the app's, and I verified before reporting:
- "Expense descriptions save as empty" — my driver typed into `expenseDescription`, but
  the real input id is `expenseDesc`; the app saves descriptions correctly.
- "Category limits show 0 / on-track despite over-limit spend" — an artifact of the
  onboarding-created budget not carrying my injected category limits; with limits set
  through the UI the dashboard computes correctly. Not a bug.
Populated dashboards, the review queue, income/expense tables, sorting, and the Edit
modal all render and function correctly with real data, with **no runtime errors**.

### Real findings (all FIXED)

#### UF1 — Horizontal scroll on **desktop**: the whole layout could be dragged 248px sideways (MEDIUM) — FIXED
`styles.css` @1024px: `.app-main` had `width:100%` **and** `margin-left:248px`
(sidebar width), summing to 100%+248px and overflowing the viewport by exactly 248px.
The body scrolled horizontally into empty space on every screen.
**Fix:** `.app-main { width: calc(100% - var(--sidebar-w)); }`. Verified: desktop
`canScrollX` 248 → **0**, layout visually unchanged.

#### UF2 — Horizontal scroll on **mobile**: the top toolbar overflowed 41px on every tab (MEDIUM) — FIXED
`.topbar-actions` (the icon toolbar: AI-import, security, what's-new, guide, PIN, lock,
theme) was a non-wrapping flex row that ran 41px past a 390px screen, causing
sideways scroll throughout.
**Fix:** `.topbar-actions { flex-wrap: wrap; justify-content: flex-end; min-width: 0; }`
so the icons wrap/shrink instead of overflowing. Verified: mobile `canScrollX` 41 → **0**
across all 8 tabs.

#### UF3 — Modals had no dialog semantics for screen readers (LOW–MEDIUM, a11y) — FIXED
All **7** overlays (`editModal`, `onboardingModal`, `pinOverlay`, `encryptOverlay`,
`guideModal`, `whatsNewModal`, `splitModal`) were plain `<div class="modal-overlay">`
with no `role`/`aria-modal`, so assistive tech didn't announce them as dialogs.
**Fix:** added `role="dialog" aria-modal="true"` to all 7. Verified 7/7.

#### UF4 — Two form controls lacked accessible names (LOW, a11y) — FIXED
`bulkImportTypeSelect` (a bare `<select>`) and the visually-hidden `importFile`
file input had no label/aria-label.
**Fix:** added `aria-label` to both. Verified 0 unlabeled visible inputs remain.
(The other two flagged inputs were `editType`/`editIndex` **hidden** inputs — correctly
need no label.)

### Verified GOOD in the populated UI (no change)
- Dashboard math is correct with real data (Money in/out, Net, Safe-to-spend, Top
  category, Biggest expense, To-review count).
- Edit modal opens from a row with all fields wired; sort headers (`data-sort`) work;
  Review/Edit/Copy/Delete actions all present.
- Mobile already converts data tables to stacked cards (≤720px) — good responsive
  pattern; the hidden `thead` is clipped, not a visible overflow.
- Icon toolbar buttons **already** carry `aria-label`s; images have `alt`; `<html lang>`
  is set; `prefers-reduced-motion` is respected.
- No console/runtime errors on any tab, populated, on either viewport.

All UI fixes are CSS/markup only, verified by re-rendering both viewports, and do not
touch the crypto or the API hardening (security checks still 18/18 + 4/4 crypto after).
