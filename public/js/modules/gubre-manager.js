// ============================================================
// EF-Gübre — Manager UI
// Sekmeler: Girişler | Aylık Rapor | Kapanış
// ============================================================

const GubreManager = {
  activeTab: 'entries',
  currentDate: today(),

  async render(container) {
    container.innerHTML = this._shell();
    this._bindTab(container);
    await this.loadTab('entries', container);
  },

  _shell() {
    const tabs = [
      { key: 'entries', label: 'Girişler' },
      { key: 'report',  label: 'Aylık Rapor' },
      { key: 'closing', label: 'Kapanış' },
    ];
    return `
      <div id="gubre-mgr">
        <div class="header"><h1>EF-Gübre</h1><span class="badge">${fmtDate(this.currentDate)}</span></div>

        <div style="display:flex;background:#fff;border-bottom:1px solid var(--c-border);overflow-x:auto">
          ${tabs.map((t, i) => `
          <button class="gubre-tab${i === 0 ? ' tab-active' : ''}" data-tab="${t.key}"
                  style="flex:1;min-width:80px;padding:12px 8px;border:none;background:none;
                         font-weight:${i === 0 ? '600' : '500'};cursor:pointer;white-space:nowrap;
                         border-bottom:2px solid ${i === 0 ? 'var(--c-primary-m)' : 'transparent'};
                         color:${i === 0 ? 'var(--c-primary-m)' : 'var(--c-text-s)'}"
                  onclick="GubreManager.loadTab('${t.key}',document.getElementById('gubre-mgr'))">
            ${t.label}
          </button>`).join('')}
        </div>

        <div id="gubre-mgr-content"></div>
      </div>`;
  },

  _bindTab(_container) {},

  async loadTab(tab, container) {
    this.activeTab = tab;
    container.querySelectorAll('.gubre-tab').forEach(b => {
      const active = b.dataset.tab === tab;
      b.style.borderBottomColor = active ? 'var(--c-primary-m)' : 'transparent';
      b.style.color              = active ? 'var(--c-primary-m)' : 'var(--c-text-s)';
      b.style.fontWeight         = active ? '600' : '500';
    });
    const el = document.getElementById('gubre-mgr-content');
    if (tab === 'entries') await this._renderEntries(el);
    if (tab === 'report')  await this._renderReport(el);
    if (tab === 'closing') await this._renderClosing(el);
  },

  // ── Girişler ──
  async _renderEntries(el) {
    const [y, m] = this.currentDate.split('-');
    el.innerHTML = `
      <div class="card" style="margin-top:12px">
        <div class="card-header">
          <h2>Bu Ay Girişler</h2>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="month" id="gubre-filter-month" value="${y}-${m}"
                   onchange="GubreManager._reloadEntries()" style="font-size:.85rem;padding:4px 8px">
          </div>
        </div>
        <div id="gubre-entries-list"><div class="loading">Yükleniyor…</div></div>
      </div>`;
    await this._reloadEntries();
  },

  async _reloadEntries() {
    const el = document.getElementById('gubre-entries-list');
    if (!el) return;

    const monthVal = document.getElementById('gubre-filter-month')?.value ?? this.currentDate.slice(0, 7);
    const [y, m] = monthVal.split('-');

    const res = await API.gubre.listEntries({ year: y, month: m });
    if (!res.ok) { el.innerHTML = '<div class="empty">Yüklenemedi</div>'; return; }

    const items = res.data.filter(e => !e.is_deleted);
    if (!items.length) { el.innerHTML = '<div class="empty">Bu ay giriş yok</div>'; return; }

    const totalVehicles = items.reduce((s, e) => s + e.vehicle_count, 0);

    el.innerHTML = `
      <div style="padding:12px 16px;background:var(--c-bg-s);border-bottom:1px solid var(--c-border);font-size:.85rem">
        <strong>${items.length}</strong> giriş &nbsp;|&nbsp; Toplam: <strong>${fmt(totalVehicles)}</strong> araç
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Tarih</th><th>Kümes</th><th>Araç</th><th>Not</th><th></th></tr></thead>
        <tbody>
        ${items.map(e => `<tr>
          <td>${fmtDate(e.entry_date)}</td>
          <td>${escHtml(e.coop_name)}</td>
          <td style="font-weight:600">${e.vehicle_count}</td>
          <td style="font-size:.8rem;color:var(--c-text-s)">${escHtml(e.note ?? '—')}</td>
          <td>
            <button class="btn btn-sm btn-danger"
                    onclick="GubreManager._deleteEntry(${e.id})"
                    style="font-size:.75rem;padding:2px 8px">Sil</button>
          </td>
        </tr>`).join('')}
        </tbody></table></div>`;
  },

  async _deleteEntry(id) {
    const reason = prompt('Silme nedeni:');
    if (!reason?.trim()) return;

    const res = await API.gubre.deleteEntry(id, reason.trim());
    if (res.ok) {
      showToast('Kayıt silindi', 'success');
      await this._reloadEntries();
    } else {
      showToast(res.error ?? 'Hata', 'danger');
    }
  },

  // ── Aylık Rapor ──
  async _renderReport(el) {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;

    el.innerHTML = `
      <div class="card" style="margin-top:12px">
        <div class="card-header">
          <h2>Aylık Rapor</h2>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="month" id="gubre-report-month"
                   value="${y}-${String(m).padStart(2,'0')}"
                   onchange="GubreManager._reloadReport()"
                   style="font-size:.85rem;padding:4px 8px">
          </div>
        </div>
        <div id="gubre-report-body"><div class="loading">Yükleniyor…</div></div>
      </div>`;
    await this._reloadReport();
  },

  async _reloadReport() {
    const el = document.getElementById('gubre-report-body');
    if (!el) return;

    const monthVal = document.getElementById('gubre-report-month')?.value ?? this.currentDate.slice(0, 7);
    const [y, m] = monthVal.split('-').map(Number);

    const res = await API.gubre.monthlyReport(y, m);
    if (!res.ok) { el.innerHTML = '<div class="empty">Yüklenemedi</div>'; return; }

    const d = res.data;

    let html = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px">
        <div class="stat-card" style="padding:16px;background:var(--c-bg-s);border-radius:8px;text-align:center">
          <div style="font-size:2rem;font-weight:700;color:var(--c-primary-m)">${fmt(d.total_vehicles)}</div>
          <div style="font-size:.8rem;color:var(--c-text-s);margin-top:4px">Toplam Araç</div>
        </div>
        <div class="stat-card" style="padding:16px;background:var(--c-bg-s);border-radius:8px;text-align:center">
          <div style="font-size:2rem;font-weight:700;color:var(--c-primary-m)">${fmt(d.total_entries)}</div>
          <div style="font-size:.8rem;color:var(--c-text-s);margin-top:4px">Giriş Sayısı</div>
        </div>
      </div>`;

    if (d.by_coop?.length) {
      html += `
        <div style="padding:0 12px 12px">
          <h3 style="font-size:.9rem;margin-bottom:8px">Kümes Bazlı</h3>
          <div class="table-wrap"><table>
            <thead><tr><th>Kümes</th><th>Giriş</th><th>Araç</th></tr></thead>
            <tbody>
            ${d.by_coop.map(r => `<tr>
              <td>${escHtml(r.coop_name)}</td>
              <td>${r.entry_count}</td>
              <td style="font-weight:600">${fmt(r.total_vehicles)}</td>
            </tr>`).join('')}
            </tbody></table></div>
        </div>`;
    }

    if (d.by_day?.length) {
      html += `
        <div style="padding:0 12px 12px">
          <h3 style="font-size:.9rem;margin-bottom:8px">Gün Bazlı</h3>
          <div class="table-wrap"><table>
            <thead><tr><th>Tarih</th><th>Araç</th></tr></thead>
            <tbody>
            ${d.by_day.map(r => `<tr>
              <td>${fmtDate(r.entry_date)}</td>
              <td style="font-weight:600">${fmt(r.total_vehicles)}</td>
            </tr>`).join('')}
            </tbody></table></div>
        </div>`;
    }

    el.innerHTML = html;
  },

  // ── Kapanış ──
  async _renderClosing(el) {
    el.innerHTML = `<div id="gubre-closing-body"><div class="loading">Yükleniyor…</div></div>`;
    await this._reloadClosing();
  },

  async _reloadClosing() {
    const el = document.getElementById('gubre-closing-body');
    if (!el) return;

    const res = await API.gubre.monthlyClosingStatus(this.currentDate);
    if (!res.ok) { el.innerHTML = '<div class="empty">Yüklenemedi</div>'; return; }

    const d = res.data;
    const isClosed = d.status === 'closed';

    el.innerHTML = `
      <div class="card" style="margin-top:12px">
        <div class="card-header"><h2>Aylık Kapanış</h2></div>
        <div class="card-body">
          <div style="margin-bottom:16px">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px">
              <span style="color:var(--c-text-s)">Durum</span>
              <strong>${isClosed
                ? '<span style="color:var(--c-success,#2e7d32)">Kapalı ✓</span>'
                : '<span style="color:var(--c-warning,#e65100)">Açık</span>'}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:8px">
              <span style="color:var(--c-text-s)">Toplam Araç</span>
              <strong>${fmt(d.total_vehicles)}</strong>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:8px">
              <span style="color:var(--c-text-s)">Giriş Sayısı</span>
              <strong>${fmt(d.total_entries)}</strong>
            </div>
            <div style="display:flex;justify-content:space-between">
              <span style="color:var(--c-text-s)">Aktif Kümes</span>
              <strong>${fmt(d.active_coops)}</strong>
            </div>
          </div>

          ${isClosed
            ? `<div class="alert alert-info">Bu ay ${fmtDate(d.closed_at?.slice(0,10) ?? '')} tarihinde kapatılmış.</div>`
            : `<button class="btn btn-primary" onclick="GubreManager._closeMonth()">Ayı Kapat</button>`}
        </div>
      </div>`;
  },

  async _closeMonth() {
    if (!confirm('Bu ayın gübre kayıtları kapatılsın mı? Bu işlem geri alınamaz.')) return;

    const res = await API.gubre.closeMonth(this.currentDate);
    if (res.ok) {
      showToast(res.data.message ?? 'Ay kapatıldı', 'success');
      await this._reloadClosing();
    } else {
      showToast(res.error ?? 'Hata', 'danger');
    }
  },
};
