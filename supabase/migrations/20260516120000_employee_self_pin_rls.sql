-- Allow an active employee to upsert only their own employee_pins row.
-- DELETE is intentionally NOT granted -- removing a PIN remains manager-only
-- via the pre-existing employee_pins_manage policy (FOR ALL, owner/manager only).
--
-- Uses EXISTS rather than a scalar subquery so the policy degrades to a silent
-- RLS denial even if a user is ever linked to multiple employee rows in the
-- same restaurant (schema does not enforce UNIQUE(user_id, restaurant_id)).
--
-- The (select auth.uid()) inside EXISTS preserves Supabase's query-cached
-- evaluation guidance for RLS performance.

drop policy if exists employee_pins_self_insert on public.employee_pins;
create policy employee_pins_self_insert on public.employee_pins
  for insert
  with check (
    exists (
      select 1 from public.employees
      where id = employee_pins.employee_id
        and user_id = (select auth.uid())
        and restaurant_id = employee_pins.restaurant_id
        and is_active = true
    )
  );

drop policy if exists employee_pins_self_update on public.employee_pins;
create policy employee_pins_self_update on public.employee_pins
  for update
  using (
    exists (
      select 1 from public.employees
      where id = employee_pins.employee_id
        and user_id = (select auth.uid())
        and restaurant_id = employee_pins.restaurant_id
        and is_active = true
    )
  )
  with check (
    exists (
      select 1 from public.employees
      where id = employee_pins.employee_id
        and user_id = (select auth.uid())
        and restaurant_id = employee_pins.restaurant_id
        and is_active = true
    )
  );

-- Composite index supporting the policy subquery. Partial on is_active=true
-- because that's the only branch the policy ever consults.
create index if not exists idx_employees_user_restaurant_active
  on public.employees (user_id, restaurant_id)
  where is_active = true;

comment on policy employee_pins_self_insert on public.employee_pins is
  'Active employee may insert their own PIN row (for /employee/pin self-service).';
comment on policy employee_pins_self_update on public.employee_pins is
  'Active employee may update their own PIN row (for /employee/pin self-service).';
