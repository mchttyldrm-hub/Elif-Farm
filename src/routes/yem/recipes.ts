// ============================================================
// EF-Yem — Reçete yönetimi
// GET  /api/yem/recipes               — liste (coop bazlı)
// GET  /api/yem/recipes/:id           — detay + satırlar
// POST /api/yem/recipes               — yeni reçete (manager)
// POST /api/yem/recipes/:id/activate  — aktive et (önceki pasife düşer)
// ============================================================

import { Env, ok, err } from '../../types';
import { AuthContext } from '../../types';
import { parseBody } from '../../middleware/validate';

// GET /api/yem/recipes
export async function listRecipes(
  request: Request,
  env: Env
): Promise<Response> {
  const url    = new URL(request.url);
  const coopId = url.searchParams.get('coop_id');

  let q = `
    SELECT fr.id, fr.coop_id, fr.name, fr.version, fr.valid_from, fr.is_active,
           c.name AS coop_name
    FROM feed_recipes fr JOIN coops c ON c.id = fr.coop_id
  `;
  const params: (string | number)[] = [];
  if (coopId) { q += ' WHERE fr.coop_id = ?'; params.push(parseInt(coopId)); }
  q += ' ORDER BY fr.coop_id, fr.version DESC';

  const rows = await env.DB.prepare(q).bind(...params).all();
  return ok(rows.results);
}

// GET /api/yem/recipes/:id
export async function getRecipe(recipeId: number, env: Env): Promise<Response> {
  const recipe = await env.DB.prepare(`
    SELECT fr.id, fr.coop_id, fr.name, fr.version, fr.valid_from, fr.is_active,
           c.name AS coop_name
    FROM feed_recipes fr JOIN coops c ON c.id = fr.coop_id
    WHERE fr.id = ?
  `).bind(recipeId).first();
  if (!recipe) return err('Reçete bulunamadı', 404);

  const lines = await env.DB.prepare(`
    SELECT frl.id, frl.raw_material_id, frl.kg_per_ton, rm.name AS material_name
    FROM feed_recipe_lines frl JOIN raw_materials rm ON rm.id = frl.raw_material_id
    WHERE frl.recipe_id = ?
    ORDER BY rm.name
  `).bind(recipeId).all();

  return ok({ ...recipe, lines: lines.results });
}

// POST /api/yem/recipes
export async function createRecipe(
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  const body = await parseBody<{
    coop_id: number;
    name: string;
    valid_from: string;
    lines: Array<{ raw_material_id: number; kg_per_ton: number }>;
  }>(request, ['coop_id', 'name', 'valid_from', 'lines']);
  if (body instanceof Response) return body;

  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return err('En az bir reçete satırı gereklidir', 422);
  }

  // Toplam kg_per_ton kontrolü (1 ton = 1000 kg, esneklik için ±%5 tolerans)
  const totalKgPerTon = body.lines.reduce((s, l) => s + (l.kg_per_ton ?? 0), 0);
  if (totalKgPerTon <= 0) return err('Reçete satırlarının toplam kg/ton değeri 0\'dan büyük olmalı', 422);

  // Bu kümes için mevcut en yüksek versiyon numarası
  const maxVer = await env.DB
    .prepare('SELECT COALESCE(MAX(version), 0) AS max_v FROM feed_recipes WHERE coop_id = ?')
    .bind(body.coop_id).first<{ max_v: number }>();
  const nextVersion = (maxVer?.max_v ?? 0) + 1;

  const result = await env.DB.prepare(`
    INSERT INTO feed_recipes (coop_id, name, version, valid_from, is_active, created_by)
    VALUES (?, ?, ?, ?, 0, ?)
  `).bind(body.coop_id, body.name, nextVersion, body.valid_from, auth.user.id).run();

  const recipeId = result.meta.last_row_id;

  // Reçete satırları
  const lineStmts = body.lines.map(l =>
    env.DB.prepare('INSERT INTO feed_recipe_lines (recipe_id, raw_material_id, kg_per_ton) VALUES (?, ?, ?)')
      .bind(recipeId, l.raw_material_id, l.kg_per_ton)
  );
  await env.DB.batch(lineStmts);

  await env.DB.prepare(`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, new_data)
    VALUES (?, 'recipe_create', 'feed_recipes', ?, ?)
  `).bind(auth.user.id, recipeId, JSON.stringify({ coop_id: body.coop_id, name: body.name, version: nextVersion })).run();

  return ok({ id: recipeId, version: nextVersion, message: 'Reçete oluşturuldu' }, 201);
}

// POST /api/yem/recipes/:id/activate
// Aynı coop_id için önceki aktif reçete otomatik pasife alınır (tek transaction)
export async function activateRecipe(
  recipeId: number,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  const recipe = await env.DB
    .prepare('SELECT id, coop_id, version, is_active FROM feed_recipes WHERE id = ?')
    .bind(recipeId).first<{ id: number; coop_id: number; version: number; is_active: number }>();
  if (!recipe) return err('Reçete bulunamadı', 404);
  if (recipe.is_active) return err('Bu reçete zaten aktif', 422);

  // Önceki aktifi pasife al + yeniyi aktive et (tek batch)
  await env.DB.batch([
    env.DB.prepare('UPDATE feed_recipes SET is_active = 0 WHERE coop_id = ? AND is_active = 1')
      .bind(recipe.coop_id),
    env.DB.prepare('UPDATE feed_recipes SET is_active = 1 WHERE id = ?')
      .bind(recipeId),
  ]);

  await env.DB.prepare(`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, new_data)
    VALUES (?, 'recipe_activate', 'feed_recipes', ?, ?)
  `).bind(auth.user.id, recipeId, JSON.stringify({ coop_id: recipe.coop_id, version: recipe.version })).run();

  return ok({ message: `Reçete v${recipe.version} aktive edildi` });
}
