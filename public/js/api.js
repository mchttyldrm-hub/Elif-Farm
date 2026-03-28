// ============================================================
// API istemci — tüm fetch çağrıları buradan
// ============================================================

const API = {
  async call(method, path, body) {
    const opts = {
      method,
      credentials: 'include',
      headers: {},
    };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch('/api' + path, opts);
    const data = await res.json();
    if (!data.ok && res.status === 401) {
      // Oturum sona erdi — login'e yönlendir
      window.app?.showLogin();
      throw new Error('Oturum sona erdi');
    }
    return data;
  },
  get:    (path)        => API.call('GET',    path),
  post:   (path, body)  => API.call('POST',   path, body),
  put:    (path, body)  => API.call('PUT',    path, body),
  del:    (path, body)  => API.call('DELETE', path, body),

  // Auth
  login:   (u, p)  => API.post('/auth/login',  { username: u, password: p }),
  logout:  ()      => API.post('/auth/logout'),
  me:      ()      => API.get('/auth/me'),

  // Coops
  coops:   ()      => API.get('/coops'),

  // EF-Stok
  stok: {
    dashboard:  (date) => API.get(`/stok/dashboard${date ? '?date=' + date : ''}`),
    stock:      ()     => API.get('/stok/reports/stock'),

    createProduction: (body)           => API.post('/stok/productions', body),
    listProductions:  (date, coopId)   => API.get(`/stok/productions?date=${date}${coopId ? '&coop_id=' + coopId : ''}`),
    reverseProduction:(id, reason)     => API.post(`/stok/productions/${id}/reverse`, { reason }),

    createSale:       (body)           => API.post('/stok/sales', body),
    listSales:        (params)         => API.get('/stok/sales?' + new URLSearchParams(params).toString()),
    getSale:          (id)             => API.get(`/stok/sales/${id}`),
    priceLine:        (saleId, lineId, price) => API.put(`/stok/sales/${saleId}/lines/${lineId}`, { price_per_box: price }),
    cancelSale:       (id, reason)     => API.post(`/stok/sales/${id}/cancel`, { reason }),

    createAdjustment: (body)           => API.post('/stok/adjustments', body),
    listAdjustments:  ()               => API.get('/stok/adjustments'),

    weeklyStatus:   (date) => API.get(`/stok/closing/weekly${date ? '?date=' + date : ''}`),
    closeWeek:      (date) => API.post(`/stok/closing/weekly${date ? '?date=' + date : ''}`),
    monthlyStatus:  (date) => API.get(`/stok/closing/monthly${date ? '?date=' + date : ''}`),
    closeMonth:     (date) => API.post(`/stok/closing/monthly${date ? '?date=' + date : ''}`),

    weeklyReport:   (date) => API.get(`/stok/reports/weekly?date=${date}`),
    monthlyReport:  (y, m) => API.get(`/stok/reports/monthly?year=${y}&month=${m}`),
  },

  // EF-Yem
  yem: {
    dashboard:      (date) => API.get(`/yem/dashboard${date ? '?date=' + date : ''}`),

    listMaterials:  ()     => API.get('/yem/materials'),
    createMaterial: (body) => API.post('/yem/materials', body),
    updateMaterial: (id, body) => API.put(`/yem/materials/${id}`, body),

    listPurchases:  (p)    => API.get('/yem/purchases?' + new URLSearchParams(p).toString()),
    createPurchase: (body) => API.post('/yem/purchases', body),
    updatePurchasePrice: (id, price) => API.put(`/yem/purchases/${id}/price`, { unit_price_iqd: price }),
    cancelPurchase: (id, reason)    => API.post(`/yem/purchases/${id}/cancel`, { reason }),

    listRecipes:    (coopId) => API.get(`/yem/recipes${coopId ? '?coop_id=' + coopId : ''}`),
    getRecipe:      (id)     => API.get(`/yem/recipes/${id}`),
    createRecipe:   (body)   => API.post('/yem/recipes', body),
    activateRecipe: (id)     => API.post(`/yem/recipes/${id}/activate`),

    listProductions:   (p)   => API.get('/yem/productions?' + new URLSearchParams(p).toString()),
    createProduction:  (body) => API.post('/yem/productions', body),
    reverseProduction: (id, reason) => API.post(`/yem/productions/${id}/reverse`, { reason }),

    listSiloClosings:   (coopId) => API.get(`/yem/silo${coopId ? '?coop_id=' + coopId : ''}`),
    upsertSiloClosing:  (body)   => API.post('/yem/silo', body),
    getSiloConsumption: (coopId, date) => API.get(`/yem/silo/consumption?coop_id=${coopId}&date=${date}`),

    monthlyClosingStatus: (date) => API.get(`/yem/closing/monthly${date ? '?date=' + date : ''}`),
    closeMonth:           (date) => API.post(`/yem/closing/monthly${date ? '?date=' + date : ''}`),

    monthlyReport:  (y, m) => API.get(`/yem/reports/monthly?year=${y}&month=${m}`),

    getOpeningBalance: ()     => API.get('/yem/opening-balance'),
    setOpeningBalance: (body) => API.post('/yem/opening-balance', body),
  },

  // EF-Gübre
  gubre: {
    listEntries:          (p)           => API.get('/gubre/entries?' + new URLSearchParams(p).toString()),
    createEntry:          (body)        => API.post('/gubre/entries', body),
    deleteEntry:          (id, reason)  => API.post(`/gubre/entries/${id}/delete`, { reason }),

    monthlyClosingStatus: (date) => API.get(`/gubre/closing/monthly${date ? '?date=' + date : ''}`),
    closeMonth:           (date) => API.post(`/gubre/closing/monthly${date ? '?date=' + date : ''}`),

    monthlyReport: (y, m) => API.get(`/gubre/reports/monthly?year=${y}&month=${m}`),
  },

  // Push
  push: {
    subscribe:   (sub)      => API.post('/push/subscribe', sub),
    unsubscribe: (endpoint) => API.post('/push/unsubscribe', { endpoint }),
  },

  // Notifications
  notifications:      ()              => API.get('/notifications'),
  markRead:           (id)            => API.put(`/notifications/${id}`),
  getNotifPrefs:      ()              => API.get('/notification-prefs'),
  setNotifPref:       (type, channel) => API.put('/notification-prefs', { notification_type: type, channel }),
};

