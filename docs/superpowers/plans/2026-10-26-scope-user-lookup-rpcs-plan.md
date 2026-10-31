# Plan: scope the user-lookup RPCs

Design: `docs/superpowers/specs/2026-10-26-scope-user-lookup-rpcs-design.md`

## Tasks

- [x] 1. Find every caller of `get_users_by_ids` and `verify_employee_can_login`
      in `src/` and `supabase/functions/`.
- [x] 2. Write `supabase/tests/scope_user_lookup_rpcs.test.sql`. Run it on the
      old functions and see it fail (red).
- [x] 3. Write `supabase/migrations/20261026120600_scope_user_lookup_rpcs.sql`.
      Run the test again and see it pass (green).
- [x] 4. Change tests 1-4 in
      `supabase/tests/20251209000001_add_inactive_employee_auth_blocking.sql`
      to sign in as the user they check.
- [ ] 5. Review the diff. Push. Open the PR. Watch CI until green.

## Local evidence

The Supabase images do not download in the cloud container ("Data limit
exceeded"). The local run used Postgres 16 with a stub `auth` schema and
small pgTAP stand-in functions. The old functions fail 10 of 16 tests. The
new functions pass 16 of 16. CI runs the real pgTAP suite on the full schema.
