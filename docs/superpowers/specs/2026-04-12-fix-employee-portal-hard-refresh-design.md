# Fix Employee Portal Hard Refresh 404

**Date:** 2026-04-12
**Status:** Approved

## Problem

When a user hard-refreshes (Cmd+Shift+R) on any deep route (e.g., `/employee/portal`), the page goes blank with 404 errors for all JS/CSS assets. The browser requests assets from `/employee/assets/index-xxx.js` instead of `/assets/index-xxx.js`.

**Root cause:** `base: './'` in `vite.config.ts:51` (introduced in PR #431 for Capacitor native app support) produces relative asset paths in the built `index.html`. When Vercel rewrites a deep route to `/index.html`, the browser resolves `./assets/...` relative to the current URL path, producing incorrect paths like `/employee/assets/...`.

This affects **every deep route** on hard refresh, not just `/employee/portal`.

## Solution

Make the Vite `base` setting conditional using an environment variable:

- **Web builds** (`npm run build`): `base: '/'` — absolute paths, works on all routes
- **Capacitor builds** (`npm run build:mobile`): `base: './'` — relative paths, required for `file://` protocol

### Changes

**`vite.config.ts:51`**
```typescript
// Before
base: './',

// After
base: process.env.CAPACITOR_BUILD === 'true' ? './' : '/',
```

**`package.json` — `build:mobile` script**
```json
// Before
"build:mobile": "mv .env.local .env.local.bak 2>/dev/null; npm run build; EXIT=$?; ..."

// After
"build:mobile": "mv .env.local .env.local.bak 2>/dev/null; CAPACITOR_BUILD=true npm run build; EXIT=$?; ..."
```

### CI/CD Impact

None. All automated platforms (Vercel, Netlify, Lovable, GitHub Actions) run `npm run build` without `CAPACITOR_BUILD` set, so they get `base: '/'` — the correct default. Only local `npm run build:mobile` sets the env var.

## Testing

1. Run `npm run build` and verify `dist/index.html` has absolute asset paths (`/assets/...`)
2. Run `CAPACITOR_BUILD=true npm run build` and verify `dist/index.html` has relative asset paths (`./assets/...`)
3. Start dev server, navigate to `/employee/portal`, hard refresh — page loads correctly
4. Unit test for the conditional base logic
