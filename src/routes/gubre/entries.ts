// ============================================================
// EF-Gübre — Gübre girişleri
// ============================================================

import { Env, err, ok, AuthContext } from '../../types';

export async function listEntries(request: Request, env: Env): Promise<Response> {
  const url   = new URL(request.url);
  const year  = url.searchParams.get('year');
  const month = url.searchParams.get('month');
  const coopId = url.searchParams.get('coop_id');

  let query = `
    SELECT me.id, me.coop_id, c.name AS coop_name, me.entry_date,
           me.vehicle_count, me.note, me.is_deleted,
           u.display_name AS created_by_name, me.created_at
    FROM manure_entries me
    JOIN coops c ON c.id = me.coop_id
    JOIN users u ON u.id = me.created_by
    WHERE 1=1
  `;
  const params: (string | number)[] = [];

  if (year && month) {
    query += ` AND strftime('%Y', me.entry_date) = ? AND strftime('%m', me.entry_date) = ?`;
    params.push(year.padStart(4, '0'), month.padStart(2, '0'));
  }
  if (coopId) {
    query += ` AND me.coop_id = ?`;
    params.push(parseInt(coopId));
  }

  query += ` ORDER BY me.entry_date DESC, me.created_at DESC`;

  const rows = await env.DB.prepare(query).bind(...params).all();
  return ok(rows.results);
}

export async function createEntry(request: Request, env: Env, auth: AuthContext): Promise<Response> {
  const body = await request.json() as {
    coop_id?: number;
    entry_date?: string;
    vehicle_count?: number;
    note?: string;
  };

  const { coop_id, entry_date, vehicle_count, note } = body;
  if (!coop_id || !entry_date || !vehicle_count) {
    return err('coop_id, entry_date, vehicle_count zorunludur', 422);
  }
  if (!Number.isInteger(vehicle_count) || vehicle_count <= 0) {
    return err('vehicle_count pozitif tam sayı olmalıdır', 422);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry_date)) {
    return err('Geçersiz tarih formatı', 422);
  }

  // Kümes varlık kontrolü
  const coop = await env.DB.prepare('SELECT id, is_active FROM coops WHERE id = ?').bind(coop_id).first<{ id: number; is_active: number }>();
  if (!coop) return err('Kümes bulunamadı', 404);
  if (!coop.is_active) return err('Kümes pasif', 422);

  // Dönem açık mı?
  const [y, m] = entry_date.split('-').map(Number);
  const closing = await env.DB
    .prepare(`SELECT status FROM monthly_closings_gubre WHERE year = ? AND month = ?`)
    .bind(y, m)
    .first<{ status: string }>();
  if (closing?.status === 'closed') return err('Bu ay kapatılmış, giriş yapılamaz', 422);

  const result = await env.DB.prepare(`
    INSERT INTO manure_entries (coop_id, entry_date, vehicle_count, note, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).bind(coop_id, entry_date, vehicle_count, note ?? null, auth.user.id).run();

  return ok({ id: (result.meta as { last_row_id: number }).last_row_id, message: 'Gübre girişi kaydedildi' }, 201);
}

export async function deleteEntry(id: number, request: Request, env: Env, auth: AuthContext): Promise<Response> {
  const body = await request.json() as { reason?: string };
  if (!body.reason?.trim()) return err('Silme nedeni zorunludur', 422);

  const entry = await env.DB.prepare(`
    SELECT me.id, me.entry_date, me.is_deleted
    FROM manure_entries me
    WHERE me.id = ?
  `).bind(id).first<{ id: number; entry_date: string; is_deleted: number }>();

  if (!entry) return err('Kayıt bulunamadı', 404);
  if (entry.is_deleted) return err('Kayıt zaten silinmiş', 422);

  // Dönem açık mı?
  const [y, m] = entry.entry_date.split('-').map(Number);
  const closing = await env.DB
    .prepare(`SELECT status FROM monthly_closings_gubre WHERE year = ? AND month = ?`)
    .bind(y, m)
    .first<{ status: string }>();
  if (closing?.status === 'closed') return err('Bu ay kapatılmış, silme yapılamaz', 422);

  await env.DB.batch([
    env.DB.prepare(`UPDATE manure_entries SET is_deleted = 1 WHERE id = ?`).bind(id),
    env.DB.prepare(`
      INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_data, new_data, note)
      VALUES (?, 'manure_delete', 'manure_entries', ?, '{"is_deleted":0}', '{"is_deleted":1}', ?)
    `).bind(auth.user.id, id, body.reason.trim()),
  ]);

  return ok({ message: 'Gübre girişi silindi' });
}
