// ============================================================
// EF-Yem — Dashboard ve raporlar
// GET /api/yem/dashboard
// GET /api/yem/reports/monthly
// ============================================================

import { Env, ok } from '../../types';
import { AuthContext } from '../../types';
import { getYearMonth, today } from '../../lib/week';
import { calcConsumption } from './silo';

// GET /api/yem/dashboard
export async function getDashboard(
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  const date = new URL(request.url).searchParams.get('date') ?? today();
  const isEmployee = auth.user.role === 'employee';

  // Aktif kümesler
  const coops = await env.DB.prepare(
    `SELECT id, name FROM coops WHERE is_active = 1 ORDER BY id`
  ).all<{ id: number; name: string }>();

  // Kümes bazlı bugün üretim + silo tüketimi
  const coopStats = await Promise.all(coops.results.map(async coop => {
    const prod = await env.DB.prepare(`
      SELECT COALESCE(SUM(quantity_kg), 0) AS produced_kg
      FROM feed_productions
      WHERE coop_id = ? AND production_date = ? AND is_reversed = 0
    `).bind(coop.id, date).first<{ produced_kg: number }>();

    const consumption = await calcConsumption(coop.id, date, env);

    return {
      coop_id:      coop.id,
      coop_name:    coop.name,
      produced_kg:  prod?.produced_kg ?? 0,
      consumption_kg: consumption,  // null = Kural 7
    };
  }));

  // Hammadde stok (kritik eşik dahil)
  const materialStock = await env.DB.prepare(`
    SELECT rm.id, rm.name, rm.min_stock_kg, rm.is_active,
           COALESCE(rms.total_kg, 0) AS current_stock_kg,
           CASE WHEN COALESCE(rms.total_kg, 0) <= rm.min_stock_kg THEN 1 ELSE 0 END AS is_critical
    FROM raw_materials rm
    LEFT JOIN raw_material_summary rms ON rms.raw_material_id = rm.id
    WHERE rm.is_active = 1
    ORDER BY is_critical DESC, rm.name
  `).all();

  // Eksik fiyatlı alımlar
  const missingPriceCount = isEmployee ? 0 : await env.DB.prepare(`
    SELECT COUNT(*) AS cnt FROM raw_material_purchases
    WHERE status = 'missing_price' AND is_cancelled = 0
  `).first<{ cnt: number }>().then(r => r?.cnt ?? 0);

  // Bu ay kapanış durumu
  const { year, month } = getYearMonth(date);
  const monthRecord = await env.DB.prepare(
    'SELECT status FROM monthly_closings_yem WHERE year = ? AND month = ?'
  ).bind(year, month).first<{ status: string }>();

  return ok({
    date,
    coop_stats:         coopStats,
    material_stock:     materialStock.results,
    critical_count:     materialStock.results.filter((m: Record<string, unknown>) => m.is_critical).length,
    missing_price_count: missingPriceCount,
    current_month: { year, month, status: monthRecord?.status ?? 'open' },
  });
}

// GET /api/yem/reports/monthly?year=&month=
export async function getMonthlyReport(
  request: Request,
  env: Env,
  _auth: AuthContext
): Promise<Response> {
  const url = new URL(request.url);
  const { year, month } = url.searchParams.get('year')
    ? { year: parseInt(url.searchParams.get('year')!), month: parseInt(url.searchParams.get('month')!) }
    : getYearMonth(today());

  const monthStr   = String(month).padStart(2, '0');
  const monthStart = `${year}-${monthStr}-01`;
  const monthEnd   = new Date(year, month, 0).toISOString().slice(0, 10);

  // Kümes bazlı yem üretimi özeti
  const productionByCoop = await env.DB.prepare(`
    SELECT fp.coop_id, c.name AS coop_name,
           COALESCE(SUM(fp.quantity_kg), 0)        AS total_produced_kg,
           COALESCE(SUM(fp.total_cost_iqd), 0)     AS total_cost_iqd,
           CASE WHEN SUM(fp.quantity_kg) > 0
                THEN SUM(fp.total_cost_iqd) / SUM(fp.quantity_kg) * 1000
                ELSE 0 END                          AS avg_cost_per_ton
    FROM feed_productions fp JOIN coops c ON c.id = fp.coop_id
    WHERE fp.production_date BETWEEN ? AND ? AND fp.is_reversed = 0
    GROUP BY fp.coop_id ORDER BY fp.coop_id
  `).bind(monthStart, monthEnd).all();

  // Kümes bazlı silo tüketimi (tarih bazlı topla)
  const consumptionByCoop = await env.DB.prepare(`
    SELECT sc.coop_id, c.name AS coop_name,
           MIN(sc.closing_kg) AS min_closing,
           MAX(sc.closing_kg) AS max_closing
    FROM silo_closings sc JOIN coops c ON c.id = sc.coop_id
    WHERE sc.closing_date BETWEEN ? AND ?
    GROUP BY sc.coop_id
  `).bind(monthStart, monthEnd).all();

  // Hammadde alım özeti
  const purchaseSummary = await env.DB.prepare(`
    SELECT rm.name, rmp.status,
           COALESCE(SUM(rmp.quantity_kg), 0)       AS total_kg,
           COALESCE(SUM(rmp.total_price_iqd), 0)   AS total_cost
    FROM raw_material_purchases rmp
    JOIN raw_materials rm ON rm.id = rmp.raw_material_id
    WHERE rmp.transaction_date BETWEEN ? AND ? AND rmp.is_cancelled = 0
    GROUP BY rmp.raw_material_id, rmp.status
    ORDER BY rm.name
  `).bind(monthStart, monthEnd).all();

  // Eksik fiyatlı alımlar
  const missingPricePurchases = await env.DB.prepare(`
    SELECT rmp.id, rmp.transaction_date, rmp.quantity_kg, rmp.note,
           rm.name AS material_name
    FROM raw_material_purchases rmp
    JOIN raw_materials rm ON rm.id = rmp.raw_material_id
    WHERE rmp.transaction_date BETWEEN ? AND ?
      AND rmp.status = 'missing_price' AND rmp.is_cancelled = 0
    ORDER BY rmp.transaction_date
  `).bind(monthStart, monthEnd).all();

  // Mevcut stok değeri
  const stockValue = await env.DB.prepare(`
    SELECT COALESCE(SUM(rms.total_kg * (
      SELECT unit_price_iqd FROM raw_material_purchases
      WHERE raw_material_id = rms.raw_material_id AND status = 'complete' AND is_cancelled = 0
      ORDER BY transaction_date DESC LIMIT 1
    )), 0) AS total_value
    FROM raw_material_summary rms
  `).first<{ total_value: number }>();

  const closing = await env.DB.prepare(
    'SELECT status, closed_at FROM monthly_closings_yem WHERE year = ? AND month = ?'
  ).bind(year, month).first();

  return ok({
    year, month,
    closing_status:          closing ?? { status: 'open', closed_at: null },
    production_by_coop:      productionByCoop.results,
    consumption_by_coop:     consumptionByCoop.results,
    purchase_summary:        purchaseSummary.results,
    missing_price_purchases: missingPricePurchases.results,
    stock_value_iqd:         stockValue?.total_value ?? 0,
  });
}
