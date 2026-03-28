// ============================================================
// EF-Stok — Manuel stok düzeltmesi (manager/director)
// POST /api/stok/adjustments
// ============================================================

import { Env, Category, ok, err } from '../../types';
import { AuthContext } from '../../types';
import { writeLedgerEntry } from '../../lib/ledger';
import { assertCoopActive, validateKg, getCurrentStock, parseBody, assertPeriodOpen } from '../../middleware/validate';
import { getYearMonth, today } from '../../lib/week';

interface AdjustmentBody {
  coop_id: number;
  category: Category;
  kg_delta?: number | null;
  box_delta: number;   // pozitif artış, negatif azalış
  reason: string;
}

// POST /api/stok/adjustments
export async function createAdjustment(
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  const body = await parseBody<AdjustmentBody>(request, ['coop_id', 'category', 'box_delta', 'reason']);
  if (body instanceof Response) return body;

  const { coop_id, category, box_delta, reason } = body;
  const kg_delta = body.kg_delta ?? null;

  if (box_delta === 0) return err('Düzeltme miktarı 0 olamaz', 422);
  if (!reason.trim()) return err('Neden alanı zorunludur', 422);

  const coopErr = await assertCoopActive(coop_id, env);
  if (coopErr) return coopErr;

  // Kg delta kontrolü: kirik/kucuk için kg olmamalı
  if (['kirik', 'kucuk'].includes(category) && kg_delta !== null && kg_delta !== undefined) {
    return err(`${category} kategorisi için kg düzeltmesi yapılamaz`, 422);
  }

  // Stok negatife düşer mi?
  if (box_delta < 0) {
    const stock = await getCurrentStock(coop_id, category as Category, env);
    if (stock.total_box + box_delta < 0) {
      return err(
        `Düzeltme sonrası stok negatife düşer: mevcut ${stock.total_box} kutu, düzeltme ${box_delta}`,
        422
      );
    }
  }

  // Dönem açık mı? (bugünün tarihine göre)
  const { year, month } = getYearMonth(today());
  const periodErr = await assertPeriodOpen('monthly_closings_stok', year, month, env);
  if (periodErr) return periodErr;

  // Ledger kaydı
  const ledgerId = await writeLedgerEntry({
    coopId: coop_id,
    category: category as Category,
    movementType: 'adjustment',
    kg: kg_delta,
    boxCount: box_delta,
    note: reason,
    createdBy: auth.user.id,
  }, env);

  // Audit log
  await env.DB.prepare(`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, new_data, note)
    VALUES (?, 'stock_adjustment', 'stock_ledger', ?, ?, ?)
  `).bind(
    auth.user.id, ledgerId,
    JSON.stringify({ coop_id, category, kg_delta, box_delta }),
    reason
  ).run();

  return ok({ message: 'Stok düzeltmesi kaydedildi' }, 201);
}

// GET /api/stok/adjustments — düzeltme geçmişi (manager/director)
export async function listAdjustments(
  request: Request,
  env: Env,
  _auth: AuthContext
): Promise<Response> {
  const url    = new URL(request.url);
  const limit  = Math.min(parseInt(url.searchParams.get('limit') ?? '50'), 200);
  const offset = parseInt(url.searchParams.get('offset') ?? '0');

  const rows = await env.DB.prepare(`
    SELECT sl.id, sl.coop_id, sl.category, sl.kg, sl.box_count, sl.note, sl.created_at,
           c.name AS coop_name, u.display_name AS created_by_name
    FROM stock_ledger sl
    JOIN coops c ON c.id = sl.coop_id
    JOIN users u ON u.id = sl.created_by
    WHERE sl.movement_type = 'adjustment'
    ORDER BY sl.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(limit, offset).all();

  return ok(rows.results);
}
