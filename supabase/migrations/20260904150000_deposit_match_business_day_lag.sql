-- Deposit Match: count the lag window in business days, not calendar days.
--
-- Design ref: docs/superpowers/specs/2026-09-04-deposit-match-lag-window-design.md
--
-- Two defects, both in supabase/migrations/20260901160000_deposit_match_refresh_engine.sql:
--
--   1. The candidate window compares a TIMESTAMPTZ column to a DATE upper
--      bound. Postgres casts the DATE to midnight at the START of the last
--      lag day, so an intraday deposit on that day falls outside the
--      window. Fixed here with half-open TIMESTAMPTZ bounds.
--   2. The lag columns count calendar days, but card processors settle in
--      business days and roll weekend batches to Monday. Fixed here with
--      a new helper, deposit_match_business_days_after, used at every site
--      that reads lag_days_min or lag_days_max.
--
-- Warning: this migration replaces refresh_deposit_matches only. It must
-- NOT replace get_deposit_match_report — that function's current
-- definition lives in
-- supabase/migrations/20260903140000_deposit_match_report_bank_suggestions.sql,
-- and a replace from this file's older text would delete its
-- suggested_sources payload.

-- ═══════════════════════════════════════════════════════════════════════
-- deposit_match_business_days_after: the p_days-th weekday strictly after
-- p_date. p_days <= 0 returns p_date unchanged. Marked IMMUTABLE so the
-- planner can inline it into the candidate join below.
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.deposit_match_business_days_after(
  p_date date, p_days integer
) RETURNS date
LANGUAGE sql IMMUTABLE STRICT
AS $$
  SELECT CASE
    WHEN p_days <= 0 THEN p_date
    ELSE (
      -- p_days * 2 + 10 calendar days always holds at least p_days
      -- weekdays: the worst case is 5 weekdays per 7 calendar days, and
      -- this span is wider than that ratio needs for p_days up to the
      -- rules table's CHECK ceiling of 30.
      SELECT day::date
      FROM generate_series(p_date + 1, p_date + (p_days * 2 + 10), interval '1 day') AS day
      WHERE extract(isodow FROM day) < 6
      ORDER BY day
      OFFSET p_days - 1
      LIMIT 1
    )
  END
$$;

