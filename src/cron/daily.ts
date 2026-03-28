// ============================================================
// Günlük cron görevleri — gün sonu bildirimler
// Aşama 6'da modül route'ları tamamlandıktan sonra detaylanacak
// ============================================================

import { Env } from '../types';
import { notifyByRoleAndModule } from '../lib/push';
import { today, getYearMonth } from '../lib/week';

export async function runDailyCron(env: Env): Promise<void> {
  const date = today();
  const { year, month } = getYearMonth(date);
  const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay(); // 5=Cuma

  // 1. Gün sonu üretim özeti (EF-Stok manager)
  await sendDayEndProductionSummary(date, env);

  // 2. Eksik fiyatlı satış uyarısı
  await sendMissingPriceSaleWarning(date, env);

  // 3. Cuma günü: haftalık kapanış engeli kontrolü
  if (dayOfWeek === 5) {
    await sendWeeklyClosingBlocker(date, env);
  }

  // 4. Kritik stok uyarısı (EF-Yem)
  await sendCriticalStockWarning(date, env);

  // 5. Eksik fiyatlı alım uyarısı (EF-Yem)
  await sendMissingPricePurchaseWarning(date, env);

  // 6. Ayın son günü: ay kapanış engeli
  const lastDayOfMonth = new Date(year, month, 0).toISOString().slice(0, 10);
  if (date === lastDayOfMonth) {
    await sendMonthlyClosingBlocker(date, env);
  }

  // 7. Gübre gün sonu özeti
  await sendManureDaySummary(date, env);
}

async function sendDayEndProductionSummary(date: string, env: Env): Promise<void> {
  // Bugünkü toplam üretimi topla
  const rows = await env.DB
    .prepare(`
      SELECT c.name AS coop_name, p.category, SUM(p.box_count) AS boxes
      FROM productions p JOIN coops c ON c.id = p.coop_id
      WHERE p.production_date = ? AND p.is_reversed = 0
      GROUP BY p.coop_id, p.category
    `)
    .bind(date)
    .all<{ coop_name: string; category: string; boxes: number }>();

  if (!rows.results.length) return;

  const summary = rows.results.map(r => `${r.coop_name} ${r.category}: ${r.boxes} kutu`).join(', ');

  await notifyByRoleAndModule(['manager'], 'ef_stok', 'day_end_production_summary', {
    title: 'Gün Sonu Üretim Özeti',
    body: summary,
    url: '/stok/dashboard',
  }, env, date);

  await notifyByRoleAndModule(['director'], 'ef_stok', 'day_end_production_summary', {
    title: 'Gün Sonu Üretim Özeti',
    body: summary,
    url: '/stok/dashboard',
  }, env, date);
}

async function sendMissingPriceSaleWarning(date: string, env: Env): Promise<void> {
  const row = await env.DB
    .prepare(`
      SELECT COUNT(*) AS cnt FROM sale_lines sl
      JOIN sales s ON s.id = sl.sale_id
      WHERE s.status NOT IN ('closed','cancelled') AND sl.price_per_box IS NULL
    `)
    .first<{ cnt: number }>();

  if (!row || row.cnt === 0) return;

  await notifyByRoleAndModule(['manager'], 'ef_stok', 'missing_price_sale', {
    title: 'Fiyatlanmamış Satış',
    body: `${row.cnt} satış satırının fiyatı girilmemiş`,
    url: '/stok/sales',
  }, env, date);
}

async function sendWeeklyClosingBlocker(date: string, env: Env): Promise<void> {
  // Bu hafta kapanmamış fiyatsız satış var mı?
  const row = await env.DB
    .prepare(`
      SELECT COUNT(*) AS cnt FROM sale_lines sl
      JOIN sales s ON s.id = sl.sale_id
      WHERE s.status NOT IN ('closed','cancelled') AND sl.price_per_box IS NULL
    `)
    .first<{ cnt: number }>();

  if (!row || row.cnt === 0) return;

  const payload = {
    title: 'Haftalık Kapanış Engeli',
    body: `${row.cnt} fiyatlanmamış satış satırı haftalık kapanışı engelliyor`,
    url: '/stok/closing/weekly',
  };

  await notifyByRoleAndModule(['manager'], 'ef_stok', 'weekly_closing_blocker', payload, env, date);
  await notifyByRoleAndModule(['director'], 'ef_stok', 'weekly_closing_blocker', payload, env, date);
}

