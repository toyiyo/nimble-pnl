---
description: Run full verification suite (tests + lint + build) with evidence
---

# Full Verification

Run ALL verification steps and report actual output for each. Never claim "tests pass" without evidence.

## Steps

1. **Symlink env** (if in worktree):
   ```bash
   for envfile in .env.local .env.development.local .env.test.local; do
     if [ -f "$PROJECT_ROOT/$envfile" ] && [ ! -e "$envfile" ]; then
       ln -s "$PROJECT_ROOT/$envfile" "$envfile"
     fi
   done
   ```
   Where `$PROJECT_ROOT` is the main repo root (not the worktree).

2. **Unit tests**: `npm run test`
3. **DB tests**: `npm run test:db`
4. **E2E tests**: `npm run test:e2e`
5. **Lint**: `npm run lint`
6. **Build**: `npm run build`

## Reporting

For each step, show:
- Command run
- Exit code
- Key output (pass counts, error messages)

If ANY step fails, stop and report the failure clearly. Do not proceed to claim completion.
