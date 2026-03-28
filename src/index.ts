// ============================================================
// Cloudflare Worker — Ana giriş noktası ve router
// ============================================================

import { Env, err } from './types';
import { handleLogin, handleLogout, handleMe, handleHashPassword } from './routes/auth';
import { rebuildStockSummary, rebuildRawMaterialSummary } from './lib/ledger';
import { requireAuth } from './middleware/auth';
import { ok } from './types';

// CORS headers — geliştirme ortamı için
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Credentials': 'true',
};

export default {
  // ──────────────────────────────────────────────────────────
  // HTTP istekleri
  // ──────────────────────────────────────────────────────────
  async fetch(request: Request, env: Env): Promise<Response> {
    const url  = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // Preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    let response: Response;

    try {
      response = await route(request, env, path, method);
    } catch (e) {
      console.error('Unhandled error:', e);
      response = err('Sunucu hatası', 500);
    }

    // CORS header'larını tüm yanıtlara ekle
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
    return new Response(response.body, { status: response.status, headers });
  },

  // ──────────────────────────────────────────────────────────
  // Cron tetikleyiciler (gün sonu bildirimleri)
  // ──────────────────────────────────────────────────────────
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runDailyTasks(env));
  },
};

// ──────────────────────────────────────────────────────────
// Router
// ──────────────────────────────────────────────────────────
async function route(request: Request, env: Env, path: string, method: string): Promise<Response> {

  // ── Auth ──
  if (path === '/api/auth/login'  && method === 'POST') return handleLogin(request, env);
  if (path === '/api/auth/logout' && method === 'POST') return handleLogout(request, env);
  if (path === '/api/auth/me'     && method === 'GET')  return handleMe(request, env);

  // Sadece geliştirme ortamında — şifre hash üretici
  if (path === '/api/auth/hash-password' && method === 'POST') return handleHashPassword(request, env);

  // ── Admin ──
  if (path === '/api/admin/rebuild-stock-summary' && method === 'POST') {
    const auth = await requireAuth(request, env, undefined, ['director']);
    if (auth instanceof Response) return auth;
    await rebuildStockSummary(env);
    return ok({ message: 'Stok özeti yeniden hesaplandı' });
  }

  if (path === '/api/admin/rebuild-raw-material-summary' && method === 'POST') {
    const auth = await requireAuth(request, env, undefined, ['director']);
    if (auth instanceof Response) return auth;
    await rebuildRawMaterialSummary(env);
    return ok({ message: 'Hammadde özeti yeniden hesaplandı' });
  }

  // ── Kümesler ──
  if (path === '/api/coops' && method === 'GET') {
    const auth = await requireAuth(request, env);
    if (auth instanceof Response) return auth;
    // Employee yalnızca aktif kümesleri görür; manager/director hepsini
    const isEmployee = auth.user.role === 'employee';
    const rows = isEmployee
      ? await env.DB.prepare('SELECT id, name FROM coops WHERE is_active = 1').all()
      : await env.DB.prepare('SELECT id, name, is_active FROM coops').all();
    return ok(rows.results);
  }

  if (path.startsWith('/api/coops/') && method === 'PUT') {
    const auth = await requireAuth(request, env, undefined, ['director']);
    if (auth instanceof Response) return auth;
    const id   = parseInt(path.split('/')[3]);
    const body = await request.json() as { is_active?: number };
    if (body.is_active === undefined) return err('is_active zorunludur', 422);

    const coop = await env.DB.prepare('SELECT id, is_active FROM coops WHERE id = ?').bind(id).first<{ id: number; is_active: number }>();
    if (!coop) return err('Kümes bulunamadı', 404);

    await env.DB.prepare('UPDATE coops SET is_active = ? WHERE id = ?').bind(body.is_active, id).run();

    // Audit log
    await env.DB.prepare(`
      INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_data, new_data)
      VALUES (?, 'coop_status_change', 'coops', ?, ?, ?)
    `).bind(
      auth.user.id, id,
      JSON.stringify({ is_active: coop.is_active }),
      JSON.stringify({ is_active: body.is_active })
    ).run();

    return ok({ message: 'Kümes güncellendi' });
  }

  // ── Push subscription ──
  if (path === '/api/push/subscribe' && method === 'POST') {
    const auth = await requireAuth(request, env);
    if (auth instanceof Response) return auth;
    const sub = await request.json() as { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string };
    if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return err('Geçersiz subscription', 422);

    await env.DB.prepare(`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth_key, user_agent, last_used_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(endpoint) DO UPDATE SET last_used_at = excluded.last_used_at
    `).bind(auth.user.id, sub.endpoint, sub.keys.p256dh, sub.keys.auth, sub.userAgent ?? null).run();

    return ok({ message: 'Push aboneliği kaydedildi' });
  }

  if (path === '/api/push/unsubscribe' && method === 'POST') {
    const auth = await requireAuth(request, env);
    if (auth instanceof Response) return auth;
    const body = await request.json() as { endpoint: string };
    await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
      .bind(body.endpoint, auth.user.id).run();
    return ok({ message: 'Push aboneliği kaldırıldı' });
  }

  // ── In-app bildirimler ──
  if (path === '/api/notifications' && method === 'GET') {
    const auth = await requireAuth(request, env);
    if (auth instanceof Response) return auth;
    const rows = await env.DB
      .prepare('SELECT * FROM in_app_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
      .bind(auth.user.id).all();
    return ok(rows.results);
  }

  if (path.startsWith('/api/notifications/') && method === 'PUT') {
    const auth = await requireAuth(request, env);
    if (auth instanceof Response) return auth;
    const id = parseInt(path.split('/')[3]);
    await env.DB
      .prepare('UPDATE in_app_notifications SET is_read = 1 WHERE id = ? AND user_id = ?')
      .bind(id, auth.user.id).run();
    return ok({ message: 'Okundu' });
  }

  // ── EF-Stok rotaları (Aşama 3'te eklenecek) ──
  if (path.startsWith('/api/stok/')) {
    return err('EF-Stok modülü Aşama 3\'te eklenecek', 501);
  }

  // ── EF-Yem rotaları (Aşama 4'te eklenecek) ──
  if (path.startsWith('/api/yem/')) {
    return err('EF-Yem modülü Aşama 4\'te eklenecek', 501);
  }

  // ── EF-Gübre rotaları (Aşama 5'te eklenecek) ──
  if (path.startsWith('/api/gubre/')) {
    return err('EF-Gübre modülü Aşama 5\'te eklenecek', 501);
  }

  // Frontend — tüm diğer GET istekleri shell HTML'e yönlendirilir (SPA)
  if (method === 'GET' && !path.startsWith('/api/')) {
    return new Response('<!-- Shell eklenecek (Aşama 3) -->', {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  return err('Bulunamadı', 404);
}

// ──────────────────────────────────────────────────────────
// Günlük cron görevleri
// ──────────────────────────────────────────────────────────
async function runDailyTasks(env: Env): Promise<void> {
  // Aşama 6'da detaylanacak — şimdilik stub
  const { runDailyCron } = await import('./cron/daily');
  await runDailyCron(env);
}
