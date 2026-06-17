# BudgetVault — Security Testing & Fixes (v2.1.0)

This document explains how BudgetVault protects your data, the attacks that were
run against it, the weaknesses those attacks revealed, and exactly what was changed
to fix them. It is written to be read start to finish — no security background needed.

---

## 1. What BudgetVault is, in security terms

BudgetVault keeps your entire budget **on your own device**. Nothing is uploaded in
normal use. The data is stored **encrypted at rest** so that if someone copies the
file off your device (stolen laptop, a backup that syncs to the cloud, a shared
computer), they still cannot read it without your password.

- **Cipher:** AES-256-GCM (authenticated encryption).
- **Key derivation:** PBKDF2-HMAC-SHA256, **1,000,000 iterations**, 16-byte random salt.
- **Where the key lives:** derived from your password in memory only; never written to disk.
- **What's stored:** one encrypted blob in the browser's local storage. Everything else
  in storage is non-sensitive settings (theme, last tab, lock timeout).

The single most important fact: **your password is the whole defence.** There is no
recovery, no backdoor, and no second factor in the default (offline) mode. So the
audit focused on the question that actually matters — *if an attacker gets the
encrypted file, how hard is it to break?*

---

## 2. How the app was attacked

To test this honestly, the app's exact encryption was re-implemented in Node.js using
the same Web Crypto primitives (same algorithm, same iteration count, same envelope
format). A vault was then sealed with a password **that the attacking script was never
told**, and a separate "cracker" script was pointed at *only the sealed file*. The
cracker tried passwords from a prioritised dictionary with the usual mangling rules
(capitalisation, append a year, append `!`/`123`) — exactly what real password-cracking
tools do — and confirmed each guess using the GCM authentication tag.

This is a faithful offline brute-force: the cracker only ever saw what an attacker who
stole the file would see.

### The result that drove these fixes

| Vault password | Passes the *old* policy? | Outcome |
|---|---|---|
| `Football2019` (word + year) | ✅ Yes | ❌ **Cracked in 184 guesses (~17 seconds)** on a single CPU thread |
| `otter lantern copper meadow` (4 random words) | ✅ Yes | ✅ Not cracked — dictionary space exhausted |

The machine used managed about **11 guesses/second** at 600,000 iterations. That
slowness is deliberate and is what protects a strong password. But it does **not** save
a weak one: `Football2019` fell almost instantly because it sits near the top of any
cracking dictionary. On a GPU rig (tens of thousands of guesses/second) it would be
effectively instant.

**Conclusion:** the cryptography was sound; the weak link was that the app *allowed
guessable passwords in the first place.*

---

## 3. Findings and fixes

### Finding 1 — Weak passwords were accepted (HIGH) — FIXED
The old strength check passed a password if it was ≥12 characters and hit a simple
points threshold, which let through `Football2019`, `Sunshine2024`, `Password123!`, etc.

**Fix:** replaced it with an **entropy-based evaluator** that estimates how hard the
password actually is to guess and *rejects* anything too weak:
- It estimates effective bits of entropy from the character set and length.
- It applies penalties for the patterns crackers exploit: common words, a single word
  followed by digits/symbols (the "word + year" pattern), keyboard runs, repeats, and
  all-digit PINs.
- A password is only accepted at **≥70 effective bits and length ≥12**.
- A passphrase of **4 random words** clears this easily and is recommended in the UI.

This was checked against 16 representative passwords (8 weak, 8 strong) and behaves
correctly on all of them — every "word + year/symbol" variant is now rejected, while
real passphrases and long random strings pass. The strength meter also shows an
estimated bit-strength so the choice is transparent.

### Finding 2 — GPU-cheap key stretching with no upgrade path (MEDIUM) — FIXED
The key was stretched with PBKDF2 at 600,000 iterations and the iteration count was
hard-coded, so it could never be raised without locking people out.

**Fix:**
- Raised PBKDF2 to **1,000,000 iterations**.
- The encrypted envelope now records its own KDF parameters (`v`, `kdf`, `iterations`,
  `mode`), so the cost can be raised again in future and **older vaults still open**.
- The derived key is now **cached for the session**, so raising the cost does **not**
  slow down routine saving — PBKDF2 runs only when you unlock, set, or change your
  password, not on every edit.
- Vaults written with a lower iteration count are **upgraded automatically** the next
  time they're saved (verified: a 600k vault opens, upgrades to 1,000,000, and re-opens
  with no lockout).

PBKDF2 is still GPU-parallel by nature, which is why **Finding 1 (a strong password)
matters most** — and why the optional server-pepper mode below exists for people who
want to remove offline guessing entirely.

### Finding 3 — The AI-import endpoint could be abused (MEDIUM) — FIXED
The optional statement-import endpoint runs on a public URL and calls OpenAI with your
API key. Two problems: it defaulted to allowing any origin, and it only *set* a CORS
header without actually rejecting disallowed callers — so anyone who learned the URL
could run up your OpenAI bill.

**Fix:**
- The server now **enforces `ALLOWED_ORIGIN`**: cross-origin browser requests are
  rejected with `403`, not merely un-shared by CORS.
- Added an optional **shared secret** (`IMPORT_SHARED_SECRET`): when set, every request
  must present the matching `x-budgetvault-key` header or get `403`. The app sends it
  automatically when you enter it in settings.
- The health check no longer discloses the model name.
- See section 6 for the full list of things **you** can do to lock it down.

