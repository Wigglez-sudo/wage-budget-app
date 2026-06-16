# Budget Tracker Pro PWA

A mobile-first encrypted budget tracker PWA for iOS and Android.

## What changed in this UI overhaul

- Full mobile-first visual redesign with a hero header, glass-style panels, larger touch targets, bottom mobile navigation, and card-based transaction rows on phones.
- Cleaner budget selector, filter controls, add-income/add-expense panels, backup area, reminders, and yearly report layout.
- Refreshed PWA icons and offline page.
- Service worker cache version bumped so hosted installs should pick up the new interface.
- Fixed the CSV export JavaScript newline issue while rebuilding the interface.

## Files

- `index.html` — the full app, styles, and app logic.
- `manifest.webmanifest` — PWA install metadata.
- `sw.js` — service worker/offline caching.
- `offline.html` — fallback page.
- `icons/` — Android/iOS app icons.

## Install / host

Upload the folder to any HTTPS static host such as GitHub Pages, Netlify, Vercel, or Cloudflare Pages.

- Android/Chrome: open the hosted URL and use the install prompt or browser menu → Install app.
- iOS/iPadOS: open in Safari → Share → Add to Home Screen.

## Notes

The app stores encrypted data in the browser/device local storage. Always export a JSON backup before clearing browser data, changing hosting URLs, or reinstalling the PWA.
