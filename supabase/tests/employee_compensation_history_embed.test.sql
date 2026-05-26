-- pgTAP tests for the employee_compensation_history → employees relationship
-- consumed by ai-execute-tool's PostgREST embed
-- `compensation_history:employee_compensation_history(...)`.
--
-- Pins the contract PostgREST needs to resolve the embed: the related table
-- exists and `employee_id` is a FK pointing at `employees.id`. Without these
-- the embed silently returns null (or, if the alias overlaps a real column,
-- returns the wrong thing).
--
-- RLS posture for `employee_compensation_history` is intentionally not pinned
-- here — multiple non-management read paths (collaborator_accountant on
-- /payroll, chef on /scheduling) consume the embed via `useEmployees`, and
-- the right posture warrants its own design + tests.

BEGIN;
SELECT plan(2);

SELECT has_table('public', 'employee_compensation_history',
  'employee_compensation_history table exists');

SELECT fk_ok('public', 'employee_compensation_history', ARRAY['employee_id'],
             'public', 'employees', ARRAY['id'],
             'employee_id FK references employees.id (PostgREST can resolve the embed)');

SELECT * FROM finish();
ROLLBACK;
