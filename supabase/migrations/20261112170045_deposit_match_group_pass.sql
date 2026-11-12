-- Deposit Match group pass: link 2 or 3 adjacent open POS items to 1 or 2
-- open bank deposits when the sums agree (gross rules; net rules and the
-- group state follow in later changes).
-- Design: docs/superpowers/specs/2026-11-11-deposit-match-pair-design.md
-- The body is the body of 20260904150000_deposit_match_business_day_lag.sql
-- plus step 3b. No schema change.

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
  v_group           RECORD;
  v_state           text;
  v_taken_items     uuid[];
  v_taken_txns      uuid[];
  v_shares          numeric[];
  v_share_sum       numeric;
  v_share_ok        boolean;
  v_ii              int;
  v_jj              int;
  v_item_left       numeric;
  v_dep_left        numeric;
  v_piece           numeric;
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
            public.deposit_match_lag_window_start(i.business_date, v_rule.lag_days_min)
          AND bt.transaction_date <
            public.deposit_match_lag_window_end(i.business_date, v_rule.lag_days_max)
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
            public.deposit_match_lag_window_start(i.business_date, v_rule.lag_days_max)
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
          -- Same half-open business-day window as the candidate join above
          -- (design doc, site 3) — the shared deposit_match_lag_window_*
          -- functions keep the two windows identical by construction.
          AND bt2.transaction_date >=
            public.deposit_match_lag_window_start(v_cand.business_date, v_rule.lag_days_min)
          AND bt2.transaction_date <
            public.deposit_match_lag_window_end(v_cand.business_date, v_rule.lag_days_max)
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

      -- Step 3b: group pass. Link 2 or 3 adjacent open items to 1 or 2
      -- open deposits when the sums agree. Design:
      -- docs/superpowers/specs/2026-11-11-deposit-match-pair-design.md
      -- The nested block keeps the 1:1 links if the group pass fails.
      BEGIN
        v_taken_items := '{}';
        v_taken_txns := '{}';

        IF v_rule.settlement = 'gross' THEN
          FOR v_group IN
            WITH open_items AS (
              SELECT i.id, i.business_date, i.expected_amount,
                     public.deposit_match_lag_window_start(i.business_date, v_rule.lag_days_min) AS w_lo,
                     public.deposit_match_lag_window_end(i.business_date, v_rule.lag_days_max) AS w_hi
              FROM public.deposit_match_items i
              WHERE i.rule_id = v_rule.id
                AND i.business_date BETWEEN p_start_date AND p_end_date
                AND i.expected_amount > 0
                AND NOT (i.id = ANY(v_assigned_items))
                AND NOT EXISTS (SELECT 1 FROM public.deposit_match_links l2 WHERE l2.item_id = i.id)
                AND v_bank.status = 'connected'
                AND v_bank.data_current_through IS NOT NULL
                AND v_bank.data_current_through >=
                  public.deposit_match_lag_window_start(i.business_date, v_rule.lag_days_max)
            ),
            item_groups AS (
              SELECT row_number() OVER () AS gid, g.*
              FROM (
                SELECT ARRAY[a.id, b.id] AS item_ids,
                       ARRAY[a.expected_amount, b.expected_amount] AS expected_amounts,
                       ARRAY[a.w_lo, b.w_lo] AS w_los,
                       ARRAY[a.w_hi, b.w_hi] AS w_his,
                       a.business_date AS first_date,
                       a.expected_amount + b.expected_amount AS e_sum
                FROM open_items a
                JOIN open_items b ON b.business_date = a.business_date + 1
                UNION ALL
                SELECT ARRAY[a.id, b.id, c.id],
                       ARRAY[a.expected_amount, b.expected_amount, c.expected_amount],
                       ARRAY[a.w_lo, b.w_lo, c.w_lo],
                       ARRAY[a.w_hi, b.w_hi, c.w_hi],
                       a.business_date,
                       a.expected_amount + b.expected_amount + c.expected_amount
                FROM open_items a
                JOIN open_items b ON b.business_date = a.business_date + 1
                JOIN open_items c ON c.business_date = a.business_date + 2
              ) g
            ),
            open_txns AS (
              SELECT bt.id, bt.transaction_date, bt.amount
              FROM public.bank_transactions bt
              WHERE bt.restaurant_id = p_restaurant_id
                AND bt.connected_bank_id = v_rule.connected_bank_id
                AND bt.amount > 0
                AND bt.is_transfer IS NOT TRUE
                AND (v_rule.descriptor_pattern IS NULL OR bt.description ~* v_rule.descriptor_pattern)
                AND NOT (bt.id = ANY(v_assigned_txns))
                AND NOT EXISTS (
                  SELECT 1 FROM public.deposit_match_links l3
                  WHERE l3.bank_transaction_id = bt.id AND l3.state = 'confirmed'
                    AND l3.restaurant_id = p_restaurant_id
                )
            ),
            group_txns AS (
              SELECT x.gid, x.id, x.transaction_date, x.amount
              FROM (
                SELECT g.gid, ot.id, ot.transaction_date, ot.amount,
                       row_number() OVER (
                         PARTITION BY g.gid
                         ORDER BY abs((ot.transaction_date AT TIME ZONE 'UTC')::date - g.first_date),
                                  ot.transaction_date, ot.id
                       ) AS rn
                FROM item_groups g
                JOIN open_txns ot ON EXISTS (
                  SELECT 1 FROM unnest(g.w_los, g.w_his) AS w(lo, hi)
                  WHERE ot.transaction_date >= w.lo AND ot.transaction_date < w.hi
                )
              ) x
              WHERE x.rn <= 12
            ),
            deposit_sets AS (
              SELECT t.gid, ARRAY[t.id] AS txn_ids, ARRAY[t.amount] AS txn_amounts,
                     t.amount AS d_sum
              FROM group_txns t
              UNION ALL
              SELECT t1.gid,
                     CASE WHEN (t1.transaction_date, t1.id) <= (t2.transaction_date, t2.id)
                          THEN ARRAY[t1.id, t2.id] ELSE ARRAY[t2.id, t1.id] END,
                     CASE WHEN (t1.transaction_date, t1.id) <= (t2.transaction_date, t2.id)
                          THEN ARRAY[t1.amount, t2.amount] ELSE ARRAY[t2.amount, t1.amount] END,
                     t1.amount + t2.amount
              FROM group_txns t1
              JOIN group_txns t2 ON t2.gid = t1.gid AND t1.id < t2.id
            ),
            candidates AS (
              SELECT g.item_ids, g.expected_amounts, g.first_date, g.e_sum,
                     d.txn_ids, d.txn_amounts, d.d_sum,
                     abs(g.e_sum - d.d_sum) AS fit_score
              FROM item_groups g
              JOIN deposit_sets d ON d.gid = g.gid
              WHERE abs(g.e_sum - d.d_sum) <=
                GREATEST(v_rule.amount_tolerance, g.e_sum * v_rule.amount_tolerance_pct)
            )
            SELECT * FROM candidates
            ORDER BY fit_score ASC,
                     cardinality(item_ids) + cardinality(txn_ids) ASC,
                     first_date ASC, txn_ids ASC
          LOOP
            IF v_group.item_ids && v_taken_items OR v_group.txn_ids && v_taken_txns THEN
              CONTINUE;
            END IF;

            -- Item shares: in proportion to expected_amount. The last
            -- item takes the rest, so the shares sum to the deposit sum.
            v_shares := '{}';
            v_share_sum := 0;
            v_share_ok := true;
            FOR v_ii IN 1..cardinality(v_group.item_ids) LOOP
              IF v_ii < cardinality(v_group.item_ids) THEN
                v_shares[v_ii] := round(v_group.d_sum * v_group.expected_amounts[v_ii] / v_group.e_sum, 2);
                v_share_sum := v_share_sum + v_shares[v_ii];
              ELSE
                v_shares[v_ii] := v_group.d_sum - v_share_sum;
              END IF;
              IF v_shares[v_ii] <= 0 THEN
                v_share_ok := false;
              END IF;
            END LOOP;
            IF NOT v_share_ok THEN
              CONTINUE;
            END IF;

            -- Task 2 replaces this with the group state.
            v_state := 'confirmed';

            -- Waterfall: each deposit fills the current item up to its
            -- share. The rest goes to the next item.
            v_ii := 1;
            v_jj := 1;
            v_item_left := v_shares[1];
            v_dep_left := v_group.txn_amounts[1];
            WHILE v_ii <= cardinality(v_group.item_ids) AND v_jj <= cardinality(v_group.txn_ids) LOOP
              v_piece := LEAST(v_item_left, v_dep_left);
              IF v_piece > 0 THEN
                INSERT INTO public.deposit_match_links
                  (restaurant_id, item_id, bank_transaction_id, allocated_amount, method, state, match_reason)
                VALUES
                  (p_restaurant_id, v_group.item_ids[v_ii], v_group.txn_ids[v_jj], v_piece,
                   'auto', v_state, 'group_gross_fit');
              END IF;
              v_item_left := v_item_left - v_piece;
              v_dep_left := v_dep_left - v_piece;
              IF v_item_left = 0 THEN
                v_ii := v_ii + 1;
                v_item_left := v_shares[v_ii];
              END IF;
              IF v_dep_left = 0 THEN
                v_jj := v_jj + 1;
                v_dep_left := v_group.txn_amounts[v_jj];
              END IF;
            END LOOP;

            v_taken_items := v_taken_items || v_group.item_ids;
            v_taken_txns := v_taken_txns || v_group.txn_ids;
          END LOOP;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'refresh_deposit_matches: group pass failed for rule %: %', v_rule.id, SQLERRM;
      END;

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
        -- v_bank_stale reuses v_expected_by (same value
        -- deposit_match_lag_window_end would derive) instead of calling
        -- that function again, so the business-day search does not run
        -- twice per item per loop iteration.
        v_bank_dead := v_bank.status IS DISTINCT FROM 'connected'
          OR v_bank.data_current_through IS NULL;
        v_bank_stale := v_bank.data_current_through <
          (v_expected_by + 1)::timestamp AT TIME ZONE 'UTC';

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