async function sendCriticalStockWarning(date: string, env: Env): Promise<void> {
  // Min stok altına düşmüş hammaddeler
  const rows = await env.DB
    .prepare(`
      SELECT rm.name, rms.total_kg, rm.min_stock_kg
      FROM raw_material_summary rms
      JOIN raw_materials rm ON rm.id = rms.raw_material_id
      WHERE rms.total_kg < rm.min_stock_kg AND rm.is_active = 1
    `)
    .all<{ name: string; total_kg: number; min_stock_kg: number }>();

  if (!rows.results.length) return;

  const list = rows.results.map(r => `${r.name}: ${r.total_kg}kg (min: ${r.min_stock_kg}kg)`).join(', ');

  const payload = {
    title: 'Kritik Hammadde Stoku',
    body: list,
    url: '/yem/materials',
  };

  await notifyByRoleAndModule(['manager'], 'ef_yem', 'critical_stock_warning', payload, env, date);
  await notifyByRoleAndModule(['director'], 'ef_yem', 'critical_stock_warning', payload, env, date);
}

async function sendMissingPricePurchaseWarning(date: string, env: Env): Promise<void> {
  const row = await env.DB
    .prepare(`SELECT COUNT(*) AS cnt FROM raw_material_purchases WHERE status = 'missing_price'`)
    .first<{ cnt: number }>();

  if (!row || row.cnt === 0) return;

  await notifyByRoleAndModule(['manager'], 'ef_yem', 'missing_price_purchase', {
    title: 'Fiyatlanmamış Hammadde Alımı',
    body: `${row.cnt} alımın fiyatı girilmemiş`,
    url: '/yem/purchases',
  }, env, date);
}

async function sendMonthlyClosingBlocker(date: string, env: Env): Promise<void> {
  const { getYearMonth } = await import('../lib/week');
  const { year, month } = getYearMonth(date);

  // EF-Stok engelleri
  const unpricedStok = await env.DB
    .prepare(`
      SELECT COUNT(*) AS cnt FROM sale_lines sl
      JOIN sales s ON s.id = sl.sale_id
      WHERE strftime('%Y', s.transaction_date) = ? AND strftime('%m', s.transaction_date) = ?
        AND s.status NOT IN ('closed','cancelled') AND sl.price_per_box IS NULL
    `)
    .bind(String(year), String(month).padStart(2, '0'))
    .first<{ cnt: number }>();

  // EF-Yem engelleri
  const unpricedYem = await env.DB
    .prepare(`
      SELECT COUNT(*) AS cnt FROM raw_material_purchases
      WHERE strftime('%Y', transaction_date) = ? AND strftime('%m', transaction_date) = ?
        AND status = 'missing_price'
    `)
    .bind(String(year), String(month).padStart(2, '0'))
    .first<{ cnt: number }>();

  const parts: string[] = [];
  if (unpricedStok && unpricedStok.cnt > 0) parts.push(`Stok: ${unpricedStok.cnt} fiyatsız satış`);
  if (unpricedYem  && unpricedYem.cnt  > 0) parts.push(`Yem: ${unpricedYem.cnt} fiyatsız alım`);
  if (!parts.length) return;

  const payload = {
    title: 'Ay Kapanış Engeli',
    body: parts.join(' | '),
    url: '/closing/monthly',
  };

  await notifyByRoleAndModule(['manager'],  'ef_stok', 'monthly_closing_blocker', payload, env, date);
  await notifyByRoleAndModule(['director'], 'ef_stok', 'monthly_closing_blocker', payload, env, date);
}

async function sendManureDaySummary(date: string, env: Env): Promise<void> {
  const rows = await env.DB
    .prepare(`
      SELECT c.name AS coop_name, SUM(me.vehicle_count) AS vehicles
      FROM manure_entries me JOIN coops c ON c.id = me.coop_id
      WHERE me.entry_date = ? AND me.is_deleted = 0
      GROUP BY me.coop_id
    `)
    .bind(date)
    .all<{ coop_name: string; vehicles: number }>();

  if (!rows.results.length) return;

  const summary = rows.results.map(r => `${r.coop_name}: ${r.vehicles} araç`).join(', ');

  await notifyByRoleAndModule(['manager'], 'ef_gubre', 'manure_day_end_summary', {
    title: 'Gübre Gün Sonu Özeti',
    body: summary,
    url: '/gubre/dashboard',
  }, env, date);
}
