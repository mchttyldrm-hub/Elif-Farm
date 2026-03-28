// ============================================================
// EF-Yem — Hammadde kartları
// GET  /api/yem/materials       — liste (stok bilgisiyle)
// POST /api/yem/materials       — yeni kart (manager)
// PUT  /api/yem/materials/:id   — güncelle (manager)
// ============================================================

import { Env, ok, err } from '../../types';
import { AuthContext } from '../../types';
import { parseBody } from '../../middleware/validate';

// GET /api/yem/materials
export async function listMaterials(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(`
    SELECT rm.id, rm.name, rm.min_stock_kg, rm.is_active, rm.note,
           COALESCE(rms.total_kg, 0) AS current_stock_kg,
           CASE WHEN COALESCE(rms.total_kg, 0) <= rm.min_stock_kg
                THEN 1 ELSE 0 END   AS is_critical
    FROM raw_materials rm
    LEFT JOIN raw_material_summary rms ON rms.raw_material_id = rm.id
    ORDER BY rm.name
  `).all();
  return ok(rows.results);
}

// POST /api/yem/materials
export async function createMaterial(
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  const body = await parseBody<{
    name: string; min_stock_kg: number; note?: string;
  }>(request, ['name']);
  if (body instanceof Response) return body;

  if (!body.name.trim()) return err('Hammadde adı zorunludur', 422);

  // Aynı isimde aktif hammadde var mı?
  const exists = await env.DB
    .prepare('SELECT id FROM raw_materials WHERE name = ?')
    .bind(body.name.trim()).first();
  if (exists) return err('Bu isimde bir hammadde zaten var', 422);

  const result = await env.DB.prepare(`
    INSERT INTO raw_materials (name, min_stock_kg, note)
    VALUES (?, ?, ?)
  `).bind(body.name.trim(), body.min_stock_kg ?? 0, body.note ?? null).run();

  const matId = result.meta.last_row_id;

  // Özet kaydı oluştur
  await env.DB.prepare(
    'INSERT OR IGNORE INTO raw_material_summary (raw_material_id, total_kg) VALUES (?, 0)'
  ).bind(matId).run();

  await env.DB.prepare(`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, new_data)
    VALUES (?, 'material_create', 'raw_materials', ?, ?)
  `).bind(auth.user.id, matId, JSON.stringify({ name: body.name, min_stock_kg: body.min_stock_kg })).run();

  return ok({ id: matId, message: 'Hammadde oluşturuldu' }, 201);
}

// PUT /api/yem/materials/:id
export async function updateMaterial(
  matId: number,
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  const body = await parseBody<{
    name?: string; min_stock_kg?: number; is_active?: number; note?: string;
  }>(request, []);
  if (body instanceof Response) return body;

  const mat = await env.DB
    .prepare('SELECT id, name, min_stock_kg, is_active, note FROM raw_materials WHERE id = ?')
    .bind(matId)
    .first<{ id: number; name: string; min_stock_kg: number; is_active: number; note: string | null }>();
  if (!mat) return err('Hammadde bulunamadı', 404);

  const newName       = body.name        ?? mat.name;
  const newMinStock   = body.min_stock_kg ?? mat.min_stock_kg;
  const newIsActive   = body.is_active   ?? mat.is_active;
  const newNote       = body.note        ?? mat.note;

  await env.DB.prepare(`
    UPDATE raw_materials SET name=?, min_stock_kg=?, is_active=?, note=? WHERE id=?
  `).bind(newName, newMinStock, newIsActive, newNote, matId).run();

  await env.DB.prepare(`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_data, new_data)
    VALUES (?, 'material_update', 'raw_materials', ?, ?, ?)
  `).bind(auth.user.id, matId, JSON.stringify(mat), JSON.stringify(body)).run();

  return ok({ message: 'Hammadde güncellendi' });
}
