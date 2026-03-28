// ============================================================
// EF-Stok — Satış belgesi yönetimi
// POST /api/stok/sales                     — satış aç
// GET  /api/stok/sales                     — liste
// GET  /api/stok/sales/:id                 — detay
// PUT  /api/stok/sales/:id/lines/:lineId   — fiyat gir (manager)
// POST /api/stok/sales/:id/cancel          — iptal et
// ============================================================

import { Env, Category, SaleStatus, ok, err } from '../../types';
import { AuthContext } from '../../types';
import { writeLedgerEntry } from '../../lib/ledger';
import { assertCoopActive, validateKg, assertStockSufficient, parseBody, assertPeriodOpen } from '../../middleware/validate';
import { getYearMonth, today } from '../../lib/week';

interface SaleLine {
  coop_id: number;
  category: Category;
  kg: number | null;
  box_count: number;
}

interface SaleBody {
  transaction_date: string;
  note?: string;
  lines: SaleLine[];
}

// Satış numarası üret: EFS-YYYYMMDD-NNN
async function generateSaleNo(date: string, env: Env): Promise<string> {
  const dateKey = date.replace(/-/g, '');
  const row = await env.DB.prepare(`
    SELECT COALESCE(MAX(CAST(substr(sale_no, 13) AS INTEGER)), 0) + 1 AS next_no
    FROM sales WHERE sale_no LIKE ?
  `).bind(`EFS-${dateKey}-%`).first<{ next_no: number }>();
  const seq = String(row?.next_no ?? 1).padStart(3, '0');
  return `EFS-${dateKey}-${seq}`;
}