REVOKE ALL ON FUNCTION public.deposit_match_business_days_after(date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deposit_match_business_days_after(date, integer) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- Bound the lag columns. The helper builds a generate_series over the lag
-- span, so an unbounded value would make that series huge on every
-- candidate row.
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE public.deposit_match_rules
  ADD CONSTRAINT deposit_match_rules_lag_min_range
    CHECK (lag_days_min BETWEEN 0 AND 30),
  ADD CONSTRAINT deposit_match_rules_lag_max_range
    CHECK (lag_days_max BETWEEN 0 AND 30),
  ADD CONSTRAINT deposit_match_rules_lag_order
    CHECK (lag_days_max >= lag_days_min);

COMMENT ON COLUMN public.deposit_match_rules.lag_days_min IS
  'Minimum settlement lag, in business days (Monday-Friday), not calendar days.';
COMMENT ON COLUMN public.deposit_match_rules.lag_days_max IS
  'Maximum settlement lag, in business days (Monday-Friday), not calendar days.';

-- ═══════════════════════════════════════════════════════════════════════
-- refresh_deposit_matches: full replace, same header as the engine
-- migration. Four lag-sensitive sites change; everything else is
-- unchanged from 20260901160000_deposit_match_refresh_engine.sql.
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.refresh_deposit_matches(
  p_restaurant_id uuid, p_start_date date, p_end_date date
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_rule            public.deposit_match_rules%ROWTYPE;
  v_bank            RECORD;
  v_src             RECORD;
  v_cand            RECORD;
  v_item            RECORD;
  v_assigned_items  uuid[];
  v_assigned_txns   uuid[];
  v_tol             numeric;
  v_is_match        boolean;
  v_implied_fee     numeric;
  v_second_count    int;
  v_received        numeric;
  v_diff            numeric;
  v_fee             numeric;
  v_fee_lo          numeric;
  v_fee_hi          numeric;
  v_expected_by     date;
  v_bank_dead       boolean;
  v_bank_stale      boolean;
  v_status          text;
  v_reason          text;
BEGIN
  IF NOT (
    public.user_has_capability(p_restaurant_id, 'view:banking')
    AND public.user_has_capability(p_restaurant_id, 'view:pos_sales')
  ) THEN
    RAISE EXCEPTION
      'refresh_deposit_matches: caller lacks view:banking and view:pos_sales for restaurant %',
      p_restaurant_id;
  END IF;

  FOR v_rule IN
    SELECT * FROM public.deposit_match_rules WHERE restaurant_id = p_restaurant_id
  LOOP
    IF NOT v_rule.active THEN
      UPDATE public.deposit_match_items
      SET status = 'incomplete', status_reason = 'rule_inactive', computed_at = now()
      WHERE rule_id = v_rule.id AND business_date BETWEEN p_start_date AND p_end_date;
      CONTINUE;
    END IF;

    BEGIN
      SELECT * INTO v_bank
      FROM public.connected_banks
      WHERE id = v_rule.connected_bank_id;

      -- Step 1: upsert items from the dispatcher. Never touches resolution.
      FOR v_src IN
        SELECT * FROM public.deposit_match_dispatch(
          v_rule.pos_source, p_restaurant_id, p_start_date, p_end_date, v_rule.source_config
        )
      LOOP
        INSERT INTO public.deposit_match_items
          (restaurant_id, rule_id, business_date, expected_amount, source_row_count, computed_at, status)
        VALUES
          (p_restaurant_id, v_rule.id, v_src.business_date, v_src.expected_amount, v_src.row_count, now(), 'pending')
        ON CONFLICT (restaurant_id, rule_id, business_date) DO UPDATE
        SET expected_amount = EXCLUDED.expected_amount,
            source_row_count = EXCLUDED.source_row_count,
            computed_at = now();
      END LOOP;

      -- Step 2: clear this rule's own auto links so re-matching starts
      -- fresh (idempotent). A manual link is never deleted.
      DELETE FROM public.deposit_match_links l
      USING public.deposit_match_items i
      WHERE l.item_id = i.id
        AND i.rule_id = v_rule.id
        AND i.business_date BETWEEN p_start_date AND p_end_date
        AND l.method = 'auto';

      -- Step 3: score every open (item, candidate transaction) pair and
      -- assign the best-scored pairs first, globally across the range.
      -- An item already carrying a link (a manual one — auto links were
      -- just cleared above) is not an open candidate. A stale/disconnected
      -- bank, or an item whose expected-by date it has not caught up to,
      -- is also excluded — matching against data we cannot trust yet would
      -- risk a false short/over that step 5 must never produce.
      v_assigned_items := '{}';
      v_assigned_txns := '{}';

      FOR v_cand IN
        SELECT i.id AS item_id, i.business_date, i.expected_amount,
               bt.id AS txn_id, bt.amount,
               CASE WHEN v_rule.settlement = 'gross'
                    THEN abs(i.expected_amount - bt.amount)
                    -- fee_pct_min/max are percentage points (1.6 means 1.6%,
                    -- per the setup form and the design doc's "1.6%-3.1%
                    -- fee"), so divide by 100 to get the fraction this
                    -- formula needs.
                    ELSE abs(i.expected_amount * (1 - (v_rule.fee_pct_min + v_rule.fee_pct_max) / 2.0 / 100.0) - bt.amount)
               END AS fit_score
        FROM public.deposit_match_items i
        JOIN public.bank_transactions bt
          ON bt.restaurant_id = p_restaurant_id
          AND bt.connected_bank_id = v_rule.connected_bank_id
          AND bt.amount > 0
          AND bt.is_transfer IS NOT TRUE
          -- Half-open TIMESTAMPTZ window, in business days. The lower
          -- bound is the lag_days_min-th business day at midnight UTC; the
          -- upper bound is the START of the day AFTER the lag_days_max-th
          -- business day, so an intraday deposit on that last day still
          -- falls inside the window (defect 1 in the design doc).
          AND bt.transaction_date >=
            (public.deposit_match_business_days_after(i.business_date, v_rule.lag_days_min))::timestamp
              AT TIME ZONE 'UTC'
          AND bt.transaction_date <
            (public.deposit_match_business_days_after(i.business_date, v_rule.lag_days_max)
              + 1)::timestamp AT TIME ZONE 'UTC'
          AND (v_rule.descriptor_pattern IS NULL OR bt.description ~* v_rule.descriptor_pattern)
        WHERE i.rule_id = v_rule.id
          AND i.business_date BETWEEN p_start_date AND p_end_date
          AND NOT EXISTS (SELECT 1 FROM public.deposit_match_links l2 WHERE l2.item_id = i.id)
          -- A bank transaction already confirmed for another rule (or a
          -- manual link) is not open capacity: every confirmed link
          -- allocates the transaction's full amount, so a second confirmed
          -- link on the same transaction would always exceed the
          -- allocation-cap trigger's ceiling and roll back this whole
          -- rule's refresh (found in review, chatgpt-codex-connector).
          AND NOT EXISTS (
            SELECT 1 FROM public.deposit_match_links l3
            WHERE l3.bank_transaction_id = bt.id AND l3.state = 'confirmed'
              AND l3.restaurant_id = p_restaurant_id
          )
          AND v_bank.status = 'connected'
          AND v_bank.data_current_through IS NOT NULL
          -- Pin midnight of the cutoff date to UTC explicitly. A plain
          -- ::timestamptz cast on a date reads the session TimeZone
          -- setting, which can silently shift the freshness cutoff by a
          -- day if that setting ever drifts from what wrote
          -- data_current_through (this codebase's documented history of
          -- timezone off-by-one bugs, CLAUDE.md). The bound is business
          -- days: a deposit that syncs early can match early, and the
          -- refresh self-corrects on the next run because Step 2 clears
          -- every auto link in range before this loop runs again.
          AND v_bank.data_current_through >=
            (public.deposit_match_business_days_after(i.business_date, v_rule.lag_days_max))::timestamp
              AT TIME ZONE 'UTC'
        ORDER BY fit_score ASC, i.business_date ASC, bt.transaction_date ASC, bt.id ASC
      LOOP
        IF v_cand.item_id = ANY(v_assigned_items) OR v_cand.txn_id = ANY(v_assigned_txns) THEN
          CONTINUE;
        END IF;

        v_tol := GREATEST(v_rule.amount_tolerance, v_cand.expected_amount * v_rule.amount_tolerance_pct);

        IF v_rule.settlement = 'gross' THEN
          v_is_match := abs(v_cand.expected_amount - v_cand.amount) <= v_tol;
        ELSE
          v_implied_fee := CASE WHEN v_cand.expected_amount = 0 THEN NULL
                                 ELSE (v_cand.expected_amount - v_cand.amount) / v_cand.expected_amount END;
          -- v_implied_fee is a fraction (0.02 for 2%); fee_pct_min/max are
          -- percentage points (1.6 for 1.6%), so divide by 100 to compare.
          v_is_match := v_implied_fee IS NOT NULL
            AND v_implied_fee BETWEEN v_rule.fee_pct_min / 100.0 AND v_rule.fee_pct_max / 100.0;
        END IF;

        -- Step 4: only a matching pair becomes a link. A pair that does not
        -- clear tolerance is left alone — neither side is consumed, so a
        -- later (worse-scored) pair for the same item can still be tried.
        IF NOT v_is_match THEN
          CONTINUE;
        END IF;

        SELECT count(*) INTO v_second_count
        FROM public.bank_transactions bt2
        WHERE bt2.restaurant_id = p_restaurant_id
          AND bt2.connected_bank_id = v_rule.connected_bank_id
          AND bt2.amount > 0
          AND bt2.is_transfer IS NOT TRUE
          AND bt2.id <> v_cand.txn_id
          AND NOT (bt2.id = ANY(v_assigned_txns))
          AND NOT EXISTS (
            SELECT 1 FROM public.deposit_match_links l4
            WHERE l4.bank_transaction_id = bt2.id AND l4.state = 'confirmed'
              AND l4.restaurant_id = p_restaurant_id
          )
          -- Same half-open business-day window as the candidate join above.
          -- The two windows must stay identical, or the ambiguity count
          -- diverges from the candidate set the assignment loop actually
          -- used (design doc, site 3).
          AND bt2.transaction_date >=
            (public.deposit_match_business_days_after(v_cand.business_date, v_rule.lag_days_min))::timestamp
              AT TIME ZONE 'UTC'
          AND bt2.transaction_date <
            (public.deposit_match_business_days_after(v_cand.business_date, v_rule.lag_days_max)
              + 1)::timestamp AT TIME ZONE 'UTC'
          AND (v_rule.descriptor_pattern IS NULL OR bt2.description ~* v_rule.descriptor_pattern)
          AND (
            CASE WHEN v_rule.settlement = 'gross'
                 THEN abs(v_cand.expected_amount - bt2.amount) <= v_tol
                 ELSE v_cand.expected_amount <> 0
                   AND ((v_cand.expected_amount - bt2.amount) / v_cand.expected_amount)
                       BETWEEN v_rule.fee_pct_min / 100.0 AND v_rule.fee_pct_max / 100.0
            END
          );

        INSERT INTO public.deposit_match_links
          (restaurant_id, item_id, bank_transaction_id, allocated_amount, method, state, match_reason)
        VALUES
          (p_restaurant_id, v_cand.item_id, v_cand.txn_id, v_cand.amount, 'auto',
           CASE WHEN v_second_count = 0 THEN 'confirmed' ELSE 'suggested' END,
           CASE WHEN v_rule.settlement = 'gross' THEN 'gross_fit' ELSE 'net_fee_fit' END);

        v_assigned_items := array_append(v_assigned_items, v_cand.item_id);
        v_assigned_txns := array_append(v_assigned_txns, v_cand.txn_id);
      END LOOP;

      -- Step 5: set each item's status from its confirmed links (never
      -- resolution) and the bank's freshness.
      FOR v_item IN
        SELECT * FROM public.deposit_match_items
        WHERE rule_id = v_rule.id AND business_date BETWEEN p_start_date AND p_end_date
      LOOP
        SELECT COALESCE(SUM(allocated_amount), 0) INTO v_received
        FROM public.deposit_match_links
        WHERE item_id = v_item.id AND state = 'confirmed';

        v_tol := GREATEST(v_rule.amount_tolerance, v_item.expected_amount * v_rule.amount_tolerance_pct);
        v_diff := v_item.expected_amount - v_received;
        -- The accepted band for v_diff is the rule's fee band, as an amount
        -- (fee_pct_min/max are percentage points, same conversion Step 3/4
        -- use), widened by the amount tolerance on each side. A gross rule
        -- always carries fee_pct_min = fee_pct_max = 0 (the table default),
        -- so the band collapses to [-v_tol, v_tol] and this matches the
        -- old gross-only check exactly. Without this, a net rule's normal
        -- processing fee (diff > 0 but within the fee band already used to
        -- confirm the link in Step 4) fell outside the zero-width default
        -- tolerance and was misclassified short with no fee recorded
        -- (found in review, chatgpt-codex-connector).
        v_fee_lo := v_item.expected_amount * v_rule.fee_pct_min / 100.0;
        v_fee_hi := v_item.expected_amount * v_rule.fee_pct_max / 100.0;
        v_expected_by := public.deposit_match_business_days_after(v_item.business_date, v_rule.lag_days_max);
        -- Two separate gates, checked in this order, per the design's
        -- reordered ladder:
        --   v_bank_dead  — the bank is not connected, or has never synced.
        --                  This is always incomplete/bank_stale, at any
        --                  point in the window — a dead bank is a problem
        --                  the user must see immediately.
        --   v_bank_stale — the window has closed, but the bank feed does
        --                  not yet cover the full last lag day. Declare
        --                  late only from complete data.
        v_bank_dead := v_bank.status IS DISTINCT FROM 'connected'
          OR v_bank.data_current_through IS NULL;
        v_bank_stale := v_bank.data_current_through <
          ((v_expected_by + 1)::timestamp AT TIME ZONE 'UTC');

        IF v_received > 0 THEN
          IF v_diff BETWEEN (v_fee_lo - v_tol) AND (v_fee_hi + v_tol) THEN
            v_status := CASE WHEN v_rule.settlement = 'net' THEN 'matched_net' ELSE 'matched' END;
            v_reason := 'within_tolerance';
            v_fee := CASE WHEN v_rule.settlement = 'net' THEN GREATEST(v_diff, 0) ELSE 0 END;
          ELSIF v_diff > (v_fee_hi + v_tol) THEN
            v_status := 'short'; v_reason := 'short_confirmed'; v_fee := 0;
          ELSE
            v_status := 'over'; v_reason := 'over_confirmed'; v_fee := 0;
          END IF;
        ELSIF EXISTS (
          SELECT 1 FROM public.deposit_match_links
          WHERE item_id = v_item.id AND state = 'suggested'
        ) THEN
          v_status := 'needs_review'; v_reason := 'ambiguous_match'; v_fee := 0;
        ELSIF v_bank_dead THEN
          v_status := 'incomplete'; v_reason := 'bank_stale'; v_fee := 0;
        ELSIF CURRENT_DATE <= v_expected_by THEN
          v_status := 'pending'; v_reason := 'within_lag_window'; v_fee := 0;
        ELSIF v_bank_stale THEN
          v_status := 'incomplete'; v_reason := 'bank_stale'; v_fee := 0;
        ELSE
          v_status := 'late'; v_reason := 'past_lag_max'; v_fee := 0;
        END IF;

        UPDATE public.deposit_match_items
        SET received_amount = v_received, fee_amount = v_fee, status = v_status,
            status_reason = v_reason, computed_at = now()
        WHERE id = v_item.id;
      END LOOP;

    EXCEPTION WHEN OTHERS THEN
      UPDATE public.deposit_match_items
      SET status = 'incomplete', status_reason = 'rule_error', computed_at = now()
      WHERE rule_id = v_rule.id AND business_date BETWEEN p_start_date AND p_end_date;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_deposit_matches(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_deposit_matches(uuid, date, date) TO authenticated;
