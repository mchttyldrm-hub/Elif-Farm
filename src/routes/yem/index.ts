// ============================================================
// EF-Yem — Modül router
// ============================================================

import { Env, err } from '../../types';
import { requireAuth } from '../../middleware/auth';
import { listMaterials, createMaterial, updateMaterial } from './materials';
import { listPurchases, createPurchase, updatePurchasePrice, cancelPurchase } from './purchases';
import { listRecipes, getRecipe, createRecipe, activateRecipe } from './recipes';
import { createFeedProduction, listFeedProductions, reverseFeedProduction } from './production';
import { listSiloClosings, upsertSiloClosing, getSiloConsumption } from './silo';
import { getMonthlyClosingStatus, closeMonth } from './closing';
import { getDashboard, getMonthlyReport } from './reports';
import { setOpeningBalance, getOpeningBalance } from './opening';

export async function handleYem(
  request: Request,
  env: Env,
  subPath: string,
  method: string
): Promise<Response> {
  const parts    = subPath.replace(/^\//, '').split('/');
  const resource = parts[0];

  // ── Dashboard ──
  if (resource === 'dashboard' && method === 'GET') {
    const auth = await requireAuth(request, env, 'ef_yem');
    if (auth instanceof Response) return auth;
    return getDashboard(request, env, auth);
  }

  // ── Reports ──
  if (resource === 'reports') {
    const auth = await requireAuth(request, env, 'ef_yem', ['manager','director']);
    if (auth instanceof Response) return auth;
    if (parts[1] === 'monthly' && method === 'GET') return getMonthlyReport(request, env, auth);
    return err('Bulunamadı', 404);
  }

  // ── Materials ──
  if (resource === 'materials') {
    if (method === 'GET' && parts.length === 1) {
      const auth = await requireAuth(request, env, 'ef_yem');
      if (auth instanceof Response) return auth;
      return listMaterials(env);
    }
    if (method === 'POST') {
      const auth = await requireAuth(request, env, 'ef_yem', ['manager','director']);
      if (auth instanceof Response) return auth;
      return createMaterial(request, env, auth);
    }
    if (method === 'PUT' && parts.length === 2) {
      const auth = await requireAuth(request, env, 'ef_yem', ['manager','director']);
      if (auth instanceof Response) return auth;
      return updateMaterial(parseInt(parts[1]), request, env, auth);
    }
  }

  // ── Purchases ──
  if (resource === 'purchases') {
    if (method === 'GET' && parts.length === 1) {
      const auth = await requireAuth(request, env, 'ef_yem', ['manager','director']);
      if (auth instanceof Response) return auth;
      return listPurchases(request, env);
    }
    if (method === 'POST' && parts.length === 1) {
      const auth = await requireAuth(request, env, 'ef_yem', ['manager','director']);
      if (auth instanceof Response) return auth;
      return createPurchase(request, env, auth);
    }
    // /purchases/:id/price
    if (parts.length === 3 && parts[2] === 'price' && method === 'PUT') {
      const auth = await requireAuth(request, env, 'ef_yem', ['manager','director']);
      if (auth instanceof Response) return auth;
      return updatePurchasePrice(parseInt(parts[1]), request, env, auth);
    }
    // /purchases/:id/cancel
    if (parts.length === 3 && parts[2] === 'cancel' && method === 'POST') {
      const auth = await requireAuth(request, env, 'ef_yem', ['manager','director']);
      if (auth instanceof Response) return auth;
      return cancelPurchase(parseInt(parts[1]), request, env, auth);
    }
  }

  // ── Recipes ──
  if (resource === 'recipes') {
    if (method === 'GET' && parts.length === 1) {
      const auth = await requireAuth(request, env, 'ef_yem');
      if (auth instanceof Response) return auth;
      return listRecipes(request, env);
    }
    if (method === 'POST' && parts.length === 1) {
      const auth = await requireAuth(request, env, 'ef_yem', ['manager','director']);
      if (auth instanceof Response) return auth;
      return createRecipe(request, env, auth);
    }
    if (method === 'GET' && parts.length === 2) {
      const auth = await requireAuth(request, env, 'ef_yem');
      if (auth instanceof Response) return auth;
      return getRecipe(parseInt(parts[1]), env);
    }
    if (parts.length === 3 && parts[2] === 'activate' && method === 'POST') {
      const auth = await requireAuth(request, env, 'ef_yem', ['manager','director']);
      if (auth instanceof Response) return auth;
      return activateRecipe(parseInt(parts[1]), env, auth);
    }
  }

  // ── Feed Productions ──
  if (resource === 'productions') {
    if (method === 'GET') {
      const auth = await requireAuth(request, env, 'ef_yem');
      if (auth instanceof Response) return auth;
      return listFeedProductions(request, env);
    }
    if (method === 'POST' && parts.length === 1) {
      const auth = await requireAuth(request, env, 'ef_yem', ['employee','manager','director']);
      if (auth instanceof Response) return auth;
      return createFeedProduction(request, env, auth);
    }
    if (parts.length === 3 && parts[2] === 'reverse' && method === 'POST') {
      const auth = await requireAuth(request, env, 'ef_yem', ['manager','director']);
      if (auth instanceof Response) return auth;
      return reverseFeedProduction(parseInt(parts[1]), request, env, auth);
    }
  }

  // ── Silo ──
  if (resource === 'silo') {
    if (parts.length === 2 && parts[1] === 'consumption' && method === 'GET') {
      const auth = await requireAuth(request, env, 'ef_yem');
      if (auth instanceof Response) return auth;
      return getSiloConsumption(request, env);
    }
    if (method === 'GET') {
      const auth = await requireAuth(request, env, 'ef_yem');
      if (auth instanceof Response) return auth;
      return listSiloClosings(request, env);
    }
    if (method === 'POST') {
      const auth = await requireAuth(request, env, 'ef_yem', ['employee','manager','director']);
      if (auth instanceof Response) return auth;
      return upsertSiloClosing(request, env, auth);
    }
  }

  // ── Closing ──
  if (resource === 'closing' && parts[1] === 'monthly') {
    if (method === 'GET') {
      const auth = await requireAuth(request, env, 'ef_yem');
      if (auth instanceof Response) return auth;
      return getMonthlyClosingStatus(request, env, auth);
    }
    if (method === 'POST') {
      const auth = await requireAuth(request, env, 'ef_yem', ['manager','director']);
      if (auth instanceof Response) return auth;
      return closeMonth(request, env, auth);
    }
  }

  // ── Opening balance ──
  if (resource === 'opening-balance') {
    if (method === 'GET') {
      const auth = await requireAuth(request, env, 'ef_yem', ['manager','director']);
      if (auth instanceof Response) return auth;
      return getOpeningBalance(env);
    }
    if (method === 'POST') {
      const auth = await requireAuth(request, env, 'ef_yem', ['manager','director']);
      if (auth instanceof Response) return auth;
      return setOpeningBalance(request, env, auth);
    }
  }

  return err('Bulunamadı', 404);
}
