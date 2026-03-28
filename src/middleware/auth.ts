// ============================================================
// Auth middleware — JWT doğrulama + modül yetki kontrolü
// ============================================================
// JWT, HttpOnly cookie olarak taşınır.
// Her korumalı route handler bu middleware'den geçer.

import { Env, AuthContext, Role, Module, err } from '../types';

// Web Crypto ile HS256 JWT işlemleri (Cloudflare Workers native)
async function getKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signJwt(payload: object, secret: string): Promise<string> {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const body   = btoa(JSON.stringify(payload)).replace(/=/g, '');
  const key    = await getKey(secret);
  const sig    = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${header}.${body}`)
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${header}.${body}.${sigB64}`;
}

export async function verifyJwt(token: string, secret: string): Promise<Record<string, unknown> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, sig] = parts;
  const key = await getKey(secret);

  // Base64url → Base64
  const sigBytes = Uint8Array.from(
    atob(sig.replace(/-/g, '+').replace(/_/g, '/')),
    c => c.charCodeAt(0)
  );

  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    sigBytes,
    new TextEncoder().encode(`${header}.${body}`)
  );

  if (!valid) return null;

  try {
    const payload = JSON.parse(atob(body)) as Record<string, unknown>;
    // Expiry kontrolü
    if (payload.exp && typeof payload.exp === 'number' && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

// Request'ten JWT token çıkar (cookie veya Authorization header)
function extractToken(request: Request): string | null {
  // Önce cookie
  const cookie = request.headers.get('Cookie') || '';
  const match  = cookie.match(/ef_token=([^;]+)/);
  if (match) return match[1];

  // Fallback: Authorization Bearer
  const auth = request.headers.get('Authorization') || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);

  return null;
}

// Korumalı route'larda kullanılan middleware
// Döndürdüğü null olmayan değer AuthContext; null ise 401 gönder
export async function requireAuth(
  request: Request,
  env: Env,
  requiredModule?: Module,
  requiredRoles?: Role[]
): Promise<AuthContext | Response> {
  const token = extractToken(request);
  if (!token) return err('Oturum açmanız gerekiyor', 401);

  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload) return err('Oturum süresi dolmuş veya geçersiz', 401);

  const ctx = payload as unknown as AuthContext;

  // Kullanıcı aktiflik kontrolü (DB'den anlık — token'da stale olabilir)
  const user = await env.DB
    .prepare('SELECT id, username, display_name, role, is_active FROM users WHERE id = ?')
    .bind(ctx.user.id)
    .first<{ id: number; username: string; display_name: string; role: Role; is_active: number }>();

  if (!user || !user.is_active) return err('Hesap aktif değil', 401);

  // Güncel modül izinlerini çek
  const rows = await env.DB
    .prepare('SELECT module FROM user_module_permissions WHERE user_id = ?')
    .bind(user.id)
    .all<{ module: Module }>();
  const modules: Module[] = rows.results.map(r => r.module);

  const authCtx: AuthContext = { user, modules };

  // Modül erişim kontrolü
  if (requiredModule && !modules.includes(requiredModule)) {
    return err('Bu modüle erişim yetkiniz yok', 403);
  }

  // Rol kontrolü
  if (requiredRoles && !requiredRoles.includes(user.role)) {
    return err('Bu işlem için yetkiniz yok', 403);
  }

  return authCtx;
}

// JWT cookie oluştur (7 günlük)
export function makeAuthCookie(token: string): string {
  return `ef_token=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`;
}

// JWT cookie temizle
export function clearAuthCookie(): string {
  return `ef_token=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
