// ============================================================
// EF-Yem — Hammadde alımları (manager only)
// GET  /api/yem/purchases               — liste
// POST /api/yem/purchases               — yeni alım
// PUT  /api/yem/purchases/:id/price     — fiyat güncelle
// POST /api/yem/purchases/:id/cancel    — iptal et
// ============================================================

import { Env, ok, err } from '../../types';
import { AuthContext } from '../../types';
import { writeRawMaterialLedger } from '../../lib/ledger';
import { assertPeriodOpen, parseBody } from '../../middleware/validate';
import { getYearMonth, today } from '../../lib/week';

// GET /api/yem/purchases
export async function listPurchases(
  request: Request,
  env: Env
): Promise<Response> {
  const url    = new URL(request.url);
  const status = url.searchParams.get('status');           // 'missing_price' filtresi
  const from   = url.searchParams.get('date_from') ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const to     = url.searchParams.get('date_to')   ?? today();

  let q = `
    SELECT rmp.id, rmp.transaction_date, rmp.quantity_kg, rmp.unit_price_iqd,
           rmp.total_price_iqd, rmp.status, rmp.is_cancelled, rmp.note, rmp.force_incomplete,
           rm.name AS material_name, rm.id AS raw_material_id
    FROM raw_material_purchases rmp
    JOIN raw_materials rm ON rm.id = rmp.raw_material_id
    WHERE rmp.transaction_date BETWEEN ? AND ? AND rmp.is_cancelled = 0
  `;
  const params: (string | number)[] = [from, to];

  if (status) { q += ' AND rmp.status = ?'; params.push(status); }
  q += ' ORDER BY rmp.transaction_date DESC, rmp.id DESC';

  const rows = await env.DB.prepare(q).bind(...params).all();
  return ok(rows.results);
}

// POST /api/yem/purchases
export async function createPurchase(
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  const body = await parseBody<{
    raw_material_id: number;
    transaction_date: string;
    quantity_kg: number;
    unit_price_iqd?: number | null;
    force_incomplete?: boolean;
    note?: string;
  }>(request, ['raw_material_id', 'transaction_date', 'quantity_kg']);
  if (body instanceof Response) return body;

  if (body.quantity_kg <= 0) return err('Miktar 0\'dan büyük olmalıdır', 422);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.transaction_date)) return err('Geçersiz tarih formatı', 422);

  // Hammadde aktif mi?
  const mat = await env.DB
    .prepare('SELECT id, is_active FROM raw_materials WHERE id = ?')
    .bind(body.raw_material_id).first<{ id: number; is_active: number }>();
  if (!mat)          return err('Hammadde bulunamadı', 404);
  if (!mat.is_active) return err('Pasif hammaddeye alım yapılamaz', 422);

  // Dönem açık mı?
  const { year, month } = getYearMonth(body.transaction_date);
  const periodErr = await assertPeriodOpen('monthly_closings_yem', year, month, env);
  if (periodErr) return periodErr;

  // Fiyat kontrolü: zorunlu, force_incomplete ile geçici olarak atlanabilir (sadece manager)
  const hasPrice    = body.unit_price_iqd !== null && body.unit_price_iqd !== undefined && body.unit_price_iqd > 0;
  const isForced    = !!body.force_incomplete;

  if (!hasPrice && !isForced) {
    return err('Birim fiyat zorunludur. İstisnai durum için force_incomplete: true gönderin.', 422);
  }

  const status     = hasPrice ? 'complete' : 'missing_price';
  const unitPrice  = hasPrice ? body.unit_price_iqd! : null;
  const totalPrice = hasPrice ? unitPrice! * body.quantity_kg : null;

  const result = await env.DB.prepare(`
    INSERT INTO raw_material_purchases
      (raw_material_id, transaction_date, quantity_kg, unit_price_iqd, total_price_iqd,
       status, force_incomplete, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    body.raw_material_id, body.transaction_date, body.quantity_kg,
    unitPrice, totalPrice, status, isForced ? 1 : 0,
    body.note ?? null, auth.user.id
  ).run();

  const purchaseId = result.meta.last_row_id;

  // Raw material ledger (stok artar)
  await writeRawMaterialLedger({
    rawMaterialId: body.raw_material_id,
    movementType: 'purchase',
    referenceId: purchaseId,
    quantityKg: body.quantity_kg,
    createdBy: auth.user.id,
  }, env);

  return ok({ id: purchaseId, status, message: 'Alım kaydedildi' }, 201);
}

// PUT /api/yem/purchases/:id/price — fiyat gir / güncelle
export async function updatePurchasePrice(
  purchaseId: number,
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  const body = await parseBody<{ unit_price_iqd: number }>(request, ['unit_price_iqd']);
  if (body instanceof Response) return body;

  if (body.unit_price_iqd <= 0) return err('Fiyat 0\'dan büyük olmalıdır', 422);

  const purchase = await env.DB.prepare(`
    SELECT id, quantity_kg, unit_price_iqd, status, is_cancelled, transaction_date
    FROM raw_material_purchases WHERE id = ?
  `).bind(purchaseId).first<{
    id: number; quantity_kg: number; unit_price_iqd: number | null;
    status: string; is_cancelled: number; transaction_date: string;
  }>();

  if (!purchase)            return err('Alım kaydı bulunamadı', 404);
  if (purchase.is_cancelled) return err('İptal edilmiş alıma fiyat girilemez', 422);

  const { year, month } = getYearMonth(purchase.transaction_date);
  const periodErr = await assertPeriodOpen('monthly_closings_yem', year, month, env);
  if (periodErr) return periodErr;

  const totalPrice = body.unit_price_iqd * purchase.quantity_kg;

  await env.DB.prepare(`
    UPDATE raw_material_purchases
    SET unit_price_iqd = ?, total_price_iqd = ?, status = 'complete',
        price_entered_by = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(body.unit_price_iqd, totalPrice, auth.user.id, purchaseId).run();

  await env.DB.prepare(`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_data, new_data)
    VALUES (?, 'purchase_price_update', 'raw_material_purchases', ?, ?, ?)
  `).bind(
    auth.user.id, purchaseId,
    JSON.stringify({ unit_price_iqd: purchase.unit_price_iqd, status: purchase.status }),
    JSON.stringify({ unit_price_iqd: body.unit_price_iqd, status: 'complete' })
  ).run();

  return ok({ message: 'Fiyat güncellendi' });
}

