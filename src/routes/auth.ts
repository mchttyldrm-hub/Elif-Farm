// ============================================================
// Auth routes: POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
// ============================================================

import { Env, Role, Module, ok, err } from '../types';
import { signJwt, verifyJwt, makeAuthCookie, clearAuthCookie } from '../middleware/auth';

// Basit bcrypt alternatifi: Cloudflare Workers'ta native bcrypt yok.
// Web Crypto PBKDF2 ile SHA-256 kullanıyoruz (bcrypt yerine).
// Seed'deki hash'leri bu fonksiyonla üretip DB'ye yazın.
async function hashPassword(password: string): Promise<string> {
  const salt   = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password),
    { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 200_000, hash: 'SHA-256' },
    key, 256
  );
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `pbkdf2:${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'pbkdf2') return false;

  const salt = Uint8Array.from(parts[1].match(/.{2}/g)!.map(b => parseInt(b, 16)));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password),
    { name: 'PBKDF2' }, false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 200_000, hash: 'SHA-256' },
    key, 256
  );
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex === parts[2];
}

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  let body: { username?: string; password?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return err('Geçersiz istek gövdesi', 400);
  }

  if (!body.username || !body.password) {
    return err('Kullanıcı adı ve şifre zorunludur', 422);
  }

  const user = await env.DB
    .prepare('SELECT id, username, password_hash, display_name, role, is_active FROM users WHERE username = ?')
    .bind(body.username.trim())
    .first<{ id: number; username: string; password_hash: string; display_name: string; role: Role; is_active: number }>();

  if (!user) return err('Kullanıcı adı veya şifre hatalı', 401);
  if (!user.is_active) return err('Hesap aktif değil', 401);

  const valid = await verifyPassword(body.password, user.password_hash);
  if (!valid) return err('Kullanıcı adı veya şifre hatalı', 401);

  // Modül izinlerini çek
  const perms = await env.DB
    .prepare('SELECT module FROM user_module_permissions WHERE user_id = ?')
    .bind(user.id)
    .all<{ module: Module }>();
  const modules: Module[] = perms.results.map(r => r.module);

  // JWT payload (7 gün)
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;
  const token = await signJwt(
    { user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role, is_active: 1 }, modules, exp },
    env.JWT_SECRET
  );

  return new Response(
    JSON.stringify({ ok: true, data: { user: { id: user.id, display_name: user.display_name, role: user.role }, modules } }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': makeAuthCookie(token),
      },
    }
  );
}

export async function handleLogout(_request: Request, _env: Env): Promise<Response> {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearAuthCookie(),
    },
  });
}

export async function handleMe(request: Request, env: Env): Promise<Response> {
  const cookie = request.headers.get('Cookie') || '';
  const match  = cookie.match(/ef_token=([^;]+)/);
  if (!match) return err('Oturum yok', 401);

  const payload = await verifyJwt(match[1], env.JWT_SECRET);
  if (!payload) return err('Geçersiz oturum', 401);

  const ctx = payload as { user: { id: number; role: Role }; modules: Module[] };

  const user = await env.DB
    .prepare('SELECT id, username, display_name, role, is_active FROM users WHERE id = ?')
    .bind(ctx.user.id)
    .first<{ id: number; username: string; display_name: string; role: Role; is_active: number }>();

  if (!user || !user.is_active) return err('Hesap aktif değil', 401);

  const perms = await env.DB
    .prepare('SELECT module FROM user_module_permissions WHERE user_id = ?')
    .bind(user.id)
    .all<{ module: Module }>();

  return ok({ user: { id: user.id, display_name: user.display_name, role: user.role }, modules: perms.results.map(r => r.module) });
}

// Yardımcı: yeni kullanıcı şifresi hash'lemek için (sadece setup sırasında kullanılır)
export async function handleHashPassword(request: Request, _env: Env): Promise<Response> {
  const body = await request.json() as { password?: string };
  if (!body.password) return err('password zorunludur', 422);
  const hash = await hashPassword(body.password);
  return ok({ hash });
}
