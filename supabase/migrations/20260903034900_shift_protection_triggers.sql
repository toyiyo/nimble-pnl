-- Shift Protection: block-mode enforcement on the employee paths.
--
-- Three BEFORE triggers. Each function is SECURITY DEFINER with a pinned
-- search_path — employees hold no staffing_settings SELECT grant, so an
-- INVOKER trigger would read no settings row and silently no-op. Each
-- trigger no-ops for a caller with edit:scheduling, so every manager
-- path (direct writes, create_shift_trade_for_employee, the review RPC)
-- is exempt. Only 'block' mode raises; 'warn' is a UI concern.
--
-- Every RAISE message starts with the stable prefix 'shift_protection:'
-- so the client (src/lib/shiftProtection.ts, parseShiftProtectionError)
-- maps it to friendly copy.
--
-- Coverage of the known bypasses (Phase 2.5 findings):
--   * trade INSERT — the self-service RLS INSERT path
--     (20260105000000_fix_shift_trades_rls.sql).
--   * trade UPDATE open -> pending_approval — the direct-UPDATE accept
--     path the employee UPDATE policy allows
--     (20260104120000_create_shift_trades.sql). The cancelled transition
--     and the auto-expire cron do not match the WHEN predicate.
--   * time_off INSERT OR UPDATE OF start_date, end_date — the date-edit
--     bypass through the employee UPDATE policy
--     (20251123100100_add_employee_self_service_rls.sql).
--
-- Design: docs/superpowers/specs/2026-09-03-shift-protection-design.md

CREATE OR REPLACE FUNCTION shift_protection_trade_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settings staffing_settings;
  v_start TIMESTAMPTZ;
BEGIN
  -- Tenant bind first, unconditionally. The self-service INSERT policy
  -- does not bind offered_shift_id to the trade's restaurant, and an
  -- unbound read here would leak shift timing across tenants.
  -- A BEFORE trigger runs before the FK check, so a
  -- NULL read means a missing OR cross-restaurant shift id — both get
  -- the same message, which keeps the two cases indistinguishable.
  SELECT start_time INTO v_start
  FROM shifts
  WHERE id = NEW.offered_shift_id
    AND restaurant_id = NEW.restaurant_id;

  IF v_start IS NULL THEN
    RAISE EXCEPTION 'shift_protection:invalid_trade The offered shift is not in this restaurant.';
  END IF;

  -- Settings before the capability lookup: almost every tenant runs with
  -- the default 'off', so skip the costlier check when no block applies.
  SELECT * INTO v_settings
  FROM staffing_settings
  WHERE restaurant_id = NEW.restaurant_id;

  IF COALESCE(v_settings.trade_deadline_mode, 'off') != 'block' THEN
    RETURN NEW;
  END IF;

  IF user_has_capability(NEW.restaurant_id, 'edit:scheduling') THEN
    RETURN NEW;
  END IF;

  IF now() >= v_start - make_interval(hours => v_settings.trade_deadline_hours) THEN
    RAISE EXCEPTION 'shift_protection:trade_deadline Trades close % hours before a shift starts.',
      v_settings.trade_deadline_hours;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_shift_protection_trade_insert ON shift_trades;
CREATE TRIGGER trg_shift_protection_trade_insert
  BEFORE INSERT ON shift_trades
  FOR EACH ROW
  EXECUTE FUNCTION shift_protection_trade_guard();

DROP TRIGGER IF EXISTS trg_shift_protection_trade_accept ON shift_trades;
CREATE TRIGGER trg_shift_protection_trade_accept
  BEFORE UPDATE OF status ON shift_trades
  FOR EACH ROW
  WHEN (OLD.status = 'open' AND NEW.status = 'pending_approval')
  EXECUTE FUNCTION shift_protection_trade_guard();

CREATE OR REPLACE FUNCTION shift_protection_timeoff_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_settings staffing_settings;
  v_tz TEXT;
  v_today DATE;
  v_position TEXT;
  v_max_sameday INTEGER;
