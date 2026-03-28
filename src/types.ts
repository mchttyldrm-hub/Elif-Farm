// ============================================================
// Merkezi tip tanımları
// ============================================================

export interface Env {
  DB: D1Database;
  JWT_SECRET: string;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
}

export type Role = 'employee' | 'manager' | 'director';
export type Module = 'ef_stok' | 'ef_yem' | 'ef_gubre';

export interface User {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  is_active: number;
}

// JWT payload — Worker'da context olarak taşınır
export interface AuthContext {
  user: User;
  modules: Module[];
}

export type Category = 'normal' | 'kirli' | 'kirik' | 'kucuk';

export type StockMovementType =
  | 'opening'
  | 'production'
  | 'production_reversal'
  | 'sale'
  | 'sale_cancel'
  | 'adjustment';

export type RawMaterialMovementType =
  | 'opening'
  | 'purchase'
  | 'purchase_cancel'
  | 'production_use'
  | 'production_reversal'
  | 'adjustment';

export type SaleStatus = 'pending' | 'partially_priced' | 'closed' | 'cancelled';
export type PurchaseStatus = 'complete' | 'missing_price';
export type ClosingStatus = 'open' | 'closed';

// Kategori bazlı kg aralık kuralları
export const KG_RULES: Record<string, { min: number; max: number } | null> = {
  normal: { min: 20, max: 30 },
  kirli:  { min: 22, max: 27 },
  kirik:  null,  // kg yok
  kucuk:  null,  // kg yok
};

// Standart API yanıt yardımcıları
export function ok(data: unknown, status = 200): Response {
  return Response.json({ ok: true, data }, { status });
}

export function err(message: string, status = 400): Response {
  return Response.json({ ok: false, error: message }, { status });
}
