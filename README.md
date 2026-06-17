# 🛡️ BudgetVault

**Private budgeting that stays with you**

BudgetVault is a privacy-first budgeting app you can install on **iPhone, iPad, Android, tablets, laptops, and desktop**. It works offline after install, stores your budget on your device, and protects saved data with strong local encryption.

> **Privacy-first. Offline-first. Strong local encryption.**

---

## ✨ What BudgetVault does

- 💷 Track **money in** and **money out**
- 🧾 Add, edit, copy, split, and review transactions
- 🧭 Plan with weekly, bi-weekly, 4-weekly, or monthly cycles
- 🎯 Set spending limits, savings targets, category limits, and rollover budgets
- 📊 View charts, cycle comparisons, custom reports, and category trends
- 🔒 Use password encryption, optional session PIN, and encrypted backups
- 🤖 Optional AI bank-statement PDF import through your own Vercel/OpenAI setup
- 📱 Install as a PWA on mobile, tablet, and desktop

---

## 🔐 Privacy & security

BudgetVault is designed to be private by default:

- 🔑 Your password encrypts saved budget data on the device
- 🛡️ Optional session PIN can lock an already-open screen after inactivity
- 💾 Encrypted backup export is the safest backup option
- 🚫 No accounts required
- 🚫 No ads
- 🚫 No tracking built into the app

### Password vs PIN

- **Password** = protects the saved encrypted data
- **PIN** = only locks the currently open app screen for that session

If you lose your password, encrypted BudgetVault data cannot be recovered.

### Strong password tip

Use either:

- a **4-word passphrase**, or
- **16+ unique characters**

Do not reuse a password from email, banking, social apps, or other accounts.

---

## 🤖 Optional AI bank-statement import

BudgetVault can import PDF bank statements through a small **Vercel backend** that calls the **OpenAI API** using **your API key**.

This feature is **off by default** and users must confirm the privacy notice before uploading a statement.

### What happens

1. User uploads a PDF bank statement.
2. BudgetVault sends it to your Vercel Function.
3. The Vercel Function sends it to OpenAI using your secret API key.
4. OpenAI returns structured JSON.
5. BudgetVault shows a review table.
6. User fixes anything wrong.
7. Only selected transactions are added to the vault.

### What gets imported

- Money in → income/wages
- Money out → expenses
- Dates
- Merchant/description
- Suggested categories
- Confidence flags
- Possible duplicate warnings

### Learning from corrections

When a user corrects a category, BudgetVault stores a simple local rule inside the encrypted budget, such as:

```text
TESCO → Groceries
NETFLIX → Subscriptions
```

Those rules are sent with future imports so repeated merchants are placed better next time.

---

## 📲 Install like an app

### iPhone / iPad

1. Open BudgetVault in **Safari**
2. Tap **Share**
3. Tap **Add to Home Screen**

### Android

1. Open BudgetVault in **Chrome** or **Edge**
2. Tap **Install app** or **Add to Home screen**

### Desktop

1. Open BudgetVault in **Chrome** or **Edge**
2. Use the install button in the address bar or browser menu

---

## 🚀 Getting started as a user

1. Open the app
2. Create a strong password
3. Follow the setup guide
4. Pick your budget cycle
5. Add income and expenses
6. Set spending limits and savings targets
7. Optionally turn on session PIN lock
8. Export an encrypted backup when your setup is ready

---

## 🌐 Make it live on GitHub Pages

This repo is still GitHub Pages-ready for the normal PWA.

1. Upload all files to a GitHub repo
2. Go to **Settings → Pages**
3. Set **Source** to **GitHub Actions**
4. Push to the **main** branch
5. Wait for the deploy workflow to finish

Your live URL will usually look like:

```text
https://YOUR-USERNAME.github.io/REPO-NAME/
```

---

## ⚙️ Enable AI import with Vercel + OpenAI

GitHub Pages cannot safely store API keys, so AI statement import uses Vercel Functions.

### Option A — easiest: host the whole app on Vercel

Use this if you want one live URL and the simplest setup.

1. Push this repo to GitHub.
2. Go to **Vercel → Add New Project**.
3. Import the GitHub repo.
4. Keep the default static/project settings.
5. Add environment variables:

```text
OPENAI_API_KEY=your OpenAI API key
OPENAI_MODEL=gpt-4.1-mini
ALLOWED_ORIGIN=https://your-vercel-project.vercel.app
```

6. Deploy.
7. Open BudgetVault → **AI Import**.
8. Endpoint should be:

```text
/api/parse-statement
```

9. Tap **Test connection**.

### Option B — GitHub Pages frontend + Vercel API

Use this if your BudgetVault app remains on GitHub Pages.

1. Deploy the same repo to Vercel.
2. In Vercel environment variables, set:

```text
OPENAI_API_KEY=your OpenAI API key
OPENAI_MODEL=gpt-4.1-mini
ALLOWED_ORIGIN=https://YOUR-USERNAME.github.io
```

3. Redeploy.
4. Open the GitHub Pages BudgetVault app.
5. Go to **AI Import**.
6. Set the endpoint to:

```text
https://YOUR-VERCEL-PROJECT.vercel.app/api/parse-statement
```

7. Tap **Test connection**.

> Tip: Small bank PDFs work best. Keep uploads under roughly **3.5 MB** for the first version.

---

## 🧪 Test checklist

After deploying, test:

- ✅ app opens
- ✅ password setup/unlock works
- ✅ tabs work on mobile/tablet/desktop
- ✅ add income works
- ✅ add expense works
- ✅ charts render
- ✅ encrypted backup exports
- ✅ AI Import → Test connection works
- ✅ PDF upload returns transactions
- ✅ review table lets you edit category/date/amount/type
- ✅ selected rows import into the vault
- ✅ category corrections appear under Import learning

---

## 🔄 Updates

BudgetVault includes:

- 🆕 What’s new splash screen
- 🔄 update banner
- 📦 service worker cache updates
- 🧾 `app-meta.json` release notes

When you publish a new version, bump the version in:

- `app.js`
- `app-meta.json`
- `package.json`
- `sw.js` cache name

---

## ❤️ BudgetVault at a glance

**Privacy-first budgeting with offline access, strong local encryption, secure backups, AI-assisted statement import, and flexible planning for real life.**
