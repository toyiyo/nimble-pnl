-- =============================================================
-- Anomaly Detectors: detect_uncategorized_backlog,
-- detect_reconciliation_gaps, detect_metric_anomalies
-- =============================================================

-- 1. Detect uncategorized transaction backlog
CREATE OR REPLACE FUNCTION public.detect_uncategorized_backlog(
  p_restaurant_id UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_bank_count INTEGER;
  v_pos_count INTEGER;
  v_total INTEGER;
  v_priority INTEGER;
  v_existing_id UUID;
BEGIN
  -- Count uncategorized bank transactions
  SELECT COUNT(*) INTO v_bank_count
  FROM bank_transactions
  WHERE restaurant_id = p_restaurant_id
    AND category_id IS NULL;

  -- Count uncategorized POS sales
  SELECT COUNT(*) INTO v_pos_count
  FROM unified_sales
  WHERE restaurant_id = p_restaurant_id
    AND category_id IS NULL;

  v_total := v_bank_count + v_pos_count;

  IF v_total = 0 THEN
    -- Auto-resolve existing open items
    UPDATE ops_inbox_item
    SET status = 'done', resolved_at = now(), resolved_by = NULL
    WHERE restaurant_id = p_restaurant_id
      AND kind IN ('uncategorized_txn', 'uncategorized_pos')
      AND status = 'open';
    RETURN 0;
  END IF;

  -- Determine priority
  v_priority := CASE
    WHEN v_total > 50 THEN 1  -- critical
    WHEN v_total > 20 THEN 2  -- high
    WHEN v_total > 5  THEN 3  -- medium
    ELSE 4                     -- low
  END;

  -- Upsert bank transaction inbox item
  IF v_bank_count > 0 THEN
    SELECT id INTO v_existing_id
    FROM ops_inbox_item
    WHERE restaurant_id = p_restaurant_id
      AND kind = 'uncategorized_txn'
      AND status = 'open';

    IF v_existing_id IS NOT NULL THEN
      UPDATE ops_inbox_item
      SET title = v_bank_count || ' uncategorized bank transactions',
          description = 'Bank transactions need to be categorized for accurate P&L reporting.',
          priority = v_priority,
          meta = jsonb_build_object('count', v_bank_count)
      WHERE id = v_existing_id;
    ELSE
      INSERT INTO ops_inbox_item (restaurant_id, title, description, kind, priority, meta, created_by)
      VALUES (
        p_restaurant_id,
        v_bank_count || ' uncategorized bank transactions',
        'Bank transactions need to be categorized for accurate P&L reporting.',
        'uncategorized_txn',
        v_priority,
        jsonb_build_object('count', v_bank_count),
        'system'
      );
    END IF;
  END IF;

  -- Upsert POS sales inbox item
  IF v_pos_count > 0 THEN
    SELECT id INTO v_existing_id
    FROM ops_inbox_item
    WHERE restaurant_id = p_restaurant_id
      AND kind = 'uncategorized_pos'
      AND status = 'open';

    IF v_existing_id IS NOT NULL THEN
      UPDATE ops_inbox_item
      SET title = v_pos_count || ' uncategorized POS sales',
          description = 'POS sales items need categories for accurate revenue breakdown.',
          priority = v_priority,
          meta = jsonb_build_object('count', v_pos_count)
      WHERE id = v_existing_id;
    ELSE
      INSERT INTO ops_inbox_item (restaurant_id, title, description, kind, priority, meta, created_by)
      VALUES (
        p_restaurant_id,
        v_pos_count || ' uncategorized POS sales',
        'POS sales items need categories for accurate revenue breakdown.',
        'uncategorized_pos',
        v_priority,
        jsonb_build_object('count', v_pos_count),
        'system'
      );
    END IF;
  END IF;

  RETURN v_total;
END;
$$;

-- 2. Detect metric anomalies (from variance engine)
CREATE OR REPLACE FUNCTION public.detect_metric_anomalies(
  p_restaurant_id UUID,
  p_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_variances JSONB;
  v_variance JSONB;
  v_count INTEGER := 0;
  v_existing_id UUID;
  v_flag TEXT;
  v_metric TEXT;
  v_priority INTEGER;
BEGIN
  v_variances := compute_daily_variances(p_restaurant_id, p_date);

  FOR v_variance IN SELECT * FROM jsonb_array_elements(v_variances)
  LOOP
    v_flag := v_variance->>'flag';
    v_metric := v_variance->>'metric';

    IF v_flag IS NOT NULL AND v_flag != 'null' THEN
      v_priority := CASE v_flag WHEN 'critical' THEN 1 ELSE 2 END;

      -- Check for existing open item for same metric
      SELECT id INTO v_existing_id
      FROM ops_inbox_item
      WHERE restaurant_id = p_restaurant_id
        AND kind = 'anomaly'
        AND linked_entity_type = 'daily_pnl'
        AND meta->>'metric' = v_metric
        AND status = 'open';

      IF v_existing_id IS NULL THEN
        INSERT INTO ops_inbox_item (
          restaurant_id, title, description, kind, priority, status,
          linked_entity_type, evidence_json, meta, created_by
        )
        VALUES (
          p_restaurant_id,
          CASE v_metric
            WHEN 'net_revenue' THEN 'Revenue ' || CASE WHEN (v_variance->>'direction') = 'down' THEN 'dropped' ELSE 'spiked' END || ' — ' || v_flag
            WHEN 'food_cost_pct' THEN 'Food cost at ' || (v_variance->>'value') || '% — ' || v_flag
            WHEN 'labor_cost_pct' THEN 'Labor cost at ' || (v_variance->>'value') || '% — ' || v_flag
            WHEN 'prime_cost_pct' THEN 'Prime cost at ' || (v_variance->>'value') || '% — ' || v_flag
            ELSE v_metric || ' anomaly — ' || v_flag
          END,
          'Detected on ' || p_date || '. Prior day: ' || COALESCE(v_variance->>'prior_day', 'N/A') || ', 7-day avg: ' || COALESCE(v_variance->>'avg_7day', 'N/A'),
          'anomaly',
          v_priority,
          'open',
          'daily_pnl',
          jsonb_build_array(jsonb_build_object(
            'table', 'daily_pnl',
            'date', p_date,
            'summary', 'P&L for ' || p_date
          )),
          jsonb_build_object('metric', v_metric, 'value', v_variance->'value', 'flag', v_flag, 'date', p_date),
          'variance_detector'
        );
        v_count := v_count + 1;
      ELSE
        -- Update existing item with latest data
        UPDATE ops_inbox_item
        SET priority = v_priority,
            meta = jsonb_build_object('metric', v_metric, 'value', v_variance->'value', 'flag', v_flag, 'date', p_date)
        WHERE id = v_existing_id;
      END IF;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

-- 3. Detect reconciliation gaps
CREATE OR REPLACE FUNCTION public.detect_reconciliation_gaps(
  p_restaurant_id UUID,
  p_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pos_total DECIMAL(12,2);
  v_bank_deposits DECIMAL(12,2);
  v_diff DECIMAL(12,2);
  v_tolerance DECIMAL(12,2) := 50.00;
  v_existing_id UUID;
  v_count INTEGER := 0;
BEGIN
  -- Get POS sales total for the date
  SELECT COALESCE(SUM(net_revenue), 0) INTO v_pos_total
  FROM daily_sales
  WHERE restaurant_id = p_restaurant_id AND date = p_date;

  -- Get bank deposits (positive amounts) for the date
  SELECT COALESCE(SUM(amount), 0) INTO v_bank_deposits
  FROM bank_transactions
  WHERE restaurant_id = p_restaurant_id
    AND transaction_date::date = p_date
    AND amount > 0;

  -- If we have POS data but no bank deposits (or vice versa), flag it
  IF v_pos_total > 0 AND v_bank_deposits = 0 THEN
    SELECT id INTO v_existing_id
    FROM ops_inbox_item
    WHERE restaurant_id = p_restaurant_id
      AND kind = 'reconciliation'
      AND meta->>'date' = p_date::text
      AND meta->>'type' = 'missing_deposit'
      AND status = 'open';

    IF v_existing_id IS NULL THEN
      INSERT INTO ops_inbox_item (
        restaurant_id, title, description, kind, priority,
        linked_entity_type, meta, created_by
      )
      VALUES (
        p_restaurant_id,
        'Missing bank deposit for ' || p_date,
        'POS shows $' || v_pos_total || ' in sales but no matching bank deposit found.',
        'reconciliation', 2,
        'bank_transaction',
        jsonb_build_object('type', 'missing_deposit', 'date', p_date, 'pos_total', v_pos_total),
        'reconciliation_check'
      );
      v_count := v_count + 1;
    END IF;

  ELSIF v_pos_total > 0 AND v_bank_deposits > 0 THEN
    v_diff := ABS(v_pos_total - v_bank_deposits);
    IF v_diff > v_tolerance THEN
      SELECT id INTO v_existing_id
      FROM ops_inbox_item
      WHERE restaurant_id = p_restaurant_id
        AND kind = 'reconciliation'
        AND meta->>'date' = p_date::text
        AND meta->>'type' = 'deposit_mismatch'
        AND status = 'open';

      IF v_existing_id IS NULL THEN
        INSERT INTO ops_inbox_item (
          restaurant_id, title, description, kind, priority,
          linked_entity_type, meta, created_by
        )
        VALUES (
          p_restaurant_id,
          'Deposit mismatch on ' || p_date || ' ($' || ROUND(v_diff, 2) || ' difference)',
          'POS total: $' || v_pos_total || ', Bank deposits: $' || v_bank_deposits || '. Difference exceeds $' || v_tolerance || ' tolerance.',
          'reconciliation',
          CASE WHEN v_diff > 500 THEN 1 WHEN v_diff > 200 THEN 2 ELSE 3 END,
          'bank_transaction',
          jsonb_build_object('type', 'deposit_mismatch', 'date', p_date, 'pos_total', v_pos_total, 'bank_deposits', v_bank_deposits, 'difference', v_diff),
          'reconciliation_check'
        );
        v_count := v_count + 1;
      END IF;
    END IF;
  END IF;

  RETURN v_count;
END;
$$;
