// ============================================================
// Ortak backend validasyon middleware
// Kural 5: UI'da gizlemek güvenlik değildir — tüm kurallar burada da uygulanır
// ============================================================

import { Env, Category, KG_RULES, err } from '../types';

// Kümes aktif mi? — her coop_id içeren yazma işleminde çağrılır
export async function assertCoopActive(coopId: number, env: Env): Promise<Response | null> {
  const coop = await env.DB
    .prepare('SELECT is_active FROM coops WHERE id = ?')
    .bind(coopId)
    .first<{ is_active: number }>();

  if (!coop)           return err('Kümes bulunamadı', 404);
  if (!coop.is_active) return err('Pasif kümese veri girişi yapılamaz', 422);
  return null;
}

// Kategori bazlı kg aralık kontrolü — normal ve kirli için zorunlu
export function validateKg(category: Category, kg: number | null | undefined): Response | null {
  const rule = KG_RULES[category];

  if (rule === null) {
    // kirik / kucuk — kg girilmemeli
    if (kg !== null && kg !== undefined) {
      return err(`${category} kategorisi için kg girilemez`, 422);
    }
    return null;
  }

  // normal / kirli — kg zorunlu ve aralık içinde olmalı
  if (kg === null || kg === undefined || isNaN(kg)) {
    return err(`${category} kategorisi için kg zorunludur`, 422);
  }
  if (kg < rule.min || kg > rule.max) {
    return err(`${category} için kg ${rule.min}–${rule.max} aralığında olmalıdır (girilen: ${kg})`, 422);
  }
  return null;
}

// Stok özet tablosundan mevcut stok oku
export async function getCurrentStock(
  coopId: number,
  category: Category,
  env: Env
): Promise<{ total_kg: number; total_box: number }> {
  const row = await env.DB
    .prepare('SELECT total_kg, total_box FROM stock_summary WHERE coop_id = ? AND category = ?')
    .bind(coopId, category)
    .first<{ total_kg: number; total_box: number }>();

  return row ?? { total_kg: 0, total_box: 0 };
}

// Stok eksiye düşer mi kontrolü — satış ve üretim iptalinde kullanılır
export async function assertStockSufficient(
  coopId: number,
  category: Category,
  requestedBox: number,
  env: Env
): Promise<Response | null> {
  const stock = await getCurrentStock(coopId, category, env);
  if (stock.total_box < requestedBox) {
    return err(
      `Yetersiz stok: mevcut ${stock.total_box} kutu, istenen ${requestedBox} kutu`,
      422
    );
  }
  return null;
}

// Hammadde stok eksiye düşer mi kontrolü
export async function assertRawMaterialSufficient(
  rawMaterialId: number,
  requestedKg: number,
  env: Env
): Promise<Response | null> {
  const row = await env.DB
    .prepare('SELECT total_kg FROM raw_material_summary WHERE raw_material_id = ?')
    .bind(rawMaterialId)
    .first<{ total_kg: number }>();

  const current = row?.total_kg ?? 0;
  if (current < requestedKg) {
    return err(
      `Yetersiz hammadde stoku: mevcut ${current} kg, istenen ${requestedKg} kg`,
      422
    );
  }
  return null;
}

// Dönem kapanmış mı kontrolü — kapalı döneme yazma engeli
export async function assertPeriodOpen(
  table: 'monthly_closings_stok' | 'monthly_closings_yem' | 'monthly_closings_gubre',
  year: number,
  month: number,
  env: Env
): Promise<Response | null> {
  const row = await env.DB
    .prepare(`SELECT status FROM ${table} WHERE year = ? AND month = ?`)
    .bind(year, month)
    .first<{ status: string }>();

  if (row?.status === 'closed') {
    return err(`${year}/${month} dönemi kapalı, değişiklik yapılamaz`, 422);
  }
  return null;
}

// JSON body parse + temel alan kontrolü
export async function parseBody<T>(request: Request, requiredFields: string[]): Promise<T | Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return err('Geçersiz JSON gövdesi', 400);
  }

  for (const field of requiredFields) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      return err(`${field} alanı zorunludur`, 422);
    }
  }

  return body as T;
}
