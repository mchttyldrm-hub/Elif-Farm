// ============================================================
// Web Push gönderici
// RFC 8291 (aes128gcm şifreleme) + VAPID (ES256) — SubtleCrypto
// Kural 9: Push izni olmayan kullanıcılar → in-app fallback
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

// ── Yardımcı: base64url encode / decode ─────────────────────

function b64url(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64urlStr(str: string): string {
  return b64url(new TextEncoder().encode(str));
}

function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

// ── HKDF-SHA256 (extract + expand, tek blok) ────────────────

async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  // Extract: PRK = HMAC-SHA256(salt, ikm)
  const saltKey = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prkBuf  = await crypto.subtle.sign('HMAC', saltKey, ikm);

  // Expand T(1) = HMAC-SHA256(PRK, info || 0x01)
  const prkKey  = await crypto.subtle.importKey('raw', new Uint8Array(prkBuf), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const t1Buf   = await crypto.subtle.sign('HMAC', prkKey, concat(info, new Uint8Array([1])));

  return new Uint8Array(t1Buf).slice(0, len);
}

// ── VAPID JWT (ES256) ────────────────────────────────────────

async function createVapidJwt(endpoint: string, env: Env): Promise<string> {
  const origin  = new URL(endpoint).origin;
  const now     = Math.floor(Date.now() / 1000);
  const header  = b64urlStr(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64urlStr(JSON.stringify({ aud: origin, exp: now + 43200, sub: env.VAPID_SUBJECT }));
  const unsigned = `${header}.${payload}`;

  // VAPID_PUBLIC_KEY = 65-byte uncompressed P-256 point, base64url
  const pubBytes = b64urlDecode(env.VAPID_PUBLIC_KEY);
  const x = b64url(pubBytes.slice(1, 33));
  const y = b64url(pubBytes.slice(33, 65));

  const privKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x, y, d: env.VAPID_PRIVATE_KEY, ext: true } as JsonWebKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privKey,
    new TextEncoder().encode(unsigned)
  );

  return `${unsigned}.${b64url(new Uint8Array(sig))}`;
}

// ── RFC 8291 + RFC 8188 (aes128gcm) mesaj şifreleme ─────────

async function encryptPush(
  plaintext: string,
  p256dh: string,
  authSecret: string
): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(p256dh);    // 65 bytes uncompressed
  const auth     = b64urlDecode(authSecret); // 16 bytes

  // Ephemeral ECDH key pair
  const eph = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const ephPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey)); // 65 bytes

  // ECDH shared secret
  const uaCryptoKey = await crypto.subtle.importKey(
    'raw', uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false, []
  );
  const ecdhBits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaCryptoKey }, eph.privateKey, 256)
  );

  // IKM via RFC 8291 §3.3:  HKDF(salt=auth, ikm=ecdhSecret, info="WebPush: info\0"+ua_pub+as_pub)
  const authInfo = concat(new TextEncoder().encode('WebPush: info\0'), uaPublic, ephPubRaw);
  const ikm      = await hkdf(ecdhBits, auth, authInfo, 32);

  // 16-byte random salt
  const salt     = crypto.getRandomValues(new Uint8Array(16));

  // CEK (16 bytes) and nonce (12 bytes) via RFC 8188
  const cek   = await hkdf(ikm, salt, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, salt, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);

  // Encrypt  plaintext + 0x02 delimiter (single-record, no padding)
  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const padded = concat(new TextEncoder().encode(plaintext), new Uint8Array([2]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, padded)
  );

  // RFC 8188 §2.1 body: salt(16) | rs(4,BE) | idlen(1) | keyid(65) | ciphertext
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);

  return concat(salt, rs, new Uint8Array([65]), ephPubRaw, ciphertext);
}

// ── Push gönderme (tek subscription) ────────────────────────

async function sendPushRequest(
  sub: { endpoint: string; p256dh: string; auth_key: string },
  payload: PushPayload,
  env: Env
): Promise<boolean> {
  try {
    const jwt  = await createVapidJwt(sub.endpoint, env);
    const body = await encryptPush(
      JSON.stringify({ title: payload.title, body: payload.body, url: payload.url ?? '/' }),
      sub.p256dh,
      sub.auth_key
    );

    const resp = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type':     'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'Authorization':    `vapid t=${jwt},k=${env.VAPID_PUBLIC_KEY}`,
        'TTL':              '86400',
      },
      body,
    });

    // 410 Gone veya 404 = eski subscription, temizle
    if (resp.status === 410 || resp.status === 404) {
      await env.DB
        .prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
        .bind(sub.endpoint).run();
    }

    return resp.ok || resp.status === 201;
  } catch {
    return false;
  }
}

// ── Kullanıcıya push gönder (tüm cihazlar) ──────────────────

async function sendPushToUser(userId: number, payload: PushPayload, env: Env): Promise<boolean> {
  const subs = await env.DB
    .prepare('SELECT endpoint, p256dh, auth_key FROM push_subscriptions WHERE user_id = ?')
    .bind(userId)
    .all<{ endpoint: string; p256dh: string; auth_key: string }>();

  if (!subs.results.length) return false;

  let anySuccess = false;
  for (const sub of subs.results) {
    if (await sendPushRequest(sub, payload, env)) anySuccess = true;
  }
  return anySuccess;
}

// ── In-app bildirim yaz ──────────────────────────────────────

export async function writeInApp(
  userId: number,
  type: NotificationType,
  payload: PushPayload,
  env: Env
): Promise<void> {
  await env.DB
    .prepare('INSERT INTO in_app_notifications (user_id, notification_type, title, body) VALUES (?, ?, ?, ?)')
    .bind(userId, type, payload.title, payload.body)
    .run();
}

// ── Ana gönderici: spam kontrolü + kanal tercihi ─────────────

export async function sendNotification(
  userId: number,
  type: NotificationType,
  payload: PushPayload,
  env: Env,
  triggerDate?: string
): Promise<void> {
  const date = triggerDate ?? new Date().toISOString().slice(0, 10);

  // Günlük spam kontrolü
  const already = await env.DB
    .prepare('SELECT id FROM notification_log WHERE notification_type = ? AND trigger_date = ? AND target_user_id = ?')
    .bind(type, date, userId)
    .first();
  if (already) return;

  const pref    = await env.DB
    .prepare('SELECT channel FROM notification_preferences WHERE user_id = ? AND notification_type = ?')
    .bind(userId, type)
    .first<{ channel: string }>();
  const channel = pref?.channel ?? 'push';
  if (channel === 'disabled') return;

  let sent = false;
  if (channel === 'push') {
    sent = await sendPushToUser(userId, payload, env);
    if (!sent) { await writeInApp(userId, type, payload, env); sent = true; }
  } else {
    await writeInApp(userId, type, payload, env);
    sent = true;
  }

  if (sent) {
    try {
      await env.DB
        .prepare(`INSERT INTO notification_log (notification_type, trigger_date, target_user_id, channel, status) VALUES (?, ?, ?, ?, 'sent')`)
        .bind(type, date, userId, channel)
        .run();
    } catch { /* UNIQUE çakışması — yoksay */ }
  }
}

// ── Role + modül bazlı toplu bildirim ────────────────────────

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
      WHERE u.role IN (${placeholders}) AND ump.module = ? AND u.is_active = 1
    `)
    .bind(...roles, module)
    .all<{ id: number }>();

  for (const user of users.results) {
    await sendNotification(user.id, type, payload, env, triggerDate);
  }
}
