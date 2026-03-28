// ============================================================
// EF-Yem — Silo kapanışları ve tüketim hesabı
// GET  /api/yem/silo             — bir kümes için son kapanış listesi
// POST /api/yem/silo             — kapanış gir/güncelle (employee/manager)
// GET  /api/yem/silo/consumption — tüketim hesapla (Kural 7)
// ============================================================
// Tüketim formülü: dünkü_kapanış + bugün_üretilen − bugün_kapanış = tüketim
// Kural 7: kapanış girilmemişse tüketim hesaplanmaz, tahmin yapılmaz.

import { Env, ok, err } from '../../types';
import { AuthContext } from '../../types';
import { parseBody, assertCoopActive, assertPeriodOpen } from '../../middleware/validate';
import { getYearMonth, today } from '../../lib/week';
import { notifyByRoleAndModule } from '../../lib/push';

// GET /api/yem/silo?coop_id=&limit=
export async function listSiloClosings(
  request: Request,
  env: Env
): Promise<Response> {
  const url    = new URL(request.url);
  const coopId = url.searchParams.get('coop_id');
  const limit  = Math.min(parseInt(url.searchParams.get('limit') ?? '30'), 90);

  let q = `
    SELECT sc.id, sc.coop_id, sc.closing_date, sc.closing_kg, sc.note,
           c.name AS coop_name
    FROM silo_closings sc JOIN coops c ON c.id = sc.coop_id
  `;
  const params: (string | number)[] = [];
  if (coopId) { q += ' WHERE sc.coop_id = ?'; params.push(parseInt(coopId)); }
  q += ` ORDER BY sc.closing_date DESC, sc.id DESC LIMIT ${limit}`;

  const rows = await env.DB.prepare(q).bind(...params).all();
  return ok(rows.results);
}

// POST /api/yem/silo — create or update (UNIQUE(coop_id, closing_date))
export async function upsertSiloClosing(
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  const body = await parseBody<{
    coop_id: number;
    closing_date: string;
    closing_kg: number;
    note?: string;
  }>(request, ['coop_id', 'closing_date', 'closing_kg']);
  if (body instanceof Response) return body;

  if (body.closing_kg < 0) return err('Kapanış stoku negatif olamaz', 422);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.closing_date)) return err('Geçersiz tarih formatı', 422);

  const coopErr = await assertCoopActive(body.coop_id, env);
  if (coopErr) return coopErr;

  const { year, month } = getYearMonth(body.closing_date);
  const periodErr = await assertPeriodOpen('monthly_closings_yem', year, month, env);
  if (periodErr) return periodErr;

  // Mevcut kaydı oku (audit log için)
  const existing = await env.DB.prepare(
    'SELECT closing_kg FROM silo_closings WHERE coop_id = ? AND closing_date = ?'
  ).bind(body.coop_id, body.closing_date).first<{ closing_kg: number }>();

  await env.DB.prepare(`
    INSERT INTO silo_closings (coop_id, closing_date, closing_kg, note, created_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(coop_id, closing_date) DO UPDATE SET
      closing_kg = excluded.closing_kg,
      note       = excluded.note
  `).bind(body.coop_id, body.closing_date, body.closing_kg, body.note ?? null, auth.user.id).run();

  if (existing) {
    await env.DB.prepare(`
      INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_data, new_data)
      VALUES (?, 'silo_closing_update', 'silo_closings', ?, ?, ?)
    `).bind(
      auth.user.id, body.coop_id,
      JSON.stringify({ coop_id: body.coop_id, date: body.closing_date, closing_kg: existing.closing_kg }),
      JSON.stringify({ closing_kg: body.closing_kg })
    ).run();
  }

  // Tüketim hesapla ve bildirim gönder (Kural E)
  const consumption = await calcConsumption(body.coop_id, body.closing_date, env);

  if (consumption !== null) {
    // Manager'lara push bildirim — günde 1 kez (push.ts spam kontrolü yapar)
    const coopName = await env.DB
      .prepare('SELECT name FROM coops WHERE id = ?')
      .bind(body.coop_id).first<{ name: string }>();

    await notifyByRoleAndModule(['manager'], 'ef_yem', 'silo_consumption_calculated', {
      title: 'Silo Tüketimi Hesaplandı',
      body: `${coopName?.name ?? 'Kümes'}: ${consumption.toFixed(0)} kg tüketim`,
      url: '/yem/silo',
    }, env, body.closing_date);
  }

  return ok({
    message: 'Silo kapanışı kaydedildi',
    consumption_kg: consumption,   // null → dün kapanış yok, tahmin yapılmıyor (Kural 7)
  });
}

// GET /api/yem/silo/consumption?coop_id=&date=
export async function getSiloConsumption(
  request: Request,
  env: Env
): Promise<Response> {
  const url    = new URL(request.url);
  const coopId = parseInt(url.searchParams.get('coop_id') ?? '0');
  const date   = url.searchParams.get('date') ?? today();

  if (!coopId) return err('coop_id zorunludur', 422);

  const consumption = await calcConsumption(coopId, date, env);

  // Detayları da döndür
  const prev = await env.DB.prepare(
    'SELECT closing_kg FROM silo_closings WHERE coop_id = ? AND closing_date = ?'
  ).bind(coopId, prevDay(date)).first<{ closing_kg: number }>();

  const produced = await env.DB.prepare(`
    SELECT COALESCE(SUM(quantity_kg), 0) AS total
    FROM feed_productions
    WHERE coop_id = ? AND production_date = ? AND is_reversed = 0
  `).bind(coopId, date).first<{ total: number }>();

  const todayClose = await env.DB.prepare(
    'SELECT closing_kg FROM silo_closings WHERE coop_id = ? AND closing_date = ?'
  ).bind(coopId, date).first<{ closing_kg: number }>();

  return ok({
    date,
    coop_id: coopId,
    prev_closing_kg:   prev?.closing_kg    ?? null,   // null → eksik, tüketim hesaplanamaz
    today_produced_kg: produced?.total     ?? 0,
    today_closing_kg:  todayClose?.closing_kg ?? null,
    consumption_kg:    consumption,                    // null → Kural 7
  });
}

// Tüketim formülü: dünkü_kapanış + bugün_üretilen − bugün_kapanış
// Kural 7: Herhangi bir değer eksikse null döner, tahmin yapılmaz.
export async function calcConsumption(
  coopId: number,
  date: string,
  env: Env
): Promise<number | null> {
  const prev = await env.DB.prepare(
    'SELECT closing_kg FROM silo_closings WHERE coop_id = ? AND closing_date = ?'
  ).bind(coopId, prevDay(date)).first<{ closing_kg: number }>();

  if (!prev) return null;  // Dünkü kapanış yok → hesaplama yapılmaz

  const produced = await env.DB.prepare(`
    SELECT COALESCE(SUM(quantity_kg), 0) AS total
    FROM feed_productions
    WHERE coop_id = ? AND production_date = ? AND is_reversed = 0
  `).bind(coopId, date).first<{ total: number }>();

  const todayClose = await env.DB.prepare(
    'SELECT closing_kg FROM silo_closings WHERE coop_id = ? AND closing_date = ?'
  ).bind(coopId, date).first<{ closing_kg: number }>();

  if (!todayClose) return null;  // Bugün kapanış girilmemiş → Kural 7

  return prev.closing_kg + (produced?.total ?? 0) - todayClose.closing_kg;
}

function prevDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
