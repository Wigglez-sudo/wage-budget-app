# BudgetVault

Encrypted budget tracker PWA for iPhone, iPad, Android, tablets, laptops, and desktop browsers.

## Security-hardened build

This build focuses on safer defaults for both mobile and PC use.

### What changed

- Removed the third-party Chart.js CDN dependency. Charts now render locally with built-in canvas code.
- Moved the app code into local `app.js` and `styles.css`.
- Added a Content Security Policy in `index.html`.
- Removed inline `onclick` handlers and switched to event listeners.
- Replaced password-change browser prompts with proper password fields inside the app.
- Added password-strength guidance and stronger password enforcement during setup and password changes.
- Added encrypted backup export as the safest backup option.
- Kept plain JSON and CSV export, but added warnings because they are readable files.
- Added privacy controls for reminders:
  - notifications are off by default
  - you can hide amounts in notifications
- Tightened the service worker so it only caches the known app shell files.
- Kept the optional session PIN screen lock, with timeout and background locking.

## Password vs PIN

- The **password** encrypts the saved data.
- The **PIN** only locks the already-open screen for the current session.
- The PIN is never stored and is forgotten when the app closes or reloads.
- After 5 wrong PIN attempts, the app falls back to full password unlock.

If you lose the password, the encrypted data cannot be recovered.

## Strong password advice

Use one of these:

- a long passphrase with **4 random words**
- or **16+ unique characters** with a mix of letters, numbers, and symbols

Do **not** reuse a password from email, banking, social apps, or anywhere else.

A password manager is the best place to store it.

## Backups

Recommended:
- **Export Encrypted Backup**

Less safe:
- **Export Plain JSON**
- **Export CSV**

Plain JSON and CSV files are readable by other apps, cloud sync services, and anyone who opens them. Delete them when you no longer need them.

## Hosting advice

Use:
- HTTPS
- a dedicated origin/subdomain for this app only

Avoid hosting this app on the same origin as unrelated tools or sites.

Good static hosts include GitHub Pages, Netlify, Vercel, Cloudflare Pages, or your own HTTPS server.

## Local testing

Serve the folder instead of opening `index.html` directly:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## Install

### iPhone / iPad

Open the hosted site in Safari, tap Share, then Add to Home Screen.

### Android

Open the hosted site in Chrome or Edge, then use Install app or Add to Home screen.

### Desktop

Open the hosted site in Chrome or Edge, then install it from the address bar or browser menu. The session PIN is especially useful on desktop if the app stays open.


## New in the finished build

- setup guide / onboarding
- edit and duplicate transactions
- split one expense into two categories
- mark all income or expenses reviewed
- cycle compare report
- custom date-range report
- optional category rollover budgeting
- update banner for new PWA versions


## Final polish extras

- in-app **How to use** guide
- **What's new** splash and changelog preview
- published version check via `app-meta.json`
- clearer update messaging for GitHub Pages deployments

### GitHub Pages auto-update note

This build checks `app-meta.json` with `cache: "no-store"` and also keeps the normal service worker update flow.

That means when you push a new build to GitHub Pages and the deployed files update:

- the app can spot the newer published metadata
- show release notes / "What's new"
- prompt the user to refresh if a newer build is available

For the cleanest results, bump the version in `app-meta.json` and `app.js` whenever you publish a new build.


## GitHub-ready deployment included

This ZIP now includes a ready-to-use GitHub Pages workflow at:

```text
.github/workflows/deploy-pages.yml
```

### To put it live for end users

1. Create a GitHub repository.
2. Upload **all files and folders from this ZIP** to the root of the repository.
3. In GitHub, go to **Settings -> Pages**.
4. Under **Build and deployment**, set **Source** to **GitHub Actions**.
5. Make sure your main branch is named **main**.
6. Push or commit the files.
7. Wait for the **Deploy BudgetVault** workflow to finish in the **Actions** tab.
8. Your live site will appear in **Settings -> Pages**.

### Publishing future updates

For each update, replace the repo files with the newer build and push again.
This app already includes:

- `app-meta.json` for published version notes
- a service worker update banner
- an in-app changelog / What's new flow

When a new build is pushed and deployed, end users will be prompted to refresh into the latest version.

### End-user install

- **iPhone / iPad:** open in Safari -> Share -> Add to Home Screen
- **Android:** open in Chrome/Edge -> Install app / Add to Home screen
- **Desktop:** open in Chrome/Edge -> install from the address bar or browser menu
