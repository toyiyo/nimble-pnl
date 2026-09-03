-- Deposit Match: the refresh engine and the read RPC.
--
-- Design ref: docs/superpowers/specs/2026-09-01-deposit-match-design.md
--             ("Matching engine" and "Read RPC" sections)
--
-- Two public-facing functions. Both are the "public wrapper" tier of the
-- internal/public split (memory/lessons.md:904): each runs the capability
-- check FIRST, before any data read, then GRANTs EXECUTE to authenticated
-- (unlike the Task 2 adapters/dispatcher, which stay locked to service_role
-- because they trust their caller).
--
--   refresh_deposit_matches(p_restaurant_id, p_start_date, p_end_date)
--     Visits every rule. An inactive rule marks its existing items
--     incomplete/rule_inactive. Each active rule runs inside its own
--     BEGIN...EXCEPTION block so one bad rule cannot abort the others; a
--     caught error marks that rule's items incomplete/rule_error.
--     Match steps, per the design:
--       1. upsert items from the dispatcher;
--       2. clear this rule's own auto links, never a manual one;
--       3. score every open (item, candidate bank transaction) pair by
--          amount fit and assign best-scored pairs first, globally across
--          the whole date range — NOT one date at a time. A date-order pass
--          can let an early day take the deposit that fits a later day
--          exactly, leaving the later day a false shortfall (the bug class
--          in memory/lessons.md, PR #760, 2026-08-18);
--       4. auto-confirm a link only when the fit clears tolerance (gross)
--          or the implied fee sits inside the rule's fee band (net) AND no
--          other open candidate for that item also clears it; otherwise the
--          link is left "suggested" and the item needs review;
--       5. set each item's status from its confirmed links and the bank's
--          freshness. A stale or disconnected bank can never produce late
--          or short — it produces incomplete instead.
--     A refresh never deletes a manual link and never writes to an item's
--     resolution columns.
--
--   get_deposit_match_report(p_restaurant_id, p_start_date, p_end_date)
--     Same capability check, then one JSONB payload: summary totals,
--     per-rule stream totals, ledger rows with their links, and the
--     freshness boundary per bank. The client renders from this payload and
--     recomputes no totals.

-- ═══════════════════════════════════════════════════════════════════════
-- refresh_deposit_matches
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
  v_expected_by     date;
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
                    ELSE abs(i.expected_amount * (1 - (v_rule.fee_pct_min + v_rule.fee_pct_max) / 2.0) - bt.amount)
               END AS fit_score
        FROM public.deposit_match_items i
        JOIN public.bank_transactions bt
          ON bt.restaurant_id = p_restaurant_id
          AND bt.connected_bank_id = v_rule.connected_bank_id
          AND bt.amount > 0
          AND bt.is_transfer IS NOT TRUE
          AND bt.transaction_date BETWEEN (i.business_date + v_rule.lag_days_min)
                                       AND (i.business_date + v_rule.lag_days_max)
          AND (v_rule.descriptor_pattern IS NULL OR bt.description ~* v_rule.descriptor_pattern)
        WHERE i.rule_id = v_rule.id
          AND i.business_date BETWEEN p_start_date AND p_end_date
          AND NOT EXISTS (SELECT 1 FROM public.deposit_match_links l2 WHERE l2.item_id = i.id)
          AND v_bank.status = 'connected'
          AND v_bank.data_current_through IS NOT NULL
          AND v_bank.data_current_through >= (i.business_date + v_rule.lag_days_max)::timestamptz
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
          v_is_match := v_implied_fee IS NOT NULL
            AND v_implied_fee BETWEEN v_rule.fee_pct_min AND v_rule.fee_pct_max;
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
          AND bt2.transaction_date BETWEEN (v_cand.business_date + v_rule.lag_days_min)
                                        AND (v_cand.business_date + v_rule.lag_days_max)
          AND (v_rule.descriptor_pattern IS NULL OR bt2.description ~* v_rule.descriptor_pattern)
          AND (
            CASE WHEN v_rule.settlement = 'gross'
                 THEN abs(v_cand.expected_amount - bt2.amount) <= v_tol
                 ELSE v_cand.expected_amount <> 0
                   AND ((v_cand.expected_amount - bt2.amount) / v_cand.expected_amount)
                       BETWEEN v_rule.fee_pct_min AND v_rule.fee_pct_max
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
        v_expected_by := v_item.business_date + v_rule.lag_days_max;
        v_bank_stale := v_bank.status IS DISTINCT FROM 'connected'
          OR v_bank.data_current_through IS NULL
          OR v_bank.data_current_through < v_expected_by::timestamptz;

        IF v_received > 0 THEN
          IF abs(v_diff) <= v_tol THEN
            v_status := CASE WHEN v_rule.settlement = 'net' THEN 'matched_net' ELSE 'matched' END;
            v_reason := 'within_tolerance';
            v_fee := CASE WHEN v_rule.settlement = 'net' THEN GREATEST(v_diff, 0) ELSE 0 END;
          ELSIF v_diff > v_tol THEN
            v_status := 'short'; v_reason := 'short_confirmed'; v_fee := 0;
          ELSE
            v_status := 'over'; v_reason := 'over_confirmed'; v_fee := 0;
          END IF;
        ELSIF EXISTS (
          SELECT 1 FROM public.deposit_match_links
          WHERE item_id = v_item.id AND state = 'suggested'
        ) THEN
          v_status := 'needs_review'; v_reason := 'ambiguous_match'; v_fee := 0;
        ELSIF v_bank_stale THEN
          v_status := 'incomplete'; v_reason := 'bank_stale'; v_fee := 0;
        ELSIF CURRENT_DATE > v_expected_by THEN
          v_status := 'late'; v_reason := 'past_lag_max'; v_fee := 0;
        ELSE
          v_status := 'pending'; v_reason := 'within_lag_window'; v_fee := 0;
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

-- ═══════════════════════════════════════════════════════════════════════
-- get_deposit_match_report
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.get_deposit_match_report(
  p_restaurant_id uuid, p_start_date date, p_end_date date
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_summary jsonb;
  v_streams jsonb;
  v_ledger  jsonb;
  v_banks   jsonb;
BEGIN
  IF NOT (
    public.user_has_capability(p_restaurant_id, 'view:banking')
    AND public.user_has_capability(p_restaurant_id, 'view:pos_sales')
  ) THEN
    RAISE EXCEPTION
      'get_deposit_match_report: caller lacks view:banking and view:pos_sales for restaurant %',
      p_restaurant_id;
  END IF;

  SELECT jsonb_build_object(
    'total_expected', COALESCE(SUM(i.expected_amount), 0),
    'total_received', COALESCE(SUM(i.received_amount), 0),
    'total_fees', COALESCE(SUM(i.fee_amount), 0),
    'pending_count', COUNT(*) FILTER (WHERE i.status = 'pending'),
    'needs_attention_count', COUNT(*) FILTER (WHERE i.status IN ('short', 'over', 'late', 'needs_review'))
  ) INTO v_summary
  FROM public.deposit_match_items i
  WHERE i.restaurant_id = p_restaurant_id
    AND i.business_date BETWEEN p_start_date AND p_end_date;

  SELECT COALESCE(jsonb_agg(s), '[]'::jsonb) INTO v_streams
  FROM (
    SELECT jsonb_build_object(
      'rule_id', r.id,
      'pos_source', r.pos_source,
      'rail', r.rail,
      'active', r.active,
      'expected_total', COALESCE(SUM(i.expected_amount), 0),
      'received_total', COALESCE(SUM(i.received_amount), 0),
      'fee_total', COALESCE(SUM(i.fee_amount), 0),
      'item_count', COUNT(i.id)
    ) AS s
    FROM public.deposit_match_rules r
    LEFT JOIN public.deposit_match_items i
      ON i.rule_id = r.id AND i.business_date BETWEEN p_start_date AND p_end_date
    WHERE r.restaurant_id = p_restaurant_id
    GROUP BY r.id, r.pos_source, r.rail, r.active
    ORDER BY r.pos_source
  ) x;

  SELECT COALESCE(jsonb_agg(l), '[]'::jsonb) INTO v_ledger
  FROM (
    SELECT jsonb_build_object(
      'item_id', i.id,
      'rule_id', i.rule_id,
      'pos_source', r.pos_source,
      'business_date', i.business_date,
      'expected_amount', i.expected_amount,
      'received_amount', i.received_amount,
      'fee_amount', i.fee_amount,
      'status', i.status,
      'status_reason', i.status_reason,
      'resolution', i.resolution,
      'resolution_note', i.resolution_note,
      'links', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'link_id', lk.id,
          'bank_transaction_id', lk.bank_transaction_id,
          'allocated_amount', lk.allocated_amount,
          'method', lk.method,
          'state', lk.state,
          'match_reason', lk.match_reason
        ) ORDER BY lk.created_at)
        FROM public.deposit_match_links lk
        WHERE lk.item_id = i.id
      ), '[]'::jsonb)
    ) AS l
    FROM public.deposit_match_items i
    JOIN public.deposit_match_rules r ON r.id = i.rule_id
    WHERE i.restaurant_id = p_restaurant_id
      AND i.business_date BETWEEN p_start_date AND p_end_date
    ORDER BY i.business_date, r.pos_source
  ) y;

  -- Every bank the restaurant has connected, not only banks an existing
  -- rule already references. A rule-gated join left the SetupDialog's bank
  -- picker empty for the very first rule, so no user could ever create one
  -- (found writing the Task 6 E2E test).
  SELECT COALESCE(jsonb_agg(b), '[]'::jsonb) INTO v_banks
  FROM (
    SELECT jsonb_build_object(
      'connected_bank_id', cb.id,
      'institution_name', cb.institution_name,
      'status', cb.status,
      'data_current_through', cb.data_current_through
    ) AS b
    FROM public.connected_banks cb
    WHERE cb.restaurant_id = p_restaurant_id
    ORDER BY cb.institution_name
  ) z;

  RETURN jsonb_build_object(
    'summary', v_summary,
    'streams', v_streams,
    'ledger', v_ledger,
    'banks', v_banks
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_deposit_match_report(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_deposit_match_report(uuid, date, date) TO authenticated;
