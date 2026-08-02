BEGIN;
SELECT plan(5);

SELECT is(
  public.invitable_roles('owner'),
  ARRAY['owner','manager','operations_manager','chef','staff',
        'collaborator_accountant','collaborator_inventory','collaborator_chef',
        'collaborator_operations_manager'],
  'the owner row matches src/lib/permissions/invitations.ts:14-18'
);

SELECT is(
  public.invitable_roles('manager'),
  ARRAY['manager','operations_manager','chef','staff',
        'collaborator_accountant','collaborator_inventory','collaborator_chef',
        'collaborator_operations_manager'],
  'a manager may not assign owner'
);

SELECT is(public.invitable_roles('operations_manager'), ARRAY['staff'],
  'operations_manager reaches staff only');

SELECT ok(public.invitable_roles('staff') IS NULL,
  'a role with no matrix row gets NULL, not an empty array that reads as "checked and allowed nothing"');

-- kiosk is absent from every row by design: a kiosk is a shared device
-- credential, not a person (src/lib/permissions/invitations.ts:12-13).
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM (VALUES ('owner'),('manager'),('operations_manager')) AS i(r)
    WHERE 'kiosk' = ANY (public.invitable_roles(i.r))
  ),
  'nobody can assign kiosk'
);

SELECT * FROM finish();
ROLLBACK;
