# 🛡️ BudgetVault

**Private budgeting that stays with you** · v2.1.0

BudgetVault is a privacy-first budgeting app you can install on **iPhone, iPad, Android, tablets, laptops, and desktop**. It works offline after install, keeps your budget on your device, and protects saved data with strong local encryption.

> **Privacy-first. Offline-first. Strong local encryption.**

> 🔐 **Security:** This build was security-tested, including a real offline brute-force attempt against an encrypted vault. The full write-up of what was tested and fixed is in **[`SECURITY.md`](SECURITY.md)**.

---

## 🆕 What's new in v2.1.0 — security hardening

A security-focused release. Your data and existing password keep working.

- 🔑 **Guessable passwords are now blocked.** Patterns like a word plus a year (`Football2019`) — which a real offline attack cracked in seconds during testing — are rejected. A 4-word passphrase is the easiest way to pass, and the strength meter now estimates how hard your password is to crack.
- 🧊 **Stronger, future-proof encryption.** PBKDF2 key stretching raised to **1,000,000 iterations**, with the derived key cached per session so saving stays fast. Older vaults open and upgrade automatically.
- 🌐 **New optional Online high-security mode.** Your own server takes part in unlocking, so a stolen local file **cannot be brute-forced offline at all**. Off by default. See below.
- 🤖 **Locked-down AI import.** The import endpoint now enforces its allowed origin and supports an optional shared secret, and the app explains exactly how to secure it.
- 📖 **In-app security guidance.** A plain-language explainer and password tips now live in the Security tab.

---

## 🆕 What's new in v2.0.0 — the redesign

Version 2.0.0 is a complete visual overhaul. The underlying budgeting engine, your saved data, encryption, and backups are **unchanged** — existing vaults load exactly as before — but the interface is rebuilt from the ground up.

- 🎨 **A calmer, premium "vault" interface.** A fixed sidebar on desktop and a thumb-friendly bottom bar on mobile, with a deep navy / electric-blue / chrome palette.
- 🎚️ **New Overview dashboard.** A combination-dial spending gauge shows how much of your cap you've used at a glance, alongside clearer **Money in / out / saved / net** figures.
- 🧠 **Plain-language Smart insights** now lead with the single most useful number: **what's safe to spend** for the rest of the cycle, after upcoming bills and your savings target.
- 🟢 **Friendlier colour.** Income is green, everyday spending is no longer alarm-red, and red is reserved for the moment you actually go over your cap.
- ✍️ **Clearer wording** throughout for spending caps, savings targets, category limits, and statement import.
- ♿ **Accessibility & polish:** stronger focus states, reduced-motion support, and a one-tap light/dark theme.

A full list of changes lives in [`handover/CHANGELOG_FULL.md`](handover/CHANGELOG_FULL.md).

---

## ✨ What BudgetVault does

- 💷 Track **money in** and **money out**
- 🧾 Add, edit, copy, split, and review transactions
- 🧭 Plan with weekly, bi-weekly, 4-weekly, or monthly cycles
- 🎯 Set spending caps, savings targets, per-category limits, and rollover budgets
- 📊 View charts, cycle comparisons, custom reports, and category trends — all drawn locally
- 🔒 Use password encryption, an optional screen-lock PIN, and encrypted backups
- 🤖 Optional AI bank-statement PDF import through your own Vercel/OpenAI setup
- 📱 Install as a PWA on mobile, tablet, and desktop

---

## 🔐 Privacy & security

BudgetVault is designed to be private by default:

- 🔑 Your password encrypts saved budget data on the device (AES-256-GCM, PBKDF2-SHA256 at 1,000,000 iterations)
- 🛡️ Optional screen-lock PIN can lock an already-open screen after inactivity
- 💾 Encrypted backup export is the safest backup option
- 🚫 No accounts · 🚫 No ads · 🚫 No tracking built into the app

### Password vs PIN

- **Password** = protects the saved encrypted data
- **PIN** = only locks the currently open app screen for that session

If you lose your password, encrypted BudgetVault data **cannot be recovered**.

### Strong password tip

Use either a **4-word passphrase** (easiest — e.g. four random unrelated words) or **16+ random characters**. Guessable patterns like a word plus a year (`Football2019`) are now **rejected**, because they can be cracked offline in seconds. Don't reuse a password from email, banking, or social apps.

---

## 🤖 Optional AI bank-statement import

BudgetVault can import PDF bank statements through a small **Vercel backend** that calls the **OpenAI API** using **your API key**. This feature is **off by default**, and you must confirm a privacy notice before each upload. It is the only feature that can ever send data off your device.

### What happens

1. You upload a PDF bank statement.
2. BudgetVault sends it to your Vercel Function.
3. The Function sends it to OpenAI using your secret API key.
4. OpenAI returns structured JSON.
5. BudgetVault shows a **review table** — nothing is imported automatically.
6. You fix anything that's wrong.
7. Only the rows you select are added to the vault.

### What gets imported

Money in → income · Money out → expenses · dates · merchant/description · suggested categories · confidence flags · possible-duplicate warnings.

### Learning from corrections

When you re-categorise an imported row, BudgetVault stores a simple local rule inside the encrypted budget, such as:

```text
TESCO → Groceries
NETFLIX → Subscriptions
```

Those rules are reused on future imports so repeated merchants are placed better next time.

---

## 📲 Install like an app

**iPhone / iPad:** open in **Safari** → **Share** → **Add to Home Screen**.
**Android:** open in **Chrome** or **Edge** → **Install app** / **Add to Home screen**.
**Desktop:** open in **Chrome** or **Edge** → use the install button in the address bar or menu.

