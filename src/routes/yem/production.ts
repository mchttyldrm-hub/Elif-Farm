// ============================================================
// EF-Yem — Yem üretimi
// POST /api/yem/productions               — üretim kaydet (snapshot ile)
// GET  /api/yem/productions               — liste
// POST /api/yem/productions/:id/reverse   — iptal et
// ============================================================
// Kural 2: Üretim anındaki reçete versiyonu ve hammadde birim fiyatları
// snapshot_data JSON olarak üretim kaydına yazılır.

import { Env, ok, err } from '../../types';
import { AuthContext } from '../../types';
import { writeRawMaterialLedger } from '../../lib/ledger';
import { assertCoopActive, assertRawMaterialSufficient, parseBody, assertPeriodOpen } from '../../middleware/validate';
import { getYearMonth, today } from '../../lib/week';

interface SnapshotLine {
  raw_material_id: number;
  name: string;
  kg_per_ton: number;
  unit_price_iqd: number;  // üretim anındaki son bilinen fiyat
}

interface SnapshotData {
  v: 1;
  recipe_version: number;
  lines: SnapshotLine[];
}

// Hammadde için en son bilinen birim fiyatı bul
async function getLatestUnitPrice(rawMaterialId: number, env: Env): Promise<number | null> {
  const row = await env.DB.prepare(`
    SELECT unit_price_iqd FROM raw_material_purchases
    WHERE raw_material_id = ? AND status = 'complete' AND is_cancelled = 0
    ORDER BY transaction_date DESC, id DESC
    LIMIT 1
  `).bind(rawMaterialId).first<{ unit_price_iqd: number }>();
  return row?.unit_price_iqd ?? null;
}