// Satış durumunu satır fiyatlarına göre yeniden hesapla
async function recalcSaleStatus(saleId: number, env: Env): Promise<SaleStatus> {
  const counts = await env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      COUNT(price_per_box) AS priced
    FROM sale_lines WHERE sale_id = ?
  `).bind(saleId).first<{ total: number; priced: number }>();

  if (!counts || counts.total === 0) return 'pending';
  if (counts.priced === 0)            return 'pending';
  if (counts.priced < counts.total)   return 'partially_priced';
  return 'closed';  // tüm satırlar fiyatlandı → otomatik kapat
}

// POST /api/stok/sales
export async function createSale(
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  const body = await parseBody<SaleBody>(request, ['transaction_date', 'lines']);
  if (body instanceof Response) return body;

  const { transaction_date, note, lines } = body;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(transaction_date)) return err('Geçersiz tarih formatı', 422);
  if (!Array.isArray(lines) || lines.length === 0) return err('En az bir satır gereklidir', 422);

  // Dönem açık mı?
  const { year, month } = getYearMonth(transaction_date);
  const periodErr = await assertPeriodOpen('monthly_closings_stok', year, month, env);
  if (periodErr) return periodErr;

  // Her satırı validate et
  for (const line of lines) {
    if (!line.coop_id || !line.category || !line.box_count) {
      return err('Her satırda coop_id, category ve box_count zorunludur', 422);
    }
    if (line.box_count <= 0) return err('Kutu adedi 0\'dan büyük olmalıdır', 422);

    const coopErr = await assertCoopActive(line.coop_id, env);
    if (coopErr) return coopErr;

    const kgErr = validateKg(line.category, line.kg ?? null);
    if (kgErr) return kgErr;

    const stockErr = await assertStockSufficient(line.coop_id, line.category, line.box_count, env);
    if (stockErr) return stockErr;
  }

  const sale_no = await generateSaleNo(transaction_date, env);

  // Satış belgesi oluştur
  const saleResult = await env.DB.prepare(`
    INSERT INTO sales (sale_no, transaction_date, status, note, created_by)
    VALUES (?, ?, 'pending', ?, ?)
  `).bind(sale_no, transaction_date, note ?? null, auth.user.id).run();

  const saleId = saleResult.meta.last_row_id;

  // Satır + ledger (stok düşer: −box_count) — her satır için
  for (const line of lines) {
    const lineResult = await env.DB.prepare(`
      INSERT INTO sale_lines (sale_id, coop_id, category, kg, box_count)
      VALUES (?, ?, ?, ?, ?)
    `).bind(saleId, line.coop_id, line.category, line.kg ?? null, line.box_count).run();

    await writeLedgerEntry({
      coopId: line.coop_id,
      category: line.category,
      movementType: 'sale',
      referenceId: lineResult.meta.last_row_id,
      kg: line.kg ? -line.kg : null,   // negatif → stok düşer
      boxCount: -line.box_count,
      note: `Satış: ${sale_no}`,
      createdBy: auth.user.id,
    }, env);
  }

  return ok({ id: saleId, sale_no, message: 'Satış oluşturuldu' }, 201);
}

// GET /api/stok/sales
export async function listSales(
  request: Request,
  env: Env,
  _auth: AuthContext
): Promise<Response> {
  const url      = new URL(request.url);
  const status   = url.searchParams.get('status');
  const dateFrom = url.searchParams.get('date_from') ?? new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const dateTo   = url.searchParams.get('date_to')   ?? today();

  let query = `
    SELECT s.id, s.sale_no, s.transaction_date, s.status, s.note,
           COUNT(sl.id) AS line_count,
           COUNT(sl.price_per_box) AS priced_count,
           COALESCE(SUM(sl.box_count), 0) AS total_box,
           COALESCE(SUM(CASE WHEN sl.price_per_box IS NOT NULL
                        THEN sl.price_per_box * sl.box_count ELSE 0 END), 0) AS kesin_gelir
    FROM sales s
    LEFT JOIN sale_lines sl ON sl.sale_id = s.id
    WHERE s.transaction_date BETWEEN ? AND ?
  `;
  const params: (string | number)[] = [dateFrom, dateTo];

  if (status) { query += ' AND s.status = ?'; params.push(status); }

  query += ' GROUP BY s.id ORDER BY s.transaction_date DESC, s.id DESC';

  const rows = await env.DB.prepare(query).bind(...params).all();
  return ok(rows.results);
}

// GET /api/stok/sales/:id
export async function getSale(
  saleId: number,
  env: Env,
  _auth: AuthContext
): Promise<Response> {
  const sale = await env.DB.prepare(`
    SELECT s.id, s.sale_no, s.transaction_date, s.status, s.note, s.created_at
    FROM sales s WHERE s.id = ?
  `).bind(saleId).first();

  if (!sale) return err('Satış bulunamadı', 404);

  const lines = await env.DB.prepare(`
    SELECT sl.id, sl.coop_id, sl.category, sl.kg, sl.box_count, sl.price_per_box,
           CASE WHEN sl.price_per_box IS NOT NULL
                THEN sl.price_per_box * sl.box_count ELSE NULL END AS line_total,
           c.name AS coop_name
    FROM sale_lines sl JOIN coops c ON c.id = sl.coop_id
    WHERE sl.sale_id = ?
  `).bind(saleId).all();

  return ok({ ...sale, lines: lines.results });
}

// PUT /api/stok/sales/:id/lines/:lineId — fiyat gir (manager only)
export async function priceSaleLine(
  saleId: number,
  lineId: number,
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  const body = await parseBody<{ price_per_box: number }>(request, ['price_per_box']);
  if (body instanceof Response) return body;

  if (body.price_per_box <= 0) return err('Fiyat 0\'dan büyük olmalıdır', 422);

  const line = await env.DB.prepare(`
    SELECT sl.id, sl.sale_id, sl.price_per_box AS old_price, s.status, s.transaction_date
    FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id
    WHERE sl.id = ? AND sl.sale_id = ?
  `).bind(lineId, saleId).first<{
    id: number; sale_id: number; old_price: number | null; status: string; transaction_date: string;
  }>();

  if (!line)                         return err('Satış satırı bulunamadı', 404);
  if (line.status === 'cancelled')   return err('İptal edilmiş satışa fiyat girilemez', 422);

  // Dönem açık mı?
  const { year, month } = getYearMonth(line.transaction_date);
  const periodErr = await assertPeriodOpen('monthly_closings_stok', year, month, env);
  if (periodErr) return periodErr;

  await env.DB.prepare(
    'UPDATE sale_lines SET price_per_box = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(body.price_per_box, lineId).run();

  // Satış durumunu yeniden hesapla
  const newStatus = await recalcSaleStatus(saleId, env);
  await env.DB.prepare(
    'UPDATE sales SET status = ?, updated_by = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(newStatus, auth.user.id, saleId).run();

  // Audit log
  await env.DB.prepare(`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_data, new_data)
    VALUES (?, 'price_sale_line', 'sale_lines', ?, ?, ?)
  `).bind(
    auth.user.id, lineId,
    JSON.stringify({ price_per_box: line.old_price }),
    JSON.stringify({ price_per_box: body.price_per_box })
  ).run();

  return ok({ sale_status: newStatus, message: 'Fiyat kaydedildi' });
}

// POST /api/stok/sales/:id/cancel — satış iptali
export async function cancelSale(
  saleId: number,
  request: Request,
  env: Env,
  auth: AuthContext
): Promise<Response> {
  const body = await parseBody<{ reason: string }>(request, ['reason']);
  if (body instanceof Response) return body;

  const sale = await env.DB.prepare(
    'SELECT id, sale_no, status, transaction_date FROM sales WHERE id = ?'
  ).bind(saleId).first<{ id: number; sale_no: string; status: SaleStatus; transaction_date: string }>();

  if (!sale)                         return err('Satış bulunamadı', 404);
  if (sale.status === 'cancelled')   return err('Satış zaten iptal edilmiş', 422);

  // Dönem açık mı?
  const { year, month } = getYearMonth(sale.transaction_date);
  const periodErr = await assertPeriodOpen('monthly_closings_stok', year, month, env);
  if (periodErr) return periodErr;

  // Satış satırlarını al
  const lines = await env.DB.prepare(`
    SELECT id, coop_id, category, kg, box_count FROM sale_lines WHERE sale_id = ?
  `).bind(saleId).all<{ id: number; coop_id: number; category: Category; kg: number | null; box_count: number }>();

  // Her satır için stok iade ledger hareketi (sale_cancel: +box_count)
  for (const line of lines.results) {
    await writeLedgerEntry({
      coopId: line.coop_id,
      category: line.category,
      movementType: 'sale_cancel',
      referenceId: line.id,
      kg: line.kg !== null ? line.kg : null,   // pozitif → stok geri döner
      boxCount: line.box_count,
      note: `İptal: ${sale.sale_no} — ${body.reason}`,
      createdBy: auth.user.id,
    }, env);
  }

  await env.DB.prepare(
    'UPDATE sales SET status = \'cancelled\', updated_by = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(auth.user.id, saleId).run();

  // Audit log
  await env.DB.prepare(`
    INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_data, new_data, note)
    VALUES (?, 'sale_cancel', 'sales', ?, ?, ?, ?)
  `).bind(
    auth.user.id, saleId,
    JSON.stringify({ status: sale.status }),
    JSON.stringify({ status: 'cancelled' }),
    body.reason
  ).run();

  return ok({ message: 'Satış iptal edildi, stok iade edildi' });
}