### Finding 4 — The PIN is a screen lock, not encryption (LOW / by design) — DOCUMENTED
The in-app PIN hides the open screen on a device that's already unlocked. It does **not**
add a second layer of encryption, and the decrypted data stays in memory while the
screen is locked. This is intentional (it's a convenience lock), and it is now stated
plainly both here and inside the app so it isn't mistaken for data protection. The PIN
is never written to storage.

### Finding 5 — Plain exports are unencrypted (LOW / by design) — MITIGATED
"Export plain JSON" and "Export CSV" produce readable files on purpose (for spreadsheets
or migrating out). Both already require an explicit confirmation that warns the file is
readable by anything. The **encrypted backup** is the safe option for routine backups.

---

## 4. What was already solid (positive findings)

These were checked and found to be correct — no change needed:

- **No cross-site scripting (XSS).** Every place user text is put into the page escapes
  it (or uses text nodes / numeric values). On top of that, the Content-Security-Policy
  is strict — `script-src 'self'` with no inline scripts — so even injected markup can't
  run code.
- **Authenticated encryption.** AES-GCM verifies an authentication tag, so a wrong
  password fails cleanly: there's no padding-oracle and no way to be silently served
  tampered data.
- **CSV formula-injection is blocked.** Cells beginning with `= + - @` are quoted, so a
  malicious transaction description can't execute when the CSV is opened in a spreadsheet.
- **No server-side request forgery (SSRF).** The import endpoint only ever calls OpenAI;
  it doesn't fetch arbitrary URLs.
- **No plaintext leakage.** The budget is only ever persisted encrypted; the password and
  derived key are kept in memory and cleared on lock.

---

## 5. Online high-security mode (new, optional)

Even with a strong password, *offline* guessing is theoretically possible because the
attacker has the file and can try passwords on their own hardware forever. **Online
high-security mode removes that possibility.**

**How it works.** When enabled, your encryption key becomes:

```
key = HMAC-SHA256( server_secret_pepper , PBKDF2(password, salt) )
```

The HMAC is computed by **your own** `/api/pepper` endpoint, which holds a secret
(`KDF_PEPPER`) that never leaves the server. The browser only sends the PBKDF2 output (a
slow hash) and gets back the final key.

**Why it's stronger.**
- The server **never sees your password or your data** and holds no ciphertext, so it
  **cannot decrypt anything**.
- An attacker who copies the local file **cannot brute-force it at all** — every single
  guess now requires a call to your server, which you can rate-limit, monitor, or take
  offline. This was verified: an online-mode vault could **not** be decrypted from the
  file alone *even with the correct password*.

**Trade-offs (read before enabling).**
- **Unlocking requires your server to be reachable.** After you unlock, ordinary edits
  still save offline.
- **No recovery if the secret is lost.** If `KDF_PEPPER` is lost or changed, online-mode
  data cannot be decrypted. Export a plain backup and store it safely *before* enabling.
- **Endpoint reachability / CSP.** The app's Content-Security-Policy allows calls to the
  same origin and to `*.vercel.app`. A custom endpoint on another domain requires editing
  the `connect-src` line in `index.html`.

It is **off by default**; the default offline mode is unchanged.

---

## 6. AI import endpoint — risks and what you can do

The statement-import feature is the only thing that can ever send data off your device,
and only when you turn it on and confirm each upload. It runs on a public serverless URL
and uses your OpenAI key. The honest reality of any public endpoint is that anyone who
learns the URL can send requests to it, so protect it in layers:

1. **Set `ALLOWED_ORIGIN`** (on Vercel) to your app's address. Browser requests from
   other sites are then rejected. *Server-side.*
2. **Set `IMPORT_SHARED_SECRET`** (on Vercel) and enter the same value in
   *Import → Connection → Shared secret*. Requests without the matching header — including
   `curl` from someone who guessed the URL — get `403`. *Strongest single control.*
3. **Set a hard monthly spend limit in your OpenAI account.** This is the real backstop:
   even if someone probes the endpoint, your exposure is capped.
4. **Keep the endpoint URL private.** Treat it like a secret; don't post it publicly.
5. **Know what's sent:** only the statement PDF and your category names, to *your* server
   and then OpenAI. The endpoint does not log or store the PDF, and your encrypted budget
   is never sent.

All of this guidance is also shown inside the app, in the Import tab.

---

## 7. Honest limitations

- **A weak password still loses, in offline mode.** The new policy prevents the worst
  cases, but no client-side encryption can protect a genuinely guessable secret. Use a
  passphrase, or enable online mode.
- **The PIN is not encryption** (see Finding 4).
- **Plain exports are readable** by design (see Finding 5).
- **A public AI endpoint can always be sent requests.** Origin and secret checks raise the
  bar a lot, but OpenAI spend limits are the dependable safety net.
- **Online mode depends on a secret you must not lose.** Keep a plain backup.

---

## 8. Deployment hardening checklist

- [ ] Choose a **4-random-word passphrase** (or 16+ random characters).
- [ ] Keep an **encrypted backup**; if you use online mode, also keep one **plain** backup
      somewhere safe.
- [ ] On Vercel, set **`ALLOWED_ORIGIN`** to your site.
- [ ] On Vercel, set **`IMPORT_SHARED_SECRET`** and enter it in the app (if you use import).
- [ ] In OpenAI, set a **monthly spend cap** (if you use import).
- [ ] For online high-security mode: deploy **`/api/pepper`** and set a long random
      **`KDF_PEPPER`** (16+ characters), and back that value up.
- [ ] Serve only over **HTTPS** (Vercel/GitHub Pages do this by default).

---

## 9. Reproducing the tests

The methodology is repeatable by re-implementing `deriveKey`/`encryptData`/`decryptData`
from `app.js` in Node's Web Crypto, sealing a vault with a hidden password, and pointing a
dictionary cracker at only the sealed blob. The crypto changes here were validated with
Node test scripts covering: the offline and online round-trips, wrong-password rejection,
the "online file is not crackable without the server pepper" property, legacy-vault
decryption, and the automatic 600k → 1,000,000 upgrade (no lockout). All passed.
