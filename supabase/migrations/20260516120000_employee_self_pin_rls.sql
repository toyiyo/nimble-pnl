-- Allow an active employee to upsert only their own employee_pins row.
-- DELETE is intentionally NOT granted -- removing a PIN remains manager-only
-- via the pre-existing employee_pins_manage policy (FOR ALL, owner/manager only).

drop policy if exists employee_pins_self_insert on public.employee_pins;
create policy employee_pins_self_insert on public.employee_pins
  for insert
  with check (
    employee_id = (
      select id from public.employees
      where user_id = (select auth.uid())
        and restaurant_id = employee_pins.restaurant_id
        and is_active = true
    )
  );

drop policy if exists employee_pins_self_update on public.employee_pins;
create policy employee_pins_self_update on public.employee_pins
  for update
  using (
    employee_id = (
      select id from public.employees
      where user_id = (select auth.uid())
        and restaurant_id = employee_pins.restaurant_id
        and is_active = true
    )
  )
  with check (
    employee_id = (
      select id from public.employees
      where user_id = (select auth.uid())
        and restaurant_id = employee_pins.restaurant_id
        and is_active = true
    )
  );

comment on policy employee_pins_self_insert on public.employee_pins is
  'Active employee may insert their own PIN row (for /employee/pin self-service).';
comment on policy employee_pins_self_update on public.employee_pins is
  'Active employee may update their own PIN row (for /employee/pin self-service).';
