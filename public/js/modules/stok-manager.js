// ============================================================
// EF-Stok — Manager/Director UI
// Sekmeler: Özet | Satışlar | Fiyatlama | Kapanış | Raporlar
// ============================================================

const StokManager = {
  activeTab: 'dashboard',

  async render(container) {
    container.innerHTML = `
      <div id="stok-mgr">
        <div class="header">
          <h1>EF-Stok</h1>
          <button onclick="doLogout()" style="background:none;border:none;color:rgba(255,255,255,.8);cursor:pointer;font-size:.8rem">Çıkış</button>
        </div>

        <!-- Tab bar -->
        <div style="display:flex;background:#fff;border-bottom:1px solid var(--c-border);overflow-x:auto;-webkit-overflow-scrolling:touch">
          ${['dashboard','sales','pricing','closing','reports'].map(t =>
            `<button class="mgr-tab ${t === 'dashboard' ? 'tab-active' : ''}"
                     data-tab="${t}" onclick="StokManager.switchTab('${t}')"
                     style="padding:12px 16px;border:none;background:none;font-size:.9rem;font-weight:500;white-space:nowrap;cursor:pointer;border-bottom:2px solid transparent;color:var(--c-text-s)">
               ${{'dashboard':'Özet','sales':'Satışlar','pricing':'Fiyatlama','closing':'Kapanış','reports':'Raporlar'}[t]}
             </button>`
          ).join('')}
        </div>

        <!-- Tab içerikleri -->
        <div id="mgr-tab-content"></div>
      </div>
    `;
    this.switchTab('dashboard');
  },

  switchTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('.mgr-tab').forEach(b => {
      const active = b.dataset.tab === tab;
      b.style.borderBottomColor = active ? 'var(--c-primary-m)' : 'transparent';
      b.style.color = active ? 'var(--c-primary-m)' : 'var(--c-text-s)';
    });
    const content = document.getElementById('mgr-tab-content');
    content.innerHTML = '<div class="loading">Yükleniyor…</div>';
    switch (tab) {
      case 'dashboard': this.renderDashboard(content); break;
      case 'sales':     this.renderSales(content);     break;
      case 'pricing':   this.renderPricing(content);   break;
      case 'closing':   this.renderClosing(content);   break;
      case 'reports':   this.renderReports(content);   break;
    }
  },

  // ── Dashboard ──
  async renderDashboard(el) {
    const [dash, stock] = await Promise.all([
      API.stok.dashboard(),
      API.stok.stock(),
    ]);
    if (!dash.ok) { el.innerHTML = '<div class="empty">Yüklenemedi</div>'; return; }

    const d = dash.data;

    // Bekleyen işler alert
    let alerts = '';
    if (d.pending_sales?.length) {
      alerts += `<div class="alert alert-warn" style="margin:12px 12px 0">
        <span>⚠️</span>
        <span>${d.pending_sales.length} satışta fiyat girilmemiş satır var</span>
      </div>`;
    }
    if (d.current_week?.status === 'open') {
      alerts += `<div class="alert alert-info" style="margin:8px 12px 0">
        <span>📋</span>
        <span>Hafta kapanışı: ${fmtDate(d.current_week.week_start)} – ${fmtDate(d.current_week.week_end)}</span>
      </div>`;
    }

    // Gelir özeti (Kural 4)
    const rev = d.revenue;
    const revHtml = `
      <div class="card" style="margin-top:12px">
        <div class="card-header"><h2>Gelir Özeti — ${fmtDate(d.date)}</h2></div>
        <div class="card-body">
          <div class="revenue-grid">
            <div class="rev-cell rev-kesin">
              <div class="label">Kesin Gelir</div>
              <div class="value">${fmtIQD(rev.kesin_gelir)}</div>
            </div>
            <div class="rev-cell rev-beklenen">
              <div class="label">Bekleyen</div>
              <div class="value">${rev.bekleyen_box > 0 ? rev.bekleyen_box + ' kutu' : '—'}</div>
            </div>
            <div class="rev-cell rev-toplam">
              <div class="label">Toplam Sevk</div>
              <div class="value">${fmt(rev.toplam_sevk_box)} kutu</div>
            </div>
          </div>
        </div>
      </div>`;

    // Bugünkü üretim
    let prodHtml = '';
    if (d.production?.length) {
      prodHtml = `<div class="card" style="margin-top:12px">
        <div class="card-header"><h2>Bugün Üretim</h2></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Kümes</th><th>Kategori</th><th>Kg</th><th>Kutu</th></tr></thead>
          <tbody>
          ${d.production.map(p => `
            <tr>
              <td>${escHtml(p.coop_name)}</td>
              <td><span class="${catClass(p.category)}">${catLabel(p.category)}</span></td>
              <td>${p.total_kg > 0 ? p.total_kg.toFixed(1) : '—'}</td>
              <td>${fmt(p.total_box)}</td>
            </tr>
          `).join('')}
          </tbody></table></div></div>`;
    }

    // Stok
    let stockHtml = '';
    if (stock.ok && stock.data.length) {
      stockHtml = `<div class="card" style="margin-top:12px">
        <div class="card-header"><h2>Mevcut Stok</h2></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Kümes</th><th>Kategori</th><th>Kg</th><th>Kutu</th></tr></thead>
          <tbody>
          ${stock.data.filter(s => s.total_box > 0).map(s => `
            <tr>
              <td>${escHtml(s.coop_name)}</td>
              <td><span class="${catClass(s.category)}">${catLabel(s.category)}</span></td>
              <td>${s.total_kg > 0 ? parseFloat(s.total_kg).toFixed(1) : '—'}</td>
              <td>${fmt(s.total_box)}</td>
            </tr>
          `).join('')}
          </tbody></table></div></div>`;
    }

    // Bekleyen satışlar
    let pendHtml = '';
    if (d.pending_sales?.length) {
      pendHtml = `<div class="card" style="margin-top:12px">
        <div class="card-header"><h2>Fiyat Bekleyen Satışlar</h2></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Satış No</th><th>Tarih</th><th>Eksik</th><th></th></tr></thead>
          <tbody>
          ${d.pending_sales.map(s => `
            <tr>
              <td>${escHtml(s.sale_no)}</td>
              <td>${fmtDate(s.transaction_date)}</td>
              <td>${s.unpriced_count} satır</td>
              <td><button class="btn btn-sm btn-ghost" onclick="StokManager.openSaleDetail(${s.id})">Fiyatla</button></td>
            </tr>
          `).join('')}
          </tbody></table></div></div>`;
    }

    el.innerHTML = alerts + revHtml + prodHtml + stockHtml + pendHtml + '<div style="height:16px"></div>';
  },

  // ── Satışlar ──
  async renderSales(el) {
    el.innerHTML = `
      <div style="padding:12px;display:flex;gap:8px;align-items:center">
        <input type="date" id="sales-from" value="${today()}" style="flex:1;padding:8px;border:1.5px solid var(--c-border);border-radius:var(--radius)">
        <span style="color:var(--c-text-s)">–</span>
        <input type="date" id="sales-to" value="${today()}" style="flex:1;padding:8px;border:1.5px solid var(--c-border);border-radius:var(--radius)">
        <button class="btn btn-primary btn-sm" onclick="StokManager._loadSales()">Filtrele</button>
      </div>
      <div id="sales-list"><div class="loading">Yükleniyor…</div></div>
    `;
    this._loadSales();
  },

  async _loadSales() {
    const from = document.getElementById('sales-from')?.value ?? today();
    const to   = document.getElementById('sales-to')?.value ?? today();
    const el   = document.getElementById('sales-list');
    if (!el) return;

    const res = await API.stok.listSales({ date_from: from, date_to: to });
    if (!res.ok) { el.innerHTML = '<div class="empty">Yüklenemedi</div>'; return; }

    if (!res.data.length) { el.innerHTML = '<div class="empty">Satış yok</div>'; return; }

    el.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>No</th><th>Tarih</th><th>Durum</th><th>Kesin Gelir</th><th>Kutu</th><th></th></tr></thead>
      <tbody>
      ${res.data.map(s => `
        <tr>
          <td style="font-family:monospace;font-size:.8rem">${escHtml(s.sale_no)}</td>
          <td>${fmtDate(s.transaction_date)}</td>
          <td>${statusBadge(s.status)}</td>
          <td>${s.kesin_gelir > 0 ? fmtIQD(s.kesin_gelir) : '—'}</td>
          <td>${fmt(s.total_box)}</td>
          <td><button class="btn btn-sm btn-ghost" onclick="StokManager.openSaleDetail(${s.id})">Detay</button></td>
        </tr>
      `).join('')}
      </tbody></table></div>`;
  },

  async openSaleDetail(saleId) {
    const res = await API.stok.getSale(saleId);
    if (!res.ok) { showToast('Satış yüklenemedi', 'danger'); return; }
    const sale = res.data;

    const linesHtml = sale.lines.map((l, i) => `
      <tr>
        <td>${escHtml(l.coop_name)}</td>
        <td><span class="${catClass(l.category)}">${catLabel(l.category)}</span></td>
        <td>${l.kg !== null ? l.kg : '—'}</td>
        <td>${fmt(l.box_count)}</td>
        <td>${l.price_per_box !== null ? fmtIQD(l.price_per_box) : `
          <div style="display:flex;gap:4px">
            <input type="number" id="price-input-${l.id}" placeholder="0" min="1"
                   style="width:90px;padding:6px;border:1.5px solid var(--c-border);border-radius:var(--radius);font-size:.9rem">
            <button class="btn btn-sm btn-primary" onclick="StokManager.priceLine(${sale.id},${l.id})">Kaydet</button>
          </div>`}
        </td>
        <td>${l.line_total !== null ? fmtIQD(l.line_total) : '—'}</td>
      </tr>
    `).join('');

    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:300;display:flex;align-items:flex-end;padding-bottom:env(safe-area-inset-bottom)';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:16px 16px 0 0;width:100%;max-height:85dvh;overflow-y:auto;padding:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <strong>${escHtml(sale.sale_no)}</strong>
          <div style="display:flex;gap:8px">
            ${sale.status !== 'cancelled' ? `<button class="btn btn-sm" style="background:var(--c-danger-l);color:var(--c-danger);border:none" onclick="StokManager.cancelSale(${sale.id},this)">İptal</button>` : ''}
            <button class="btn btn-sm btn-ghost" onclick="this.closest('[style*=fixed]').remove()">Kapat</button>
          </div>
        </div>
        <p style="font-size:.85rem;color:var(--c-text-s);margin-bottom:12px">
          ${fmtDate(sale.transaction_date)} · ${statusBadge(sale.status)}
        </p>
        <div class="table-wrap"><table>
          <thead><tr><th>Kümes</th><th>Kategori</th><th>Kg</th><th>Kutu</th><th>Fiyat/Kutu</th><th>Toplam</th></tr></thead>
          <tbody>${linesHtml}</tbody>
        </table></div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  },

  async priceLine(saleId, lineId) {
    const input = document.getElementById(`price-input-${lineId}`);
    const price = parseFloat(input?.value);
    if (!price || price <= 0) { showToast('Geçerli bir fiyat girin', 'danger'); return; }

    const res = await API.stok.priceLine(saleId, lineId, price);
    if (res.ok) {
      showToast('Fiyat kaydedildi', 'success');
      document.querySelector('[style*=fixed]')?.remove();
      if (this.activeTab === 'pricing') this.switchTab('pricing');
      else this.switchTab('dashboard');
    } else {
      showToast(res.error ?? 'Hata', 'danger');
    }
  },

  async cancelSale(saleId, btn) {
    const reason = prompt('İptal nedeni:');
    if (!reason) return;
    btn.disabled = true;
    const res = await API.stok.cancelSale(saleId, reason);
    if (res.ok) {
      showToast('Satış iptal edildi', 'success');
      document.querySelector('[style*=fixed]')?.remove();
      this._loadSales();
    } else {
      showToast(res.error ?? 'Hata', 'danger');
      btn.disabled = false;
    }
  },

  // ── Fiyatlama ──
  async renderPricing(el) {
    const res = await API.stok.listSales({ status: 'pending' });
    const res2 = await API.stok.listSales({ status: 'partially_priced' });

    const all = [...(res.ok ? res.data : []), ...(res2.ok ? res2.data : [])];
    if (!all.length) {
      el.innerHTML = '<div class="empty" style="padding-top:32px">Tüm satışlar fiyatlandırılmış</div>';
      return;
    }

    el.innerHTML = `<div class="alert alert-warn" style="margin:12px">
      ⚠️ ${all.length} satışta fiyat eksik
    </div>` + all.map(s => `
      <div class="card" style="margin-top:8px">
        <div class="card-header">
          <span style="font-family:monospace;font-size:.85rem">${escHtml(s.sale_no)}</span>
          <div>${fmtDate(s.transaction_date)} · ${statusBadge(s.status)}</div>
        </div>
        <div style="padding:12px 16px">
          <button class="btn btn-primary" onclick="StokManager.openSaleDetail(${s.id})">
            Fiyat Gir (${s.line_count - s.priced_count} satır eksik)
          </button>
        </div>
      </div>
    `).join('');
  },

  // ── Kapanış ──
  async renderClosing(el) {
    const [weekly, monthly] = await Promise.all([
      API.stok.weeklyStatus(),
      API.stok.monthlyStatus(),
    ]);

    let html = '';

    // Haftalık
    if (weekly.ok) {
      const w = weekly.data;
      html += `<div class="card" style="margin-top:12px">
        <div class="card-header"><h2>Haftalık Kapanış</h2>${statusBadge(w.status)}</div>
        <div class="card-body">
          <p style="font-size:.9rem;color:var(--c-text-s);margin-bottom:12px">
            ${fmtDate(w.week_start)} – ${fmtDate(w.week_end)}
          </p>
          ${w.blockers?.length ? `
            <p style="font-weight:600;margin-bottom:8px">Engeller:</p>
            <ul class="blocker-list">
              ${w.blockers.map(b => `<li>${escHtml(b.message)}</li>`).join('')}
            </ul>
          ` : w.status === 'closed' ? '<div class="alert alert-success">Bu hafta kapalı</div>' : ''}
          ${w.can_close ? `<button class="btn btn-primary" style="margin-top:12px" onclick="StokManager.doCloseWeek()">Haftayı Kapat</button>` : ''}
        </div>
      </div>`;
    }

    // Aylık
    if (monthly.ok) {
      const m = monthly.data;
      html += `<div class="card" style="margin-top:12px">
        <div class="card-header"><h2>${m.year}/${String(m.month).padStart(2,'0')} Aylık Kapanış</h2>${statusBadge(m.status)}</div>
        <div class="card-body">
          ${m.blockers?.length ? `
            <p style="font-weight:600;margin-bottom:8px">Engeller:</p>
            <ul class="blocker-list">
              ${m.blockers.map(b => `<li>${escHtml(b.message)}</li>`).join('')}
            </ul>
          ` : m.status === 'closed' ? '<div class="alert alert-success">Bu ay kapalı</div>' : ''}
          ${m.can_close ? `<button class="btn btn-primary" style="margin-top:12px" onclick="StokManager.doCloseMonth()">Ayı Kapat</button>` : ''}
        </div>
      </div>`;
    }

    el.innerHTML = html + '<div style="height:16px"></div>';
  },

  async doCloseWeek() {
    if (!confirm('Bu haftayı kapatmak istiyor musunuz?')) return;
    const res = await API.stok.closeWeek();
    if (res.ok) { showToast(res.data.message, 'success'); this.switchTab('closing'); }
    else showToast(res.error ?? 'Hata', 'danger');
  },

  async doCloseMonth() {
    if (!confirm('Bu ayı kapatmak istiyor musunuz? Bu işlem geri alınamaz.')) return;
    const res = await API.stok.closeMonth();
    if (res.ok) { showToast(res.data.message, 'success'); this.switchTab('closing'); }
    else showToast(res.error ?? 'Hata', 'danger');
  },

  // ── Raporlar ──
  async renderReports(el) {
    el.innerHTML = `
      <div style="padding:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="StokManager.loadWeeklyReport()">Haftalık Rapor</button>
        <button class="btn btn-ghost btn-sm" onclick="StokManager.loadMonthlyReport()">Aylık Rapor</button>
        <button class="btn btn-ghost btn-sm" onclick="StokManager.loadStockReport()">Stok Raporu</button>
      </div>
      <div id="report-content"><div class="empty">Rapor seçin</div></div>
    `;
  },

  async loadWeeklyReport() {
    const el = document.getElementById('report-content');
    el.innerHTML = '<div class="loading">Yükleniyor…</div>';
    const res = await API.stok.weeklyReport(today());
    if (!res.ok) { el.innerHTML = '<div class="empty">Yüklenemedi</div>'; return; }
    const r = res.data;

    el.innerHTML = `
      <div class="card" style="margin-top:8px">
        <div class="card-header">
          <h2>Haftalık Rapor</h2>
          <span style="font-size:.8rem;color:var(--c-text-s)">${fmtDate(r.week_start)} – ${fmtDate(r.week_end)}</span>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Kategori</th><th>Kg</th><th>Toplam Kutu</th><th>Kesin Gelir</th><th>Bekleyen</th></tr></thead>
          <tbody>
          ${r.sales_by_category.map(s => `
            <tr>
              <td><span class="${catClass(s.category)}">${catLabel(s.category)}</span></td>
              <td>${s.total_kg > 0 ? parseFloat(s.total_kg).toFixed(1) : '—'}</td>
              <td>${fmt(s.toplam_sevk_box)}</td>
              <td>${s.kesin_gelir > 0 ? fmtIQD(s.kesin_gelir) : '—'}</td>
              <td>${s.bekleyen_box > 0 ? s.bekleyen_box + ' kutu' : '—'}</td>
            </tr>
          `).join('')}
          </tbody></table></div>
      </div>`;
  },

  async loadMonthlyReport() {
    const el = document.getElementById('report-content');
    el.innerHTML = '<div class="loading">Yükleniyor…</div>';
    const now = new Date();
    const res = await API.stok.monthlyReport(now.getFullYear(), now.getMonth() + 1);
    if (!res.ok) { el.innerHTML = '<div class="empty">Yüklenemedi</div>'; return; }
    const r = res.data;

    let html = `<div class="card" style="margin-top:8px">
      <div class="card-header"><h2>${r.year}/${String(r.month).padStart(2,'0')} Aylık Rapor</h2></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Kategori</th><th>Kg</th><th>Kutu</th><th>Ort. Fiyat</th><th>Kesin Gelir</th></tr></thead>
        <tbody>
        ${r.sales_by_category.map(s => `
          <tr>
            <td><span class="${catClass(s.category)}">${catLabel(s.category)}</span></td>
            <td>${s.total_kg > 0 ? parseFloat(s.total_kg).toFixed(1) : '—'}</td>
            <td>${fmt(s.toplam_sevk_box)}</td>
            <td>${s.avg_price > 0 ? fmtIQD(s.avg_price) : '—'}</td>
            <td>${s.kesin_gelir > 0 ? fmtIQD(s.kesin_gelir) : '—'}</td>
          </tr>
        `).join('')}
        </tbody></table></div></div>`;

    if (r.unpriced_sales?.length) {
      html += `<div class="alert alert-warn" style="margin:8px 0">
        ⚠️ ${r.unpriced_sales.length} fiyatlanmamış satış satırı
      </div>`;
    }

    el.innerHTML = html;
  },

  async loadStockReport() {
    const el = document.getElementById('report-content');
    el.innerHTML = '<div class="loading">Yükleniyor…</div>';
    const res = await API.stok.stock();
    if (!res.ok) { el.innerHTML = '<div class="empty">Yüklenemedi</div>'; return; }

    el.innerHTML = `<div class="card" style="margin-top:8px">
      <div class="card-header"><h2>Stok Raporu</h2></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Kümes</th><th>Kategori</th><th>Kg</th><th>Kutu</th><th>Son Hareket</th></tr></thead>
        <tbody>
        ${res.data.map(s => `
          <tr>
            <td>${escHtml(s.coop_name)}</td>
            <td><span class="${catClass(s.category)}">${catLabel(s.category)}</span></td>
            <td>${s.total_kg > 0 ? parseFloat(s.total_kg).toFixed(1) : '—'}</td>
            <td>${fmt(s.total_box)}</td>
            <td style="font-size:.8rem;color:var(--c-text-s)">${fmtDate(s.last_movement)}</td>
          </tr>
        `).join('')}
        </tbody></table></div></div>`;
  },
};
