-- Kiosk mode + employee PIN storage
-- Stores hashed PINs per restaurant/employee with uniqueness enforced to reduce identity ambiguity

create table if not exists employee_pins (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  pin_hash text not null,
  min_length smallint not null default 4 check (min_length between 4 and 6),
  force_reset boolean not null default false,
  last_used_at timestamptz,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists employee_pins_employee_unique on employee_pins (restaurant_id, employee_id);
create unique index if not exists employee_pins_pin_unique on employee_pins (restaurant_id, pin_hash);
create index if not exists employee_pins_last_used_idx on employee_pins (restaurant_id, last_used_at desc nulls last);

create or replace function set_employee_pins_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tr_employee_pins_updated on employee_pins;
create trigger tr_employee_pins_updated
before update on employee_pins
for each row execute procedure set_employee_pins_updated_at();
