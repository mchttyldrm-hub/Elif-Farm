// ============================================================
// EF-Stok — Haftalık ve aylık kapanış
// GET  /api/stok/closing/weekly
// POST /api/stok/closing/weekly
// GET  /api/stok/closing/monthly
// POST /api/stok/closing/monthly
// ============================================================

import { Env, ok, err } from '../../types';
import { AuthContext } from '../../types';
import { getWeekRange, getYearMonth, today } from '../../lib/week';
import {
  getWeeklyClosingBlockers,
  getMonthlyClosingBlockersStok,
} from '../../lib/closing-guard';

// GET /api/stok/closing/weekly
export async function getWeeklyClosingStatus(
  request: Request,
  env: Env,
  _auth: AuthContext
): Promise<Response> {
  const url   = new URL(request.url);
  const date  = url.searchParams.get('date') ?? today();
  const { week_start, week_end } = getWeekRange(date);

  const record = await env.DB.prepare(
    'SELECT id, status, closed_at FROM weekly_closings WHERE week_start = ?'
  ).bind(week_start).first<{ id: number; status: string; closed_at: string | null }>();

  const blockers = record?.status === 'closed'
    ? []
    : await getWeeklyClosingBlockers(week_start, week_end, env);

  return ok({
    week_start,
    week_end,
    status:   record?.status ?? 'open',
    closed_at: record?.closed_at ?? null,
    blockers,
    can_close: blockers.length === 0 && record?.status !== 'closed',
  });
}

// POST /api/stok/closing/weekly
export async function closeWeek(
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  const url   = new URL(request.url);
  const date  = url.searchParams.get('date') ?? today();
  const { week_start, week_end } = getWeekRange(date);

  // Zaten kapalı mı?
  const existing = await env.DB.prepare(
    'SELECT status FROM weekly_closings WHERE week_start = ?'
  ).bind(week_start).first<{ status: string }>();

  if (existing?.status === 'closed') return err('Bu hafta zaten kapalı', 422);

  // Engel listesi kontrol
  const blockers = await getWeeklyClosingBlockers(week_start, week_end, env);
  if (blockers.length > 0) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Kapanış engellenmiş',
      blockers,
    }), { status: 422, headers: { 'Content-Type': 'application/json' } });
  }

  // Kapat veya oluştur
  await env.DB.prepare(`
    INSERT INTO weekly_closings (week_start, week_end, status, closed_by, closed_at)
    VALUES (?, ?, 'closed', ?, datetime('now'))
    ON CONFLICT(week_start) DO UPDATE SET
      status    = 'closed',
      closed_by = excluded.closed_by,
      closed_at = excluded.closed_at
  `).bind(week_start, week_end, auth.user.id).run();

  return ok({ message: `${week_start} – ${week_end} haftası kapatıldı` });
}

// GET /api/stok/closing/monthly
export async function getMonthlyClosingStatus(
  request: Request,
  env: Env,
  _auth: AuthContext
): Promise<Response> {
  const url = new URL(request.url);
  const t   = url.searchParams.get('date') ?? today();
  const { year, month } = getYearMonth(t);

  const record = await env.DB.prepare(
    'SELECT status, closed_at FROM monthly_closings_stok WHERE year = ? AND month = ?'
  ).bind(year, month).first<{ status: string; closed_at: string | null }>();

  const blockers = record?.status === 'closed'
    ? []
    : await getMonthlyClosingBlockersStok(year, month, env);

  return ok({
    year, month,
    status:    record?.status ?? 'open',
    closed_at: record?.closed_at ?? null,
    blockers,
    can_close: blockers.length === 0 && record?.status !== 'closed',
  });
}

// POST /api/stok/closing/monthly
export async function closeMonth(
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  const url = new URL(request.url);
  const t   = url.searchParams.get('date') ?? today();
  const { year, month } = getYearMonth(t);

  const existing = await env.DB.prepare(
    'SELECT status FROM monthly_closings_stok WHERE year = ? AND month = ?'
  ).bind(year, month).first<{ status: string }>();

  if (existing?.status === 'closed') return err('Bu ay zaten kapalı', 422);

  const blockers = await getMonthlyClosingBlockersStok(year, month, env);
  if (blockers.length > 0) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Aylık kapanış engellenmiş',
      blockers,
    }), { status: 422, headers: { 'Content-Type': 'application/json' } });
  }

  await env.DB.prepare(`
    INSERT INTO monthly_closings_stok (year, month, status, closed_by, closed_at)
    VALUES (?, ?, 'closed', ?, datetime('now'))
    ON CONFLICT(year, month) DO UPDATE SET
      status    = 'closed',
      closed_by = excluded.closed_by,
      closed_at = excluded.closed_at
  `).bind(year, month, auth.user.id).run();

  return ok({ message: `${year}/${month} ayı kapatıldı` });
}
