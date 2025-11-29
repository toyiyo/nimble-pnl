-- Manager PINs for kiosk entry/exit without requiring an employee record
create table if not exists manager_pins (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  manager_user_id uuid not null, -- auth.users.id
  pin_hash text not null,
  min_length smallint not null default 4 check (min_length between 4 and 6),
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists manager_pins_user_unique on manager_pins (restaurant_id, manager_user_id);
create unique index if not exists manager_pins_pin_unique on manager_pins (restaurant_id, pin_hash);
create index if not exists manager_pins_last_used_idx on manager_pins (restaurant_id, last_used_at desc nulls last);

create or replace function set_manager_pins_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists tr_manager_pins_updated on manager_pins;
create trigger tr_manager_pins_updated
before update on manager_pins
for each row execute procedure set_manager_pins_updated_at();
