# Retire bun — `package-lock.json` as the single source of truth

**Date:** 2026-07-27
**Branch:** `chore/retire-bun-lockfiles`
**Status:** Approved (owner chose full retirement + Coolify flagged in PR body)

## Problem

The repo tracks **three** lockfiles for one dependency tree:

| File | Last touched | `package.json` commits since |
|---|---|---|
| `package-lock.json` | 2026-07-06 (#584) | in sync |
| `bun.lock` (text) | 2026-06-02 `198c2dab "Work in progress"` | 3 |
| `bun.lockb` (binary) | 2025-09-15 `d970094e` | **39** |

`README.md` documents bun as a first-class install path (lines 82, 123, 134, 151),
so a new contributor following the README resolves dependencies from a lockfile
that is 3–39 `package.json` commits behind. Any host that auto-detects a bun
lockfile builds from that same stale tree.

Modern bun writes the text `bun.lock` and ignores `bun.lockb`, so `bun.lockb` is
pure dead weight — it has not been read by any bun version in use since the text
format became the default.

## Why retire rather than refresh

- **CI never exercises bun.** All three npm jobs in `.github/workflows/unit-tests.yml`
  (lines 34, 127, 209) run `npm ci` on Node 20. No workflow, and no other file in
  `.github/`, mentions bun at all. A refreshed bun lockfile would remain unverified
  on every PR and drift again immediately.
- **Refreshing does not fix the root cause.** Two lockfiles for one `package.json`
  drift by construction; only one of them is gated by CI. Refreshing buys a few
  weeks and restores the same failure mode.
- **`package-lock.json` is already the maintained artifact** and is what CI, and
  therefore every merge gate, actually installs from.

## Decision

Full retirement of bun as a supported package manager.

### Changes

1. **Delete** `bun.lock` and `bun.lockb`.
2. **`README.md`** — four references:
   - L82 `Node.js 18+ or Bun` → `Node.js 20+` (matches CI's `node-version: '20'`)
   - L123 `bun install` / `# or` / `npm install` → `npm ci`
   - L134 `bun run dev` / `# or` / `npm run dev` → `npm run dev`
   - L151 Coolify Pre Deployment Command `bun install && bun run build`
     → `npm ci && npm run build`
3. **`trigger-bulk-pnl-recalc.ts:8`** — usage comment `bun run trigger-bulk-pnl-recalc.ts`
   → `npx tsx trigger-bulk-pnl-recalc.ts`.

### Note on the script's npm equivalent

`npm run` cannot execute a bare `.ts` file the way `bun run` can, and the repo has
no `tsx`/`ts-node` dependency. Node 20 also cannot strip types natively
(`--experimental-strip-types` arrived in Node 22.6). `npx tsx` is therefore the
accurate replacement — it fetches `tsx` on demand and needs no new dependency.
The script is dependency-free (plain `fetch` + `console.log`), so this runs clean.

### `npm ci` vs `npm install` in the README

The brief suggested `npm ci`. Adopted deliberately: `npm ci` installs exactly the
locked tree and fails loudly if `package-lock.json` and `package.json` disagree.
That is the property being restored here, and it is what CI runs.

## Out of scope

- Adding a `packageManager` field or `engines` to `package.json`. Worth doing, but
  it changes install behavior for everyone (Corepack) and belongs in its own PR.
- The hardcoded Supabase anon key in `trigger-bulk-pnl-recalc.ts`. Anon keys are
  public by design; unrelated to this change.

## Operational follow-up (cannot be done in this PR)

Editing README line 151 does **not** change the live Coolify configuration. If the
deployment's Pre Deployment Command is still `bun install && bun run build`, after
this merges bun will run with **no lockfile present** and resolve fresh semver
ranges on every deploy — strictly worse than today's stale-but-pinned state.

**Whoever owns the Coolify instance must update that command to
`npm ci && npm run build` in the Coolify UI.** This is called out explicitly in the
PR body.

## Verification

- `npm ci` from a clean worktree succeeds (proves `package-lock.json` alone is sufficient).
- `npm run build` succeeds.
- `npm run typecheck`, `npm run lint`, `npm run test` stay green.
- `grep -rniI 'bun' --exclude-dir=node_modules` returns no install/run references
  outside of "bundler"/"bundled" false positives and historical design docs.

## Design review (Phase 2.5)

Both reviewers skipped under the documented skip condition: this is a docs- and
lockfile-only change. No DB schema, RLS, RPC, edge function, or migration surface
(supabase reviewer); no component, dialog, form, page, or styling surface
(frontend reviewer). No files under `src/` or `supabase/` are touched.