// POST /api/yem/productions
export async function createFeedProduction(
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  const body = await parseBody<{
    coop_id: number;
    production_date: string;
    quantity_kg: number;
    note?: string;
  }>(request, ['coop_id', 'production_date', 'quantity_kg']);
  if (body instanceof Response) return body;

  if (body.quantity_kg <= 0) return err('Üretim miktarı 0\'dan büyük olmalıdır', 422);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.production_date)) return err('Geçersiz tarih formatı', 422);

  const coopErr = await assertCoopActive(body.coop_id, env);
  if (coopErr) return coopErr;

  const { year, month } = getYearMonth(body.production_date);
  const periodErr = await assertPeriodOpen('monthly_closings_yem', year, month, env);
  if (periodErr) return periodErr;

  // Bu kümesin aktif reçetesini bul
  const recipe = await env.DB.prepare(`
    SELECT fr.id, fr.version, fr.name
    FROM feed_recipes fr
    WHERE fr.coop_id = ? AND fr.is_active = 1
    LIMIT 1
  `).bind(body.coop_id).first<{ id: number; version: number; name: string }>();

  if (!recipe) return err('Bu kümes için aktif reçete bulunamadı', 422);

  // Reçete satırlarını al
  const lines = await env.DB.prepare(`
    SELECT frl.raw_material_id, frl.kg_per_ton, rm.name
    FROM feed_recipe_lines frl JOIN raw_materials rm ON rm.id = frl.raw_material_id
    WHERE frl.recipe_id = ?
  `).bind(recipe.id).all<{ raw_material_id: number; kg_per_ton: number; name: string }>();

  if (!lines.results.length) return err('Reçetede hammadde satırı yok', 422);

  // Her hammadde için: stok yeterliliği + fiyat kontrolü
  const snapshotLines: SnapshotLine[] = [];
  let totalCost = 0;

  for (const line of lines.results) {
    const usedKg = (line.kg_per_ton / 1000) * body.quantity_kg;

    // Stok yeterli mi?
    const stockErr = await assertRawMaterialSufficient(line.raw_material_id, usedKg, env);
    if (stockErr) return stockErr;

    // Birim fiyat — üretim anındaki snapshot için gerekli
    const unitPrice = await getLatestUnitPrice(line.raw_material_id, env);
    if (unitPrice === null) {
      return err(
        `${line.name} için fiyat geçmişi bulunamadı. Önce en az bir alım kaydı girin.`,
        422
      );
    }

    totalCost += usedKg * unitPrice;
    snapshotLines.push({
      raw_material_id: line.raw_material_id,
      name: line.name,
      kg_per_ton: line.kg_per_ton,
      unit_price_iqd: unitPrice,
    });
  }

  const costPerTon = (totalCost / body.quantity_kg) * 1000;

  const snapshotData: SnapshotData = {
    v: 1,
    recipe_version: recipe.version,
    lines: snapshotLines,
  };

  // Üretim kaydı
  const result = await env.DB.prepare(`
    INSERT INTO feed_productions
      (coop_id, recipe_id, production_date, quantity_kg, total_cost_iqd, cost_per_ton_iqd,
       snapshot_recipe_version, snapshot_data, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    body.coop_id, recipe.id, body.production_date, body.quantity_kg,
    Math.round(totalCost), Math.round(costPerTon),
    recipe.version, JSON.stringify(snapshotData), auth.user.id
  ).run();

  const productionId = result.meta.last_row_id;

  // Her hammadde için raw_material_ledger (stok düşer: −usedKg)
  for (const line of snapshotLines) {
    const usedKg = (line.kg_per_ton / 1000) * body.quantity_kg;
    await writeRawMaterialLedger({
      rawMaterialId: line.raw_material_id,
      movementType: 'production_use',
      referenceId: productionId,
      quantityKg: -usedKg,
      createdBy: auth.user.id,
    }, env);
  }

  return ok({
    id: productionId,
    total_cost_iqd: Math.round(totalCost),
    cost_per_ton_iqd: Math.round(costPerTon),
    message: 'Yem üretimi kaydedildi',
  }, 201);
}

// GET /api/yem/productions
export async function listFeedProductions(
  request: Request,
  env: Env
): Promise<Response> {
  const url    = new URL(request.url);
  const from   = url.searchParams.get('date_from') ?? new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const to     = url.searchParams.get('date_to')   ?? today();
  const coopId = url.searchParams.get('coop_id');

  let q = `
    SELECT fp.id, fp.coop_id, fp.production_date, fp.quantity_kg,
           fp.total_cost_iqd, fp.cost_per_ton_iqd, fp.snapshot_recipe_version, fp.is_reversed,
           c.name AS coop_name, fr.name AS recipe_name
    FROM feed_productions fp
    JOIN coops c ON c.id = fp.coop_id
    JOIN feed_recipes fr ON fr.id = fp.recipe_id
    WHERE fp.production_date BETWEEN ? AND ?
  `;
  const params: (string | number)[] = [from, to];
  if (coopId) { q += ' AND fp.coop_id = ?'; params.push(parseInt(coopId)); }
  q += ' ORDER BY fp.production_date DESC, fp.id DESC';

  const rows = await env.DB.prepare(q).bind(...params).all();
  return ok(rows.results);
}

// POST /api/yem/productions/:id/reverse
export async function reverseFeedProduction(
  productionId: number,
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  const body = await parseBody<{ reason: string }>(request, ['reason']);
  if (body instanceof Response) return body;

  const prod = await env.DB.prepare(`
    SELECT id, coop_id, production_date, quantity_kg, snapshot_data, is_reversed
    FROM feed_productions WHERE id = ?
  `).bind(productionId).first<{
    id: number; coop_id: number; production_date: string;
    quantity_kg: number; snapshot_data: string; is_reversed: number;
  }>();

  if (!prod)          return err('Üretim kaydı bulunamadı', 404);
  if (prod.is_reversed) return err('Bu üretim zaten iptal edilmiş', 422);

  const { year, month } = getYearMonth(prod.production_date);
  const periodErr = await assertPeriodOpen('monthly_closings_yem', year, month, env);
  if (periodErr) return periodErr;

  // Snapshot'tan kullanılan hammaddeleri geri ver
  const snapshot: SnapshotData = JSON.parse(prod.snapshot_data);
  for (const line of snapshot.lines) {
    const usedKg = (line.kg_per_ton / 1000) * prod.quantity_kg;
    await writeRawMaterialLedger({
      rawMaterialId: line.raw_material_id,
      movementType: 'production_reversal',
      referenceId: productionId,
      quantityKg: usedKg,   // pozitif → stok geri döner
      createdBy: auth.user.id,
    }, env);
  }

  await env.DB.prepare('UPDATE feed_productions SET is_reversed = 1 WHERE id = ?').bind(productionId).run();

  await env.DB.prepare(`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_data, note)
    VALUES (?, 'feed_production_reversal', 'feed_productions', ?, ?, ?)
  `).bind(auth.user.id, productionId, JSON.stringify({ quantity_kg: prod.quantity_kg }), body.reason).run();

  return ok({ message: 'Yem üretimi iptal edildi, hammaddeler iade edildi' });
}