// ── Yardımcılar ──

function fmt(n) {
  if (n === null || n === undefined) return '—';
  if (typeof n === 'number') return n.toLocaleString('tr-TR');
  return n;
}

function fmtIQD(n) {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('tr-TR') + ' IQD';
}

function fmtDate(s) {
  if (!s) return '—';
  const [y, m, d] = s.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

function catLabel(cat) {
  const labels = { normal: 'Normal', kirli: 'Kirli', kirik: 'Kırık', kucuk: 'Küçük' };
  return labels[cat] ?? cat;
}

function catClass(cat) {
  return 'cat-' + cat;
}

function statusBadge(status) {
  const labels = {
    pending:          'Fiyat Bekleniyor',
    partially_priced: 'Kısmen Fiyatlandı',
    closed:           'Kapandı',
    cancelled:        'İptal',
    open:             'Açık',
  };
  return `<span class="badge-status badge-${status}">${labels[status] ?? status}</span>`;
}

function showToast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `alert alert-${type}`;
  el.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:999;max-width:340px;width:90%';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── CSV export yardımcısı ──

function downloadCsv(filename, rows) {
  // rows: array of arrays — first row = header
  const content = rows.map(row =>
    row.map(cell => {
      const s = String(cell ?? '');
      // RFC 4180: quote cells containing comma, quote, or newline
      return (s.includes(',') || s.includes('"') || s.includes('\n'))
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
    }).join(',')
  ).join('\r\n');

  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
