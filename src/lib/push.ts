// ============================================================
// Web Push gönderici
// Kural 9: Push izni olmayan kullanıcılar susturulmaz — in-app fallback
// Spam önleme: notification_log üzerinden günde 1 kez kontrolü
// ============================================================

import { Env } from '../types';

export type NotificationType =
  | 'day_end_production_summary'
  | 'missing_price_sale'
  | 'weekly_closing_blocker'
  | 'critical_stock_warning'
  | 'missing_price_purchase'
  | 'monthly_closing_blocker'
  | 'manure_day_end_summary'
  | 'monthly_table_ready_gubre'
  | 'silo_consumption_calculated';

interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

// Tek kullanıcıya bildirim gönder — kanal tercihine ve spam kontrolüne göre
export async function sendNotification(
  userId: number,
  type: NotificationType,
  payload: PushPayload,
  env: Env,
  triggerDate?: string
): Promise<void> {
  const date = triggerDate ?? new Date().toISOString().slice(0, 10);

  // Spam kontrolü: bugün aynı type+user için gönderilmiş mi?
  const already = await env.DB
    .prepare('SELECT id FROM notification_log WHERE notification_type = ? AND trigger_date = ? AND target_user_id = ?')
    .bind(type, date, userId)
    .first();
  if (already) return;

  // Kullanıcının kanal tercihini oku (yoksa varsayılan: push)
  const pref = await env.DB
    .prepare('SELECT channel FROM notification_preferences WHERE user_id = ? AND notification_type = ?')
    .bind(userId, type)
    .first<{ channel: string }>();
  const channel = pref?.channel ?? 'push';

  if (channel === 'disabled') return;

  let sent = false;

  if (channel === 'push') {
    sent = await sendPushToUser(userId, payload, env);
    // Push başarısızsa in-app fallback
    if (!sent) {
      await writeInApp(userId, type, payload, env);
      sent = true;
    }
  } else {
    // in_app
    await writeInApp(userId, type, payload, env);
    sent = true;
  }

  if (sent) {
    // Log yaz (UNIQUE constraint — race condition durumunda sessizce geç)
    try {
      await env.DB
        .prepare(`
          INSERT INTO notification_log (notification_type, trigger_date, target_user_id, channel, status)
          VALUES (?, ?, ?, ?, 'sent')
        `)
        .bind(type, date, userId, channel)
        .run();
    } catch {
      // Zaten kayıtlı — ignore
    }
  }
}

// Bir kullanıcının kayıtlı push subscription'larına gönder
async function sendPushToUser(userId: number, payload: PushPayload, env: Env): Promise<boolean> {
  const subs = await env.DB
    .prepare('SELECT endpoint, p256dh, auth_key FROM push_subscriptions WHERE user_id = ?')
    .bind(userId)
    .all<{ endpoint: string; p256dh: string; auth_key: string }>();

  if (!subs.results.length) return false;

  let anySuccess = false;
  for (const sub of subs.results) {
    try {
      // Web Push protokolü — VAPID imzası gerektirir
      // Cloudflare Workers'ta web-push kütüphanesi olmadığından
      // manuel VAPID + AES-GCM implementasyonu gerekir.
      // Bu placeholder'ı Aşama 6'da tamamlayın (push.ts genişletme).
      const body = JSON.stringify({ title: payload.title, body: payload.body, url: payload.url ?? '/' });
      const resp = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'TTL': '86400',
          // Authorization: VAPID imzası buraya eklenecek (Aşama 6)
        },
        body,
      });
      if (resp.ok || resp.status === 201) anySuccess = true;
    } catch {
      // Endpoint erişilemez — sessizce devam
    }
  }
  return anySuccess;
}

// In-app bildirim yaz
async function writeInApp(
  userId: number,
  type: NotificationType,
  payload: PushPayload,
  env: Env
): Promise<void> {
  await env.DB
    .prepare(`
      INSERT INTO in_app_notifications (user_id, notification_type, title, body)
      VALUES (?, ?, ?, ?)
    `)
    .bind(userId, type, payload.title, payload.body)
    .run();
}

// Belirli role sahip + modül izni olan tüm kullanıcılara bildirim gönder
export async function notifyByRoleAndModule(
  roles: string[],
  module: string,
  type: NotificationType,
  payload: PushPayload,
  env: Env,
  triggerDate?: string
): Promise<void> {
  const placeholders = roles.map(() => '?').join(',');
  const users = await env.DB
    .prepare(`
      SELECT DISTINCT u.id FROM users u
      JOIN user_module_permissions ump ON ump.user_id = u.id
      WHERE u.role IN (${placeholders})
        AND ump.module = ?
        AND u.is_active = 1
    `)
    .bind(...roles, module)
    .all<{ id: number }>();

  for (const user of users.results) {
    await sendNotification(user.id, type, payload, env, triggerDate);
  }
}