// POST /api/yem/purchases/:id/cancel — alım iptali
export async function cancelPurchase(
  purchaseId: number,
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  const body = await parseBody<{ reason: string }>(request, ['reason']);
  if (body instanceof Response) return body;

  const purchase = await env.DB.prepare(`
    SELECT id, raw_material_id, quantity_kg, status, is_cancelled, transaction_date
    FROM raw_material_purchases WHERE id = ?
  `).bind(purchaseId).first<{
    id: number; raw_material_id: number; quantity_kg: number;
    status: string; is_cancelled: number; transaction_date: string;
  }>();

  if (!purchase)             return err('Alım kaydı bulunamadı', 404);
  if (purchase.is_cancelled) return err('Bu alım zaten iptal edilmiş', 422);

  // İptal edince stok düşer — düşebilir mi?
  const stock = await env.DB
    .prepare('SELECT total_kg FROM raw_material_summary WHERE raw_material_id = ?')
    .bind(purchase.raw_material_id).first<{ total_kg: number }>();
  const current = stock?.total_kg ?? 0;
  if (current < purchase.quantity_kg) {
    return err(
      `İptal sonrası stok negatife düşer: mevcut ${current} kg, alım ${purchase.quantity_kg} kg`,
      422
    );
  }

  const { year, month } = getYearMonth(purchase.transaction_date);
  const periodErr = await assertPeriodOpen('monthly_closings_yem', year, month, env);
  if (periodErr) return periodErr;

  await env.DB.prepare(
    'UPDATE raw_material_purchases SET is_cancelled = 1, status = \'cancelled\', updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(purchaseId).run();

  // Compensating ledger (stok düşer: -quantity_kg)
  await writeRawMaterialLedger({
    rawMaterialId: purchase.raw_material_id,
    movementType: 'purchase_cancel',
    referenceId: purchaseId,
    quantityKg: -purchase.quantity_kg,
    createdBy: auth.user.id,
  }, env);

  await env.DB.prepare(`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_data, note)
    VALUES (?, 'purchase_cancel', 'raw_material_purchases', ?, ?, ?)
  `).bind(auth.user.id, purchaseId, JSON.stringify(purchase), body.reason).run();

  return ok({ message: 'Alım iptal edildi, stok iade edildi' });
}
