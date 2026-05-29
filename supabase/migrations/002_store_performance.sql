-- Store Performance aggregate functions
-- Apply via: Supabase SQL Editor → paste and run
-- Or: supabase db push (if using local CLI)
--
-- These functions run COUNT(DISTINCT ...) and SUM() in the database so the
-- API never fetches raw sales rows.  All four are SECURITY DEFINER so they
-- bypass any RLS on the sales table (access is enforced in the API route).

-- ── 1. Per-store summary with previous-period comparison ──────────────────────
CREATE OR REPLACE FUNCTION sp_store_summary(
  p_date_from  date,
  p_date_to    date,
  p_prev_from  date,
  p_prev_to    date,
  p_store_id   text    DEFAULT NULL,
  p_store_ids  text[]  DEFAULT NULL
)
RETURNS TABLE (
  store_id      text,
  revenue       numeric,
  bills         bigint,
  units         numeric,
  prev_revenue  numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH curr AS (
    SELECT
      store_id::text           AS sid,
      SUM(net_amount)          AS revenue,
      COUNT(DISTINCT bill_no)  AS bills,
      SUM(qty::numeric)        AS units
    FROM sales
    WHERE bill_date::date >= p_date_from
      AND bill_date::date <= p_date_to
      AND (p_store_id  IS NULL OR store_id::text = p_store_id)
      AND (p_store_ids IS NULL OR store_id::text = ANY(p_store_ids))
    GROUP BY store_id
  ),
  prev AS (
    SELECT
      store_id::text  AS sid,
      SUM(net_amount) AS revenue
    FROM sales
    WHERE bill_date::date >= p_prev_from
      AND bill_date::date <= p_prev_to
      AND (p_store_id  IS NULL OR store_id::text = p_store_id)
      AND (p_store_ids IS NULL OR store_id::text = ANY(p_store_ids))
    GROUP BY store_id
  )
  SELECT
    c.sid,
    c.revenue,
    c.bills,
    c.units,
    COALESCE(p.revenue, 0) AS prev_revenue
  FROM curr c
  LEFT JOIN prev p ON p.sid = c.sid;
$$;

GRANT EXECUTE ON FUNCTION sp_store_summary TO authenticated;

-- ── 2. Global totals (COUNT DISTINCT across all filtered stores) ──────────────
CREATE OR REPLACE FUNCTION sp_totals(
  p_date_from  date,
  p_date_to    date,
  p_store_id   text    DEFAULT NULL,
  p_store_ids  text[]  DEFAULT NULL
)
RETURNS TABLE (
  revenue  numeric,
  bills    bigint,
  units    numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    SUM(net_amount)          AS revenue,
    COUNT(DISTINCT bill_no)  AS bills,
    SUM(qty::numeric)        AS units
  FROM sales
  WHERE bill_date::date >= p_date_from
    AND bill_date::date <= p_date_to
    AND (p_store_id  IS NULL OR store_id::text = p_store_id)
    AND (p_store_ids IS NULL OR store_id::text = ANY(p_store_ids));
$$;

GRANT EXECUTE ON FUNCTION sp_totals TO authenticated;

-- ── 3. Daily revenue trend ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sp_daily_trend(
  p_date_from  date,
  p_date_to    date,
  p_store_id   text    DEFAULT NULL,
  p_store_ids  text[]  DEFAULT NULL
)
RETURNS TABLE (
  date     text,
  revenue  numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    bill_date::text  AS date,
    SUM(net_amount)  AS revenue
  FROM sales
  WHERE bill_date::date >= p_date_from
    AND bill_date::date <= p_date_to
    AND (p_store_id  IS NULL OR store_id::text = p_store_id)
    AND (p_store_ids IS NULL OR store_id::text = ANY(p_store_ids))
  GROUP BY bill_date
  ORDER BY bill_date;
$$;

GRANT EXECUTE ON FUNCTION sp_daily_trend TO authenticated;

-- ── 4. Top N products by revenue ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sp_top_products(
  p_date_from  date,
  p_date_to    date,
  p_store_id   text    DEFAULT NULL,
  p_store_ids  text[]  DEFAULT NULL,
  p_limit      int     DEFAULT 10
)
RETURNS TABLE (
  barcode  text,
  revenue  numeric,
  qty      numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    barcode::text     AS barcode,
    SUM(net_amount)   AS revenue,
    SUM(qty::numeric) AS qty
  FROM sales
  WHERE bill_date::date >= p_date_from
    AND bill_date::date <= p_date_to
    AND (p_store_id  IS NULL OR store_id::text = p_store_id)
    AND (p_store_ids IS NULL OR store_id::text = ANY(p_store_ids))
  GROUP BY barcode
  ORDER BY revenue DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION sp_top_products TO authenticated;
