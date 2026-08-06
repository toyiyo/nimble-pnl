BEGIN;
SELECT plan(7);

SELECT is((SELECT count(*)::int FROM public.area_catalog), 33,
  'area_catalog has one row per gateable sidebar page');

SELECT is((SELECT array_agg(DISTINCT ui_group ORDER BY ui_group) FROM public.area_catalog),
  ARRAY['Accounting','Admin','Inventory','Main','Operations'],
  'ui_groups are the sidebar group labels verbatim');

SELECT is((SELECT count(*)::int FROM (
    SELECT ui_group, sort_order FROM public.area_catalog
    GROUP BY ui_group, sort_order HAVING count(*) > 1) dupes), 0,
  'sort_order is unique within each ui_group');

SELECT ok((SELECT bool_and(max_level_collaborator IS NULL)
           FROM public.area_catalog WHERE area_key IN ('team','collaborators')),
  'team and collaborators stay ungrantable to any collaborator role');

SELECT is((SELECT count(*)::int FROM public.area_catalog WHERE area_key = 'books'), 0,
  'the books bundle is retired');

SELECT ok((SELECT bool_and(max_level_collaborator = 'view') FROM public.area_catalog
           WHERE area_key IN ('dashboard','sales','ops_inbox','weekly_brief','labor',
                              'budget','stripe_account','financial_statements',
                              'financial_intelligence')),
  'read-only pages are capped at view');

-- Cheap insurance on the DISABLE/ENABLE window. Supabase runs each migration
-- in a transaction, so a mid-file failure should roll the DISABLE back — but
-- a guard left off is silent, and this assertion costs one line.
SELECT is((SELECT count(*)::int FROM pg_trigger
           WHERE tgname IN ('role_areas_block_builtin_mutation',
                            'role_flags_block_builtin_mutation',
                            'role_areas_enforce_collaborator_cap',
                            'roles_block_builtin_mutation')
             AND tgenabled = 'O'), 4,
  'all four builtin/collaborator guards are enabled after migration');

SELECT * FROM finish();
ROLLBACK;
