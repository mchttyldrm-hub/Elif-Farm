// ============================================================
// EF-Yem — Aylık kapanış
// GET  /api/yem/closing/monthly
// POST /api/yem/closing/monthly
// ============================================================

import { Env, ok, err } from '../../types';
import { AuthContext } from '../../types';
import { getYearMonth, today } from '../../lib/week';
import { getMonthlyClosingBlockersYem } from '../../lib/closing-guard';

// GET /api/yem/closing/monthly
export async function getMonthlyClosingStatus(
  request: Request,
  env: Env,
  _auth: AuthContext
): Promise<Response> {
  const url = new URL(request.url);
  const { year, month } = getYearMonth(url.searchParams.get('date') ?? today());

  const record = await env.DB.prepare(
    'SELECT status, closed_at FROM monthly_closings_yem WHERE year = ? AND month = ?'
  ).bind(year, month).first<{ status: string; closed_at: string | null }>();

  const blockers = record?.status === 'closed'
    ? []
    : await getMonthlyClosingBlockersYem(year, month, env);

  return ok({
    year, month,
    status:    record?.status ?? 'open',
    closed_at: record?.closed_at ?? null,
    blockers,
    can_close: blockers.length === 0 && record?.status !== 'closed',
  });
}

// POST /api/yem/closing/monthly
export async function closeMonth(
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  const url = new URL(request.url);
  const { year, month } = getYearMonth(url.searchParams.get('date') ?? today());

  const existing = await env.DB.prepare(
    'SELECT status FROM monthly_closings_yem WHERE year = ? AND month = ?'
  ).bind(year, month).first<{ status: string }>();

  if (existing?.status === 'closed') return err('Bu ay zaten kapalı', 422);

  const blockers = await getMonthlyClosingBlockersYem(year, month, env);
  if (blockers.length > 0) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Aylık kapanış engellenmiş',
      blockers,
    }), { status: 422, headers: { 'Content-Type': 'application/json' } });
  }

  await env.DB.prepare(`
    INSERT INTO monthly_closings_yem (year, month, status, closed_by, closed_at)
    VALUES (?, ?, 'closed', ?, datetime('now'))
    ON CONFLICT(year, month) DO UPDATE SET
      status    = 'closed',
      closed_by = excluded.closed_by,
      closed_at = excluded.closed_at
  `).bind(year, month, auth.user.id).run();

  return ok({ message: `EF-Yem ${year}/${month} ayı kapatıldı` });
}