BEGIN
  -- Tenant bind first, unconditionally. The self-service policies bind
  -- only employee_id, so a forged restaurant_id could park the row under
  -- a tenant whose rules exempt the caller.
  IF NOT EXISTS (
    SELECT 1 FROM employees e
    WHERE e.id = NEW.employee_id
      AND e.restaurant_id = NEW.restaurant_id
  ) THEN
    RAISE EXCEPTION 'shift_protection:invalid_request The employee is not in this restaurant.';
  END IF;

  -- A date-preserving edit (for example a reason typo fix) must not
  -- re-run the rules — a manager-submitted short-notice request would
  -- otherwise lock the employee out of their own pending row.
  IF TG_OP = 'UPDATE'
     AND NEW.start_date = OLD.start_date
     AND NEW.end_date = OLD.end_date
     AND NEW.restaurant_id = OLD.restaurant_id THEN
    RETURN NEW;
  END IF;

  -- Settings before the capability lookup: almost every tenant runs with
  -- the default 'off', so skip the costlier check when no block applies.
  SELECT * INTO v_settings
  FROM staffing_settings
  WHERE restaurant_id = NEW.restaurant_id;

  IF COALESCE(v_settings.timeoff_notice_mode, 'off') != 'block'
     AND COALESCE(v_settings.timeoff_sameday_mode, 'off') != 'block' THEN
    RETURN NEW;
  END IF;

  IF user_has_capability(NEW.restaurant_id, 'edit:scheduling') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(r.timezone, ''), 'UTC') INTO v_tz
  FROM restaurants r WHERE r.id = NEW.restaurant_id;
  BEGIN
    v_today := (now() AT TIME ZONE v_tz)::date;
  EXCEPTION WHEN invalid_parameter_value THEN
    v_today := (now() AT TIME ZONE 'UTC')::date;
  END;

  IF COALESCE(v_settings.timeoff_notice_mode, 'off') = 'block'
     AND NEW.start_date < v_today + v_settings.timeoff_notice_days THEN
    RAISE EXCEPTION 'shift_protection:timeoff_notice This restaurant asks for % days of notice for time off.',
      v_settings.timeoff_notice_days;
  END IF;

  IF COALESCE(v_settings.timeoff_sameday_mode, 'off') = 'block' THEN
    SELECT e.position INTO v_position
    FROM employees e WHERE e.id = NEW.employee_id;

    SELECT COALESCE(MAX(day_count), 0) INTO v_max_sameday
    FROM (
      SELECT COUNT(DISTINCT tor.employee_id) AS day_count
      FROM generate_series(
        NEW.start_date,
        LEAST(NEW.end_date, NEW.start_date + 92),
        INTERVAL '1 day'
      ) AS d
      JOIN time_off_requests tor
        ON tor.restaurant_id = NEW.restaurant_id
       AND tor.status = 'approved'
       AND tor.employee_id != NEW.employee_id
       AND tor.start_date <= d::date
       AND tor.end_date >= d::date
      WHERE EXISTS (
        SELECT 1 FROM employees oe
        WHERE oe.id = tor.employee_id
          AND oe.position = v_position
      )
      GROUP BY d::date
    ) counts;

    IF v_max_sameday >= v_settings.timeoff_sameday_limit THEN
      RAISE EXCEPTION 'shift_protection:timeoff_sameday % coworker(s) already have approved time off on a requested day (limit %).',
        v_max_sameday, v_settings.timeoff_sameday_limit;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- restaurant_id and employee_id are in the UPDATE OF list so a tenant
-- or subject flip after insert cannot dodge the guard (the tenant bind
-- above re-checks the pair).
DROP TRIGGER IF EXISTS trg_shift_protection_timeoff ON time_off_requests;
CREATE TRIGGER trg_shift_protection_timeoff
  BEFORE INSERT OR UPDATE OF start_date, end_date, restaurant_id, employee_id ON time_off_requests
  FOR EACH ROW
  EXECUTE FUNCTION shift_protection_timeoff_guard();

COMMENT ON FUNCTION shift_protection_trade_guard() IS
  'Shift Protection: block-mode trade deadline on the employee insert and direct-accept paths';
COMMENT ON FUNCTION shift_protection_timeoff_guard() IS
  'Shift Protection: block-mode notice and same-day limits on the employee time-off paths';
