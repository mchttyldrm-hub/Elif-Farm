// ============================================================
// EF-Stok — Modül router
// ============================================================

import { Env, err } from '../../types';
import { requireAuth } from '../../middleware/auth';
import { createProduction, reverseProduction, listProductions } from './production';
import { createSale, listSales, getSale, priceSaleLine, cancelSale } from './sales';
import { createAdjustment, listAdjustments } from './adjustment';
import { getWeeklyClosingStatus, closeWeek, getMonthlyClosingStatus, closeMonth } from './closing';
import { getDashboard, getStockReport, getWeeklyReport, getMonthlyReport } from './reports';

export async function handleStok(
  request: Request,
  env: Env,
  subPath: string,  // path after /api/stok
  method: string
): Promise<Response> {
  // Parçala: /productions/123/reverse → ['productions','123','reverse']
  const parts = subPath.replace(/^\//, '').split('/');
  const resource = parts[0];

  // ── Dashboard ──
  if (resource === 'dashboard' && method === 'GET') {
    const auth = await requireAuth(request, env, 'ef_stok');
    if (auth instanceof Response) return auth;
    return getDashboard(request, env, auth);
  }

  // ── Reports ──
  if (resource === 'reports') {
    const auth = await requireAuth(request, env, 'ef_stok', ['manager','director']);
    if (auth instanceof Response) return auth;
    const sub = parts[1];
    if (sub === 'stock'   && method === 'GET') return getStockReport(request, env, auth);
    if (sub === 'weekly'  && method === 'GET') return getWeeklyReport(request, env, auth);
    if (sub === 'monthly' && method === 'GET') return getMonthlyReport(request, env, auth);
    return err('Bulunamadı', 404);
  }

  // ── Productions ──
  if (resource === 'productions') {
    if (method === 'GET') {
      const auth = await requireAuth(request, env, 'ef_stok');
      if (auth instanceof Response) return auth;
      return listProductions(request, env, auth);
    }
    if (method === 'POST' && parts.length === 1) {
      const auth = await requireAuth(request, env, 'ef_stok', ['employee','manager','director']);
      if (auth instanceof Response) return auth;
      return createProduction(request, env, auth);
    }
    // /productions/:id/reverse
    if (parts.length === 3 && parts[2] === 'reverse' && method === 'POST') {
      const auth = await requireAuth(request, env, 'ef_stok', ['manager','director']);
      if (auth instanceof Response) return auth;
      return reverseProduction(parseInt(parts[1]), request, env, auth);
    }
  }

  // ── Sales ──
  if (resource === 'sales') {
    if (method === 'GET' && parts.length === 1) {
      const auth = await requireAuth(request, env, 'ef_stok');
      if (auth instanceof Response) return auth;
      return listSales(request, env, auth);
    }
    if (method === 'POST' && parts.length === 1) {
      const auth = await requireAuth(request, env, 'ef_stok', ['employee','manager','director']);
      if (auth instanceof Response) return auth;
      return createSale(request, env, auth);
    }
    if (parts.length === 2 && method === 'GET') {
      const auth = await requireAuth(request, env, 'ef_stok');
      if (auth instanceof Response) return auth;
      return getSale(parseInt(parts[1]), env, auth);
    }
    // /sales/:id/lines/:lineId
    if (parts.length === 4 && parts[2] === 'lines' && method === 'PUT') {
      const auth = await requireAuth(request, env, 'ef_stok', ['manager','director']);
      if (auth instanceof Response) return auth;
      return priceSaleLine(parseInt(parts[1]), parseInt(parts[3]), request, env, auth);
    }
    // /sales/:id/cancel
    if (parts.length === 3 && parts[2] === 'cancel' && method === 'POST') {
      const auth = await requireAuth(request, env, 'ef_stok', ['manager','director']);
      if (auth instanceof Response) return auth;
      return cancelSale(parseInt(parts[1]), request, env, auth);
    }
  }

  // ── Adjustments ──
  if (resource === 'adjustments') {
    if (method === 'GET') {
      const auth = await requireAuth(request, env, 'ef_stok', ['manager','director']);
      if (auth instanceof Response) return auth;
      return listAdjustments(request, env, auth);
    }
    if (method === 'POST') {
      const auth = await requireAuth(request, env, 'ef_stok', ['manager','director']);
      if (auth instanceof Response) return auth;
      return createAdjustment(request, env, auth);
    }
  }

  // ── Closing ──
  if (resource === 'closing') {
    const sub = parts[1];
    if (sub === 'weekly') {
      if (method === 'GET') {
        const auth = await requireAuth(request, env, 'ef_stok');
        if (auth instanceof Response) return auth;
        return getWeeklyClosingStatus(request, env, auth);
      }
      if (method === 'POST') {
        const auth = await requireAuth(request, env, 'ef_stok', ['manager','director']);
        if (auth instanceof Response) return auth;
        return closeWeek(request, env, auth);
      }
    }
    if (sub === 'monthly') {
      if (method === 'GET') {
        const auth = await requireAuth(request, env, 'ef_stok');
        if (auth instanceof Response) return auth;
        return getMonthlyClosingStatus(request, env, auth);
      }
      if (method === 'POST') {
        const auth = await requireAuth(request, env, 'ef_stok', ['manager','director']);
        if (auth instanceof Response) return auth;
        return closeMonth(request, env, auth);
      }
    }
  }

  return err('Bulunamadı', 404);
}
