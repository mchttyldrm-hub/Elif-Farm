// ============================================================
// EF-Stok — Üretim girişi ve iptali
// POST /api/stok/productions
// GET  /api/stok/productions
// POST /api/stok/productions/:id/reverse
// ============================================================

import { Env, Category, ok, err } from '../../types';
import { AuthContext } from '../../types';
import { writeLedgerEntry } from '../../lib/ledger';
import { assertCoopActive, validateKg, assertStockSufficient, parseBody, assertPeriodOpen } from '../../middleware/validate';
import { getYearMonth } from '../../lib/week';

interface ProductionBody {
  coop_id: number;
  production_date: string;
  category: Category;
  kg?: number | null;
  box_count: number;
  note?: string;
}

// POST /api/stok/productions
export async function createProduction(
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  const body = await parseBody<ProductionBody>(request, ['coop_id', 'production_date', 'category', 'box_count']);
  if (body instanceof Response) return body;

  const { coop_id, production_date, category, box_count, note } = body;
  const kg = body.kg ?? null;

  // Tarih formatı kontrolü
  if (!/^\d{4}-\d{2}-\d{2}$/.test(production_date)) return err('Geçersiz tarih formatı', 422);

  // Kategori kontrolü
  const validCategories: Category[] = ['normal', 'kirli', 'kirik', 'kucuk'];
  if (!validCategories.includes(category)) return err('Geçersiz kategori', 422);

  // Kümes aktif mi?
  const coopErr = await assertCoopActive(coop_id, env);
  if (coopErr) return coopErr;

  // Kg aralık kontrolü (normal/kirli için zorunlu, kirik/kucuk için yasak)
  const kgErr = validateKg(category, kg);
  if (kgErr) return kgErr;

  // Box sayısı pozitif olmalı
  if (!box_count || box_count <= 0) return err('Kutu adedi 0\'dan büyük olmalıdır', 422);

  // Dönem açık mı?
  const { year, month } = getYearMonth(production_date);
  const periodErr = await assertPeriodOpen('monthly_closings_stok', year, month, env);
  if (periodErr) return periodErr;

  // Üretim kaydı + ledger (stok artar: +box_count)
  const production = await env.DB.prepare(`
    INSERT INTO productions (coop_id, production_date, category, kg, box_count, note, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(coop_id, production_date, category, kg, box_count, note ?? null, auth.user.id).run();

  const productionId = production.meta.last_row_id;

  await writeLedgerEntry({
    coopId: coop_id,
    category,
    movementType: 'production',
    referenceId: productionId,
    kg,
    boxCount: box_count,      // pozitif → stok artar
    note: note ?? undefined,
    createdBy: auth.user.id,
  }, env);

  return ok({ id: productionId, message: 'Üretim kaydedildi' }, 201);
}

// POST /api/stok/productions/:id/reverse — üretim iptali
export async function reverseProduction(
  productionId: number,
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  const body = await parseBody<{ reason: string }>(request, ['reason']);
  if (body instanceof Response) return body;

  const prod = await env.DB.prepare(`
    SELECT id, coop_id, production_date, category, kg, box_count, is_reversed
    FROM productions WHERE id = ?
  `).bind(productionId).first<{
    id: number; coop_id: number; production_date: string;
    category: Category; kg: number | null; box_count: number; is_reversed: number;
  }>();

  if (!prod)          return err('Üretim kaydı bulunamadı', 404);
  if (prod.is_reversed) return err('Bu üretim zaten iptal edilmiş', 422);

  // İptal edince stok düşer — düşebilir mi?
  const stockErr = await assertStockSufficient(prod.coop_id, prod.category, prod.box_count, env);
  if (stockErr) return stockErr;

  // Dönem açık mı?
  const { year, month } = getYearMonth(prod.production_date);
  const periodErr = await assertPeriodOpen('monthly_closings_stok', year, month, env);
  if (periodErr) return periodErr;

  // Üretimi iptal edildi işaretle
  await env.DB.prepare('UPDATE productions SET is_reversed = 1 WHERE id = ?').bind(productionId).run();

  // Compensating ledger hareketi (−box_count)
  await writeLedgerEntry({
    coopId: prod.coop_id,
    category: prod.category,
    movementType: 'production_reversal',
    referenceId: productionId,
    kg: prod.kg !== null ? -prod.kg : null,
    boxCount: -prod.box_count,   // negatif → stok düşer
    note: body.reason,
    createdBy: auth.user.id,
  }, env);

  // Audit log
  await env.DB.prepare(`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_data, note)
    VALUES (?, 'production_reversal', 'productions', ?, ?, ?)
  `).bind(auth.user.id, productionId, JSON.stringify(prod), body.reason).run();

  return ok({ message: 'Üretim iptali kaydedildi' });
}

// GET /api/stok/productions
export async function listProductions(
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  const url    = new URL(request.url);
  const date   = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  const coopId = url.searchParams.get('coop_id');

  let query = `
    SELECT p.id, p.production_date, p.category, p.kg, p.box_count, p.is_reversed, p.note,
           c.name AS coop_name
    FROM productions p JOIN coops c ON c.id = p.coop_id
    WHERE p.production_date = ?
  `;
  const params: (string | number)[] = [date];

  if (coopId) {
    query += ' AND p.coop_id = ?';
    params.push(parseInt(coopId));
  }

  // Employee sadece aktif kümesleri görür
  if (auth.user.role === 'employee') {
    query += ' AND c.is_active = 1';
  }

  query += ' ORDER BY p.created_at DESC';

  const rows = await env.DB.prepare(query).bind(...params).all();
  return ok(rows.results);
}
