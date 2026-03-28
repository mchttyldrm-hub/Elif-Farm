// ============================================================
// Kapanış engel listesi üreticisi
// Kural 6: Kullanıcı listeyi görmeden kapanış tamamlanamaz.
// Her kapanış türü için somut engel listesi döndürür.
// ============================================================

import { Env } from '../types';

export interface ClosingBlocker {
  type: string;
  message: string;
  count?: number;
  items?: unknown[];
}

// EF-Stok haftalık kapanış engelleri
export async function getWeeklyClosingBlockers(
  weekStart: string,
  weekEnd: string,
  env: Env
): Promise<ClosingBlocker[]> {
  const blockers: ClosingBlocker[] = [];

  // Fiyatlanmamış satış satırları — bu haftaya ait
  const unpricedLines = await env.DB
    .prepare(`
      SELECT sl.id, sl.category, sl.box_count, s.sale_no, s.transaction_date
      FROM sale_lines sl
      JOIN sales s ON s.id = sl.sale_id
      WHERE s.transaction_date BETWEEN ? AND ?
        AND s.status NOT IN ('closed','cancelled')
        AND sl.price_per_box IS NULL
    `)
    .bind(weekStart, weekEnd)
    .all();

  if (unpricedLines.results.length > 0) {
    blockers.push({
      type: 'unpriced_sale_lines',
      message: `${unpricedLines.results.length} satış satırının fiyatı girilmemiş`,
      count: unpricedLines.results.length,
      items: unpricedLines.results,
    });
  }

  return blockers;
}

// EF-Stok aylık kapanış engelleri
export async function getMonthlyClosingBlockersStok(
  year: number,
  month: number,
  env: Env
): Promise<ClosingBlocker[]> {
  const blockers: ClosingBlocker[] = [];

  // Bu aya ait kapatılmamış haftalar
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEnd   = new Date(year, month, 0).toISOString().slice(0, 10);

  const openWeeks = await env.DB
    .prepare(`
      SELECT week_start, week_end FROM weekly_closings
      WHERE week_start <= ? AND week_end >= ? AND status = 'open'
    `)
    .bind(monthEnd, monthStart)
    .all();

  if (openWeeks.results.length > 0) {
    blockers.push({
      type: 'open_weekly_closings',
      message: `${openWeeks.results.length} haftalık kapanış tamamlanmamış`,
      count: openWeeks.results.length,
      items: openWeeks.results,
    });
  }

  // Hâlâ fiyatlanmamış satış satırları (bu ay)
  const unpricedLines = await env.DB
    .prepare(`
      SELECT COUNT(*) AS cnt FROM sale_lines sl
      JOIN sales s ON s.id = sl.sale_id
      WHERE s.transaction_date BETWEEN ? AND ?
        AND s.status NOT IN ('closed','cancelled')
        AND sl.price_per_box IS NULL
    `)
    .bind(monthStart, monthEnd)
    .first<{ cnt: number }>();

  if (unpricedLines && unpricedLines.cnt > 0) {
    blockers.push({
      type: 'unpriced_sale_lines',
      message: `${unpricedLines.cnt} satış satırının fiyatı girilmemiş`,
      count: unpricedLines.cnt,
    });
  }

  return blockers;
}

// EF-Yem aylık kapanış engelleri
export async function getMonthlyClosingBlockersYem(
  year: number,
  month: number,
  env: Env
): Promise<ClosingBlocker[]> {
  const blockers: ClosingBlocker[] = [];
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEnd   = new Date(year, month, 0).toISOString().slice(0, 10);

  // Eksik fiyatlı alımlar
  const missingPrice = await env.DB
    .prepare(`
      SELECT rmp.id, rm.name, rmp.transaction_date, rmp.quantity_kg
      FROM raw_material_purchases rmp
      JOIN raw_materials rm ON rm.id = rmp.raw_material_id
      WHERE rmp.transaction_date BETWEEN ? AND ?
        AND rmp.status = 'missing_price'
    `)
    .bind(monthStart, monthEnd)
    .all();

  if (missingPrice.results.length > 0) {
    blockers.push({
      type: 'missing_price_purchases',
      message: `${missingPrice.results.length} hammadde alımının fiyatı girilmemiş`,
      count: missingPrice.results.length,
      items: missingPrice.results,
    });
  }

  return blockers;
}