---

## 🚀 Getting started

1. Open the app and create a strong password.
2. Run the setup wizard (or open it any time from **Plan → Setup wizard**).
3. Pick your budget cycle.
4. Add income and expenses.
5. Set a spending cap and a savings target.
6. Optionally turn on the screen-lock PIN in **Security**.
7. Export an encrypted backup once your setup is ready.

> **Tip:** To move money into savings, log it as an expense with the category **Savings**. It counts toward your savings progress and is deliberately *excluded* from your spending cap.

---

## 🌐 Make it live on GitHub Pages

This repo is GitHub Pages-ready for the standard PWA (everything except AI import, which needs a server for the API key).

1. Upload all files to a GitHub repo.
2. Go to **Settings → Pages**.
3. Set **Source** to **GitHub Actions**.
4. Push to the **main** branch and wait for the deploy workflow.

Your live URL will usually look like `https://YOUR-USERNAME.github.io/REPO-NAME/`.

---

## ⚙️ Enable AI import with Vercel + OpenAI

GitHub Pages can't safely store API keys, so AI statement import uses Vercel Functions.

### Option A — host the whole app on Vercel (simplest)

1. Push this repo to GitHub.
2. **Vercel → Add New Project → Import** the repo (keep default static settings).
3. Add environment variables:

```text
OPENAI_API_KEY=your OpenAI API key
OPENAI_MODEL=gpt-4.1-mini
ALLOWED_ORIGIN=https://your-vercel-project.vercel.app
IMPORT_SHARED_SECRET=a-long-random-string   # optional but recommended
```

4. Deploy, then open BudgetVault → **AI Import**. The endpoint should be `/api/parse-statement`. Tap **Test connection**.
   - If you set `IMPORT_SHARED_SECRET`, also enter the same value in **AI Import → Connection → Shared secret**.

### Option B — GitHub Pages frontend + Vercel API

1. Deploy the same repo to Vercel.
2. Set the same environment variables, but with `ALLOWED_ORIGIN=https://YOUR-USERNAME.github.io`.
3. Redeploy. In the GitHub Pages app, open **AI Import** and set the endpoint to `https://YOUR-VERCEL-PROJECT.vercel.app/api/parse-statement`. Tap **Test connection**.

> Small bank PDFs work best. Keep uploads under roughly **3.5 MB**.

### 🔒 Securing the AI endpoint

The import endpoint is a public URL that calls OpenAI with your key, so protect it in layers:

- **`ALLOWED_ORIGIN`** — rejects cross-site browser requests (now enforced server-side, not just CORS).
- **`IMPORT_SHARED_SECRET`** + the in-app **Shared secret** field — blocks any caller (including `curl`) without the matching key.
- **An OpenAI monthly spend limit** — the dependable backstop, since any public endpoint can be probed.
- **Keep the endpoint URL private.** Only the PDF and your category names are sent (to your server, then OpenAI); your encrypted budget is never sent.

---

## 🌐 Optional: Online high-security mode

By default BudgetVault is fully offline and your password is the only protection. Because an
attacker with the file could try to guess that password on their own hardware, you can
optionally require **your own server** to take part in unlocking — which makes offline
guessing of a stolen file **impossible**.

**How it works:** your key becomes `HMAC(server secret, PBKDF2(password, salt))`, where the
HMAC is computed by your `/api/pepper` endpoint. The server never sees your password or data
and holds no ciphertext, so it can't decrypt anything — but its secret is required for every
unlock attempt.

**Set it up:**

1. Deploy the repo to Vercel (the `/api/pepper` function is included).
2. Add an environment variable with a long random value:

```text
KDF_PEPPER=at-least-16-random-characters-keep-this-safe
```

3. In the app: **Security → Online high-security mode**, tick the box, set the endpoint to
   `https://YOUR-VERCEL-PROJECT.vercel.app/api/pepper` (or `/api/pepper` if the app is hosted
   on the same Vercel project), and tap **Apply encryption mode**.

**Important:**
- Unlocking now needs the server reachable (edits still save offline afterwards).
- If `KDF_PEPPER` is **lost or changed**, online-mode data **cannot be recovered** — export a
  **plain backup** and keep it somewhere safe before enabling.
- A custom endpoint not on `*.vercel.app` requires editing the `connect-src` line of the
  Content-Security-Policy in `index.html`.

---

## 🧪 Test checklist

After deploying: app opens · password setup/unlock works · sidebar (desktop) and bottom nav (mobile) switch tabs · add income/expense works · the Overview dial and figures update · charts render · encrypted backup exports · AI Import → Test connection works · PDF upload returns transactions · review table edits work · selected rows import · category corrections appear under Import learning.

---

## 🔄 Publishing updates

BudgetVault ships a what's-new sheet, an update banner, service-worker cache updates, and `app-meta.json` release notes. When you publish a new version, bump it in **all four** places:

- `app.js` (`CURRENT_APP_VERSION`)
- `app-meta.json`
- `package.json`
- `sw.js` (`CACHE_VERSION`)

Run `npm test` first — it syntax-checks `app.js`, `sw.js`, and both API functions.

---

## 🏦 How savings work

- **Savings target** is the goal you want to reach this cycle.
- **Already saved** is an editable starting total for what you currently hold.
- Any transaction categorised as **Savings** adds to your savings progress automatically.
- Savings transfers are kept separate from normal spending, so moving money into savings never makes your spending cap look wrong.

---

## ❤️ BudgetVault at a glance

**Privacy-first budgeting with offline access, strong local encryption, secure backups, AI-assisted statement import, and flexible planning for real life — now with a completely redesigned interface.**
