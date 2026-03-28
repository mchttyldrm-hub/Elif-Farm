// ============================================================
// EF-Stok — Dashboard ve raporlar
// GET /api/stok/dashboard
// GET /api/stok/reports/stock
// GET /api/stok/reports/weekly
// GET /api/stok/reports/monthly
// ============================================================

import { Env, ok } from '../../types';
import { AuthContext } from '../../types';
import { getWeekRange, getYearMonth, today } from '../../lib/week';

// GET /api/stok/dashboard
// Kural 4: kesin_gelir / bekleyen_box / toplam_sevk_box ayrı döndürülür
export async function getDashboard(
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  const date = new URL(request.url).searchParams.get('date') ?? today();

  // Bugünkü üretim — kümes + kategori bazlı (iptal edilmemiş)
  const productionRows = await env.DB.prepare(`
    SELECT p.coop_id, c.name AS coop_name, p.category,
           COALESCE(SUM(p.kg), 0)        AS total_kg,
           COALESCE(SUM(p.box_count), 0) AS total_box
    FROM productions p JOIN coops c ON c.id = p.coop_id
    WHERE p.production_date = ? AND p.is_reversed = 0
    GROUP BY p.coop_id, p.category
    ORDER BY p.coop_id, p.category
  `).bind(date).all();

  // Mevcut stok — sadece sıfırdan büyük olan (0 değerli satırlar gösterilmez)
  const isEmployee = auth.user.role === 'employee';
  const stockRows = await env.DB.prepare(`
    SELECT ss.coop_id, c.name AS coop_name, ss.category, ss.total_kg, ss.total_box
    FROM stock_summary ss JOIN coops c ON c.id = ss.coop_id
    WHERE ss.total_box > 0 ${isEmployee ? 'AND c.is_active = 1' : ''}
    ORDER BY ss.coop_id, ss.category
  `).all();

  // Kural 4: gelir özeti
  const revenueRow = await env.DB.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN sl.price_per_box IS NOT NULL
                   THEN sl.price_per_box * sl.box_count END), 0) AS kesin_gelir,
      COALESCE(SUM(CASE WHEN sl.price_per_box IS NULL
                   THEN sl.box_count END), 0)                    AS bekleyen_box,
      COALESCE(SUM(sl.box_count), 0)                             AS toplam_sevk_box
    FROM sale_lines sl
    JOIN sales s ON s.id = sl.sale_id
    WHERE s.status NOT IN ('cancelled')
      AND s.transaction_date = ?
  `).bind(date).first<{ kesin_gelir: number; bekleyen_box: number; toplam_sevk_box: number }>();

  // Bekleyen satışlar (fiyat eksik)
  const pendingSales = await env.DB.prepare(`
    SELECT s.id, s.sale_no, s.transaction_date,
           COUNT(CASE WHEN sl.price_per_box IS NULL THEN 1 END) AS unpriced_count
    FROM sales s JOIN sale_lines sl ON sl.sale_id = s.id
    WHERE s.status IN ('pending','partially_priced')
    GROUP BY s.id
    ORDER BY s.transaction_date DESC
    LIMIT 10
  `).all();

  // Mevcut hafta kapanış durumu
  const { week_start, week_end } = getWeekRange(date);
  const weekRecord = await env.DB.prepare(
    'SELECT status FROM weekly_closings WHERE week_start = ?'
  ).bind(week_start).first<{ status: string }>();

  // Mevcut ay kapanış durumu
  const { year, month } = getYearMonth(date);
  const monthRecord = await env.DB.prepare(
    'SELECT status FROM monthly_closings_stok WHERE year = ? AND month = ?'
  ).bind(year, month).first<{ status: string }>();

  return ok({
    date,
    production:      productionRows.results,
    stock:           stockRows.results,
    revenue: {
      kesin_gelir:     revenueRow?.kesin_gelir ?? 0,
      bekleyen_box:    revenueRow?.bekleyen_box ?? 0,
      toplam_sevk_box: revenueRow?.toplam_sevk_box ?? 0,
    },
    pending_sales:   pendingSales.results,
    current_week:  { week_start, week_end, status: weekRecord?.status ?? 'open' },
    current_month: { year, month, status: monthRecord?.status ?? 'open' },
  });
}

// GET /api/stok/reports/stock — anlık stok durumu
export async function getStockReport(
  _request: Request,
  env: Env,
  _auth: AuthContext
): Promise<Response> {
  const rows = await env.DB.prepare(`
    SELECT ss.coop_id, c.name AS coop_name, ss.category,
           ss.total_kg, ss.total_box,
           ss.updated_at,
           (SELECT MAX(sl.created_at) FROM stock_ledger sl
            WHERE sl.coop_id = ss.coop_id AND sl.category = ss.category) AS last_movement
    FROM stock_summary ss JOIN coops c ON c.id = ss.coop_id
    ORDER BY ss.coop_id, ss.category
  `).all();

  return ok(rows.results);
}

// GET /api/stok/reports/weekly?date=YYYY-MM-DD
// Kural 4: kesin_gelir / bekleyen / toplam_sevk ayrı
export async function getWeeklyReport(
  request: Request,
  env: Env,
  _auth: AuthContext
): Promise<Response> {
  const url = new URL(request.url);
  const { week_start, week_end } = getWeekRange(url.searchParams.get('date') ?? today());

  // Satış özeti — kategori bazlı
  const salesSummary = await env.DB.prepare(`
    SELECT
      sl.category,
      COALESCE(SUM(sl.kg), 0)                                                           AS total_kg,
      COALESCE(SUM(sl.box_count), 0)                                                    AS toplam_sevk_box,
      COALESCE(SUM(CASE WHEN sl.price_per_box IS NOT NULL
                   THEN sl.price_per_box * sl.box_count END), 0)                        AS kesin_gelir,
      COALESCE(SUM(CASE WHEN sl.price_per_box IS NULL THEN sl.box_count END), 0)        AS bekleyen_box,
      COALESCE(AVG(CASE WHEN sl.price_per_box IS NOT NULL THEN sl.price_per_box END), 0) AS avg_price
    FROM sale_lines sl
    JOIN sales s ON s.id = sl.sale_id
    WHERE s.transaction_date BETWEEN ? AND ?
      AND s.status NOT IN ('cancelled')
    GROUP BY sl.category
  `).bind(week_start, week_end).all();

  // Üretim özeti — kümes + kategori bazlı
  const productionSummary = await env.DB.prepare(`
    SELECT p.coop_id, c.name AS coop_name, p.category,
           COALESCE(SUM(p.kg), 0)        AS total_kg,
           COALESCE(SUM(p.box_count), 0) AS total_box
    FROM productions p JOIN coops c ON c.id = p.coop_id
    WHERE p.production_date BETWEEN ? AND ? AND p.is_reversed = 0
    GROUP BY p.coop_id, p.category
    ORDER BY p.coop_id, p.category
  `).bind(week_start, week_end).all();

  // Kapanış durumu
  const closing = await env.DB.prepare(
    'SELECT status, closed_at FROM weekly_closings WHERE week_start = ?'
  ).bind(week_start).first();

  return ok({
    week_start, week_end,
    closing_status: closing ?? { status: 'open', closed_at: null },
    sales_by_category: salesSummary.results,
    production_by_coop: productionSummary.results,
  });
}

// GET /api/stok/reports/monthly?year=&month=
export async function getMonthlyReport(
  request: Request,
  env: Env,
  _auth: AuthContext
): Promise<Response> {
  const url = new URL(request.url);
  const { year, month } = url.searchParams.get('year')
    ? { year: parseInt(url.searchParams.get('year')!), month: parseInt(url.searchParams.get('month')!) }
    : getYearMonth(today());

  const monthStr  = String(month).padStart(2, '0');
  const monthStart = `${year}-${monthStr}-01`;
  const monthEnd   = new Date(year, month, 0).toISOString().slice(0, 10);

  // Kategori bazlı satış özeti (Kural 4)
  const salesByCategory = await env.DB.prepare(`
    SELECT
      sl.category,
      COALESCE(SUM(sl.kg), 0)                                               AS total_kg,
      COALESCE(SUM(sl.box_count), 0)                                        AS toplam_sevk_box,
      COALESCE(SUM(CASE WHEN sl.price_per_box IS NOT NULL
                   THEN sl.price_per_box * sl.box_count END), 0)            AS kesin_gelir,
      COALESCE(SUM(CASE WHEN sl.price_per_box IS NULL
                   THEN sl.box_count END), 0)                               AS bekleyen_box,
      COALESCE(AVG(CASE WHEN sl.price_per_box IS NOT NULL
                   THEN sl.price_per_box END), 0)                           AS avg_price
    FROM sale_lines sl
    JOIN sales s ON s.id = sl.sale_id
    WHERE s.transaction_date BETWEEN ? AND ? AND s.status NOT IN ('cancelled')
    GROUP BY sl.category
  `).bind(monthStart, monthEnd).all();

  // Kümes bazlı üretim özeti
  const productionByCoop = await env.DB.prepare(`
    SELECT p.coop_id, c.name AS coop_name, p.category,
           COALESCE(SUM(p.kg), 0)        AS total_kg,
           COALESCE(SUM(p.box_count), 0) AS total_box
    FROM productions p JOIN coops c ON c.id = p.coop_id
    WHERE p.production_date BETWEEN ? AND ? AND p.is_reversed = 0
    GROUP BY p.coop_id, p.category
    ORDER BY p.coop_id, p.category
  `).bind(monthStart, monthEnd).all();

  // Eksik fiyatlı satışlar
  const unpricedSales = await env.DB.prepare(`
    SELECT s.id, s.sale_no, s.transaction_date,
           sl.category, sl.box_count
    FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id
    WHERE s.transaction_date BETWEEN ? AND ?
      AND s.status NOT IN ('cancelled','closed')
      AND sl.price_per_box IS NULL
    ORDER BY s.transaction_date
  `).bind(monthStart, monthEnd).all();

  // Kapanış durumu
  const closing = await env.DB.prepare(
    'SELECT status, closed_at FROM monthly_closings_stok WHERE year = ? AND month = ?'
  ).bind(year, month).first();

  return ok({
    year, month,
    closing_status: closing ?? { status: 'open', closed_at: null },
    sales_by_category:   salesByCategory.results,
    production_by_coop:  productionByCoop.results,
    unpriced_sales:      unpricedSales.results,
  });
}
