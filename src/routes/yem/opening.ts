// ============================================================
// EF-Yem — Açılış stoku (hammadde + silo)
// POST /api/yem/opening-balance  — hammadde açılış stoku gir
// GET  /api/yem/opening-balance  — mevcut açılış hareketlerini listele
// ============================================================
// Kural 3: Açılış stokları ayrı işlem tipi olarak tutulur.
// Silo açılışı için (opening_date − 1 gün) kaydı silo_closings'e yazılır (Kural R-5).

import { Env, ok, err } from '../../types';
import { AuthContext } from '../../types';
import { writeRawMaterialLedger } from '../../lib/ledger';
import { parseBody } from '../../middleware/validate';

interface OpeningEntry {
  raw_material_id: number;
  quantity_kg: number;
  unit_cost_iqd: number;  // birim maliyet zorunlu
}

// POST /api/yem/opening-balance
export async function setOpeningBalance(
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  const body = await parseBody<{
    opening_date: string;
    entries: OpeningEntry[];
    silo_openings?: Array<{ coop_id: number; opening_kg: number }>;
  }>(request, ['opening_date', 'entries']);
  if (body instanceof Response) return body;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.opening_date)) return err('Geçersiz tarih formatı', 422);
  if (!Array.isArray(body.entries) || !body.entries.length) return err('En az bir hammadde gereklidir', 422);

  // Daha önce açılış girilmiş mi?
  const existingOpening = await env.DB.prepare(
    'SELECT id FROM raw_material_ledger WHERE movement_type = \'opening\' LIMIT 1'
  ).first();
  if (existingOpening) return err('Açılış stoku zaten girilmiş. Düzeltme için manuel düzeltme yapın.', 422);

  // Hammadde açılış kayıtları
  for (const entry of body.entries) {
    if (!entry.raw_material_id || entry.quantity_kg <= 0 || entry.unit_cost_iqd <= 0) {
      return err('Her satırda raw_material_id, quantity_kg > 0 ve unit_cost_iqd > 0 zorunludur', 422);
    }

    const mat = await env.DB
      .prepare('SELECT id FROM raw_materials WHERE id = ?')
      .bind(entry.raw_material_id).first();
    if (!mat) return err(`Hammadde #${entry.raw_material_id} bulunamadı`, 404);

    await writeRawMaterialLedger({
      rawMaterialId: entry.raw_material_id,
      movementType: 'opening',
      quantityKg: entry.quantity_kg,
      createdBy: auth.user.id,
    }, env);

    // Açılış alımı olarak da kaydet (birim fiyat için)
    await env.DB.prepare(`
      INSERT INTO raw_material_purchases
        (raw_material_id, transaction_date, quantity_kg, unit_price_iqd, total_price_iqd,
         status, note, created_by)
      VALUES (?, ?, ?, ?, ?, 'complete', 'Açılış stoku', ?)
    `).bind(
      entry.raw_material_id, body.opening_date, entry.quantity_kg,
      entry.unit_cost_iqd, entry.unit_cost_iqd * entry.quantity_kg,
      auth.user.id
    ).run();
  }

  // Silo açılış: (opening_date − 1 gün) tarihiyle silo_closings'e yaz (Kural R-5)
  if (Array.isArray(body.silo_openings)) {
    const prevDate = (() => {
      const d = new Date(`${body.opening_date}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    })();

    for (const silo of body.silo_openings) {
      if (!silo.coop_id || silo.opening_kg < 0) continue;
      await env.DB.prepare(`
        INSERT INTO silo_closings (coop_id, closing_date, closing_kg, note, created_by)
        VALUES (?, ?, ?, 'Açılış stoku', ?)
        ON CONFLICT(coop_id, closing_date) DO UPDATE SET closing_kg = excluded.closing_kg
      `).bind(silo.coop_id, prevDate, silo.opening_kg, auth.user.id).run();
    }
  }

  await env.DB.prepare(`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, new_data)
    VALUES (?, 'yem_opening_balance', 'raw_material_ledger', NULL, ?)
  `).bind(auth.user.id, JSON.stringify({ opening_date: body.opening_date, entry_count: body.entries.length })).run();

  return ok({ message: 'Açılış stoku kaydedildi' }, 201);
}

// GET /api/yem/opening-balance
export async function getOpeningBalance(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(`
    SELECT rml.id, rml.raw_material_id, rml.quantity_kg, rml.created_at,
           rm.name AS material_name
    FROM raw_material_ledger rml
    JOIN raw_materials rm ON rm.id = rml.raw_material_id
    WHERE rml.movement_type = 'opening'
    ORDER BY rm.name
  `).all();
  return ok(rows.results);
}
