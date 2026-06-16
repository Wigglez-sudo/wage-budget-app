# Budget Tracker Pro PWA

This is a mobile-ready Progressive Web App version of the uploaded Budget Tracker Pro single-file app.

## What changed

- Added `manifest.webmanifest` for Android/Chrome installability and app identity.
- Added `sw.js` service worker for offline app-shell caching.
- Added PNG icons for Android, iOS and maskable launchers.
- Added iOS metadata and Apple touch icon.
- Added an install/help banner for Android and iOS.
- Added mobile layout improvements, safe-area padding, larger touch targets and offline badge.
- Fixed the reviewed high-risk bugs: wrong unlock/setup flow after PIN lock, non-awaited encrypted saves, Notification unsupported-browser crash, recurring reminder date issues, basic HTML escaping, CSV escaping, import validation and Chart.js guards.

## Hosting

PWAs need HTTPS, except on `localhost` while developing. Upload this folder to any static host such as GitHub Pages, Netlify, Vercel, Cloudflare Pages or your own HTTPS web server.

## Install on Android

Open the hosted URL in Chrome/Edge. After the service worker and manifest are detected, use the browser install prompt or menu → Install app / Add to Home screen.

## Install on iPhone/iPad

Open the hosted URL in Safari, tap Share, then Add to Home Screen. iOS does not use the same automatic install prompt as Android, so the app includes an iOS help banner.

## Important notes

- Data is stored locally in the browser using encrypted localStorage. Deleting browser/site data deletes the app data.
- Export JSON backups regularly.
- Chart.js still loads from CDN. Once loaded online, the service worker can cache it. The app itself still works if charts are unavailable.
