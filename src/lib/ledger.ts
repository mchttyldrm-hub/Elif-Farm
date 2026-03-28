// ============================================================
// Ledger yardımcı fonksiyonları — EF-Stok
// Kural 1: Tüm stok değişimleri buradan geçer.
// stock_summary ledger ile aynı D1 transaction içinde güncellenir.
// ============================================================

import { Env, Category, StockMovementType } from '../types';

interface LedgerEntry {
  coopId: number;
  category: Category;
  movementType: StockMovementType;
  referenceId?: number;
  kg: number | null;
  boxCount: number;
  note?: string;
  createdBy: number;
}

// Ledger'a hareket yaz ve summary'yi aynı transaction içinde güncelle
// box_count: pozitif = stok artar, negatif = stok düşer
export async function writeLedgerEntry(entry: LedgerEntry, env: Env): Promise<number> {
  // Summary delta: box_count'un işareti yönde belirler
  const boxDelta = entry.boxCount;
  const kgDelta  = entry.kg ?? 0;

  const result = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO stock_ledger
        (coop_id, category, movement_type, reference_id, kg, box_count, note, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      entry.coopId,
      entry.category,
      entry.movementType,
      entry.referenceId ?? null,
      entry.kg,
      entry.boxCount,
      entry.note ?? null,
      entry.createdBy
    ),
    env.DB.prepare(`
      INSERT INTO stock_summary (coop_id, category, total_kg, total_box, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(coop_id, category) DO UPDATE SET
        total_kg   = total_kg   + excluded.total_kg,
        total_box  = total_box  + excluded.total_box,
        updated_at = excluded.updated_at
    `).bind(entry.coopId, entry.category, kgDelta, boxDelta),
  ]);

  // D1 batch: ilk sorgunun meta'sından last_row_id al
  const meta = (result[0] as D1Result).meta;
  return meta.last_row_id ?? 0;
}

// Tüm ledger'ı tarayarak summary'yi sıfırdan yeniden hesapla (admin endpoint'i için)
export async function rebuildStockSummary(env: Env): Promise<void> {
  // Mevcut summary'yi sıfırla
  await env.DB.prepare('UPDATE stock_summary SET total_kg = 0, total_box = 0').run();

  // Ledger toplamlarını yeniden hesapla
  const rows = await env.DB
    .prepare(`
      SELECT coop_id, category,
             COALESCE(SUM(kg), 0)        AS total_kg,
             COALESCE(SUM(box_count), 0) AS total_box
      FROM stock_ledger
      GROUP BY coop_id, category
    `)
    .all<{ coop_id: number; category: Category; total_kg: number; total_box: number }>();

  if (!rows.results.length) return;

  // Her (coop, category) çifti için upsert
  const stmts = rows.results.map(r =>
    env.DB.prepare(`
      INSERT INTO stock_summary (coop_id, category, total_kg, total_box, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(coop_id, category) DO UPDATE SET
        total_kg   = excluded.total_kg,
        total_box  = excluded.total_box,
        updated_at = excluded.updated_at
    `).bind(r.coop_id, r.category, r.total_kg, r.total_box)
  );

  await env.DB.batch(stmts);
}

// ============================================================
// Hammadde ledger yardımcısı — EF-Yem
// ============================================================

import { RawMaterialMovementType } from '../types';

interface RawMaterialLedgerEntry {
  rawMaterialId: number;
  movementType: RawMaterialMovementType;
  referenceId?: number;
  quantityKg: number;  // (+) giriş, (−) çıkış
  createdBy: number;
}

export async function writeRawMaterialLedger(
  entry: RawMaterialLedgerEntry,
  env: Env
): Promise<number> {
  const result = await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO raw_material_ledger
        (raw_material_id, movement_type, reference_id, quantity_kg, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).bind(
      entry.rawMaterialId,
      entry.movementType,
      entry.referenceId ?? null,
      entry.quantityKg,
      entry.createdBy
    ),
    env.DB.prepare(`
      INSERT INTO raw_material_summary (raw_material_id, total_kg, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(raw_material_id) DO UPDATE SET
        total_kg   = total_kg + excluded.total_kg,
        updated_at = excluded.updated_at
    `).bind(entry.rawMaterialId, entry.quantityKg),
  ]);

  const meta = (result[0] as D1Result).meta;
  return meta.last_row_id ?? 0;
}

// Hammadde summary rebuild
export async function rebuildRawMaterialSummary(env: Env): Promise<void> {
  await env.DB.prepare('UPDATE raw_material_summary SET total_kg = 0').run();

  const rows = await env.DB
    .prepare(`
      SELECT raw_material_id, COALESCE(SUM(quantity_kg), 0) AS total_kg
      FROM raw_material_ledger
      GROUP BY raw_material_id
    `)
    .all<{ raw_material_id: number; total_kg: number }>();

  if (!rows.results.length) return;

  const stmts = rows.results.map(r =>
    env.DB.prepare(`
      INSERT INTO raw_material_summary (raw_material_id, total_kg, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(raw_material_id) DO UPDATE SET
        total_kg   = excluded.total_kg,
        updated_at = excluded.updated_at
    `).bind(r.raw_material_id, r.total_kg)
  );

  await env.DB.batch(stmts);
}
