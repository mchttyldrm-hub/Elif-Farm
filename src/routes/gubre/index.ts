// ============================================================
// EF-Gübre — Modül router
// ============================================================

import { Env, err } from '../../types';
import { requireAuth } from '../../middleware/auth';
import { listEntries, createEntry, deleteEntry } from './entries';
import { getMonthlyClosingStatus, closeMonth, getMonthlyReport } from './closing';

export async function handleGubre(
  request: Request,
  env: Env,
  subPath: string,
  method: string
): Promise<Response> {
  const parts    = subPath.replace(/^\//, '').split('/');
  const resource = parts[0];

  // ── Entries ──
  if (resource === 'entries') {
    if (method === 'GET') {
      const auth = await requireAuth(request, env, 'ef_gubre');
      if (auth instanceof Response) return auth;
      return listEntries(request, env);
    }
    if (method === 'POST' && parts.length === 1) {
      const auth = await requireAuth(request, env, 'ef_gubre', ['employee', 'manager', 'director']);
      if (auth instanceof Response) return auth;
      return createEntry(request, env, auth);
    }
    // /entries/:id/delete
    if (parts.length === 3 && parts[2] === 'delete' && method === 'POST') {
      const auth = await requireAuth(request, env, 'ef_gubre', ['manager', 'director']);
      if (auth instanceof Response) return auth;
      return deleteEntry(parseInt(parts[1]), request, env, auth);
    }
  }

  // ── Closing ──
  if (resource === 'closing' && parts[1] === 'monthly') {
    if (method === 'GET') {
      const auth = await requireAuth(request, env, 'ef_gubre');
      if (auth instanceof Response) return auth;
      return getMonthlyClosingStatus(request, env, auth);
    }
    if (method === 'POST') {
      const auth = await requireAuth(request, env, 'ef_gubre', ['manager', 'director']);
      if (auth instanceof Response) return auth;
      return closeMonth(request, env, auth);
    }
  }

  // ── Reports ──
  if (resource === 'reports') {
    const auth = await requireAuth(request, env, 'ef_gubre', ['manager', 'director']);
    if (auth instanceof Response) return auth;
    if (parts[1] === 'monthly' && method === 'GET') return getMonthlyReport(request, env, auth);
    return err('Bulunamadı', 404);
  }

  return err('Bulunamadı', 404);
}
