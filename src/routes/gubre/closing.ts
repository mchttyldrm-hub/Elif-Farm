// ============================================================
// EF-Gübre — Aylık kapanış
// ============================================================

import { Env, err, ok, AuthContext } from '../../types';

export async function getMonthlyClosingStatus(request: Request, env: Env, _auth: AuthContext): Promise<Response> {
  const url   = new URL(request.url);
  const dateParam = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  const [y, m] = dateParam.split('-').map(Number);

  const closing = await env.DB
    .prepare(`SELECT * FROM monthly_closings_gubre WHERE year = ? AND month = ?`)
    .bind(y, m)
    .first<{ id: number; year: number; month: number; status: string; export_generated_at: string | null; closed_at: string | null }>();

  // Bu ay için giriş istatistikleri
  const stats = await env.DB.prepare(`
    SELECT
      COUNT(*) AS total_entries,
      COALESCE(SUM(vehicle_count), 0) AS total_vehicles,
      COUNT(DISTINCT coop_id) AS active_coops
    FROM manure_entries
    WHERE strftime('%Y', entry_date) = ? AND strftime('%m', entry_date) = ?
    AND is_deleted = 0
  `).bind(String(y).padStart(4,'0'), String(m).padStart(2,'0')).first<{ total_entries: number; total_vehicles: number; active_coops: number }>();

  return ok({
    year: y,
    month: m,
    status: closing?.status ?? 'open',
    closed_at: closing?.closed_at ?? null,
    export_generated_at: closing?.export_generated_at ?? null,
    total_entries: stats?.total_entries ?? 0,
    total_vehicles: stats?.total_vehicles ?? 0,
    active_coops: stats?.active_coops ?? 0,
  });
}

export async function closeMonth(request: Request, env: Env, auth: AuthContext): Promise<Response> {
  const url   = new URL(request.url);
  const dateParam = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  const [y, m] = dateParam.split('-').map(Number);

  const existing = await env.DB
    .prepare(`SELECT status FROM monthly_closings_gubre WHERE year = ? AND month = ?`)
    .bind(y, m)
    .first<{ status: string }>();

  if (existing?.status === 'closed') return err('Bu ay zaten kapatılmış', 422);

  await env.DB.prepare(`
    INSERT INTO monthly_closings_gubre (year, month, status, closed_by, closed_at)
    VALUES (?, ?, 'closed', ?, datetime('now'))
    ON CONFLICT(year, month) DO UPDATE SET
      status = 'closed',
      closed_by = excluded.closed_by,
      closed_at = excluded.closed_at
  `).bind(y, m, auth.user.id).run();

  return ok({ message: `${y}/${m} ayı kapatıldı` });
}

export async function getMonthlyReport(request: Request, env: Env, _auth: AuthContext): Promise<Response> {
  const url = new URL(request.url);
  const year  = parseInt(url.searchParams.get('year')  ?? String(new Date().getFullYear()));
  const month = parseInt(url.searchParams.get('month') ?? String(new Date().getMonth() + 1));

  const yStr = String(year).padStart(4, '0');
  const mStr = String(month).padStart(2, '0');

  // Kümes bazlı özet
  const byCoop = await env.DB.prepare(`
    SELECT c.id AS coop_id, c.name AS coop_name,
           COUNT(*) AS entry_count,
           COALESCE(SUM(me.vehicle_count), 0) AS total_vehicles
    FROM manure_entries me
    JOIN coops c ON c.id = me.coop_id
    WHERE strftime('%Y', me.entry_date) = ?
      AND strftime('%m', me.entry_date) = ?
      AND me.is_deleted = 0
    GROUP BY c.id, c.name
    ORDER BY c.name
  `).bind(yStr, mStr).all();

  // Gün bazlı özet
  const byDay = await env.DB.prepare(`
    SELECT me.entry_date,
           COUNT(*) AS entry_count,
           COALESCE(SUM(me.vehicle_count), 0) AS total_vehicles
    FROM manure_entries me
    WHERE strftime('%Y', me.entry_date) = ?
      AND strftime('%m', me.entry_date) = ?
      AND me.is_deleted = 0
    GROUP BY me.entry_date
    ORDER BY me.entry_date
  `).bind(yStr, mStr).all();

  // Toplamlar
  const totals = await env.DB.prepare(`
    SELECT COUNT(*) AS total_entries,
           COALESCE(SUM(vehicle_count), 0) AS total_vehicles
    FROM manure_entries
    WHERE strftime('%Y', entry_date) = ?
      AND strftime('%m', entry_date) = ?
      AND is_deleted = 0
  `).bind(yStr, mStr).first<{ total_entries: number; total_vehicles: number }>();

  const closing = await env.DB
    .prepare(`SELECT status, closed_at FROM monthly_closings_gubre WHERE year = ? AND month = ?`)
    .bind(year, month)
    .first<{ status: string; closed_at: string | null }>();

  return ok({
    year,
    month,
    closing_status: closing?.status ?? 'open',
    closed_at: closing?.closed_at ?? null,
    total_entries: totals?.total_entries ?? 0,
    total_vehicles: totals?.total_vehicles ?? 0,
    by_coop: byCoop.results,
    by_day: byDay.results,
  });
}
