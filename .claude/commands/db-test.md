---
description: Reset local database and run pgTAP tests
---

# Database Tests

## Current State
- Branch: !`git branch --show-current`
- Migration count: !`ls -1 supabase/migrations/*.sql 2>/dev/null | wc -l | tr -d ' '`
- Test count: !`ls -1 supabase/tests/*.sql 2>/dev/null | wc -l | tr -d ' '`

## Steps

1. Reset the database with latest migrations: `npm run db:reset`
2. Run pgTAP tests: `npm run test:db`
3. Report results with pass/fail counts

If reset fails, check if Supabase is running (`supabase status`) and start it if needed (`npm run db:start`).
