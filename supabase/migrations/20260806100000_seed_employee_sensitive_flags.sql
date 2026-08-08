-- Seed view:pay_rates and view:employee_pii onto the five builtin roles that
-- hold view:employees.
--
-- Every builtin role holds zero role_flags rows today, and every membership in
-- production carries a non-null role_id. So user_has_capability takes the flag
-- branch (20260805120000_page_areas.sql:322-327) and returns FALSE for every
-- caller. The column gate in 20260806110000 would therefore mask pay and
-- contact data for every user, including the restaurant owner.
--
-- This migration must run before that gate.
--
-- view:costs stays unseeded on purpose. Nothing reads it yet, so a grant would
-- express an intent no code enforces.
--
-- The list below matches ROLE_CAPABILITIES in src/lib/permissions/definitions.ts.
-- supabase/tests/roles_seed_test.sql asserts both sides byte-for-byte.

INSERT INTO public.role_flags (role_id, flag)
SELECT r.id, f.flag
FROM public.roles r
CROSS JOIN LATERAL (VALUES ('view:pay_rates'), ('view:employee_pii')) AS f(flag)
WHERE r.builtin = true
  AND r.restaurant_id IS NULL
  AND r.name IN (
    'Owner',
    'Manager',
    'Operations Manager',
    'Accountant',
    'Operations Manager (Collaborator)'
  )
ON CONFLICT (role_id, flag) DO NOTHING;
