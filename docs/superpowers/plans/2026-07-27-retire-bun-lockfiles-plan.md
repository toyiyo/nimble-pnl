# Plan: Retire bun — `package-lock.json` as single source of truth

**Design:** `docs/superpowers/specs/2026-07-27-retire-bun-lockfiles-design.md`
**Branch:** `chore/retire-bun-lockfiles`

## Tasks

### 1. Delete the two bun lockfiles
- `git rm bun.lock bun.lockb`
- Commit: `chore(deps): remove bun.lock and bun.lockb`

### 2. Update `README.md` (4 references)
- L82 `Node.js 18+ or Bun` → `Node.js 20+`
- L121-126 install block → single `npm ci`
- L132-137 dev-server block → single `npm run dev`
- L151 Coolify Pre Deployment Command → `npm ci && npm run build`
- Commit: `docs(readme): npm as the documented install path`

### 3. Update `trigger-bulk-pnl-recalc.ts` usage comment
- L8 `bun run trigger-bulk-pnl-recalc.ts` → `npx tsx trigger-bulk-pnl-recalc.ts`
- Commit: folded into task 2's commit (one-line doc comment)

### 4. Sweep for missed references
- `grep -rniI 'bun' --exclude-dir=node_modules --exclude-dir=.git .`
- Confirm remaining hits are only `bundler`/`bundled`/`bunch` false positives and
  historical design docs (which are point-in-time records, not instructions —
  leave them).

## Verification (Phase 8)

No test file changes: this task adds no behavior. The E2E coverage gate is
satisfied by the **justified exception** clause — this is a docs- and
lockfile-only change with no user-facing behavior and no cross-layer seam.
The meaningful verification is that the npm-only path works end to end:

| Check | Why it matters here |
|---|---|
| `npm ci` from clean worktree | Proves `package-lock.json` alone is sufficient — the core claim |
| `npm run build` | Proves the documented Coolify command works |
| `npm run typecheck` | `trigger-bulk-pnl-recalc.ts` is a `.ts` file being edited |
| `npm run lint` | Same |
| `npm run test` | Regression guard; no source changed, must stay green |

`npm run test:db` and `npm run test:e2e` are not run: neither exercises package
management or the edited files, and both require a running local Supabase stack.

## Risks

- **Coolify still configured for bun.** After merge, `bun install` would run with
  no lockfile and resolve fresh semver ranges. Mitigation: called out in the PR
  body as a required manual follow-up in the Coolify UI. Cannot be fixed from
  this repo.
- **A contributor with muscle-memory `bun install`.** Post-merge, bun would
  generate a fresh untracked `bun.lock`. Acceptable — it resolves from the same
  `package.json` and is no longer tracked or documented.
