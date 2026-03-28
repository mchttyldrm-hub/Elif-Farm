// ============================================================
// Bildirimler + Bildirim Tercihleri sayfası
// ============================================================

const NotifLabels = {
  day_end_production_summary:  'Günlük Üretim Özeti',
  missing_price_sale:          'Fiyatsız Satış Uyarısı',
  weekly_closing_blocker:      'Haftalık Kapanış Uyarısı',
  critical_stock_warning:      'Kritik Stok Uyarısı',
  missing_price_purchase:      'Fiyatsız Alım Uyarısı',
  monthly_closing_blocker:     'Aylık Kapanış Uyarısı',
  manure_day_end_summary:      'Günlük Gübre Özeti',
  monthly_table_ready_gubre:   'Gübre Aylık Raporu Hazır',
  silo_consumption_calculated: 'Silo Tüketimi Hesaplandı',
};

const ChannelLabels = { push: 'Push', in_app: 'Uygulama İçi', disabled: 'Kapalı' };

const NotifPage = {
  async render(container, currentUser) {
    container.innerHTML = `
      <div class="header"><h1>Bildirimler</h1></div>
      <div style="display:flex;background:#fff;border-bottom:1px solid var(--c-border)">
        <button class="notif-tab tab-active" data-tab="list"
                style="flex:1;padding:12px 8px;border:none;background:none;font-weight:600;cursor:pointer;
                       border-bottom:2px solid var(--c-primary-m);color:var(--c-primary-m)"
                onclick="NotifPage._switchTab('list',this.closest('.header').parentElement ?? document.getElementById('module-content'))">
          Gelen Kutusu
        </button>
        ${currentUser?.role !== 'employee' ? `
        <button class="notif-tab" data-tab="prefs"
                style="flex:1;padding:12px 8px;border:none;background:none;font-weight:500;cursor:pointer;
                       border-bottom:2px solid transparent;color:var(--c-text-s)"
                onclick="NotifPage._switchTab('prefs',this.closest('.header').parentElement ?? document.getElementById('module-content'))">
          Tercihler
        </button>` : ''}
      </div>
      <div id="notif-tab-body"></div>`;

    await this._loadList();
  },

  _switchTab(tab, _container) {
    document.querySelectorAll('.notif-tab').forEach(b => {
      const active = b.dataset.tab === tab;
      b.style.borderBottomColor = active ? 'var(--c-primary-m)' : 'transparent';
      b.style.color              = active ? 'var(--c-primary-m)' : 'var(--c-text-s)';
      b.style.fontWeight         = active ? '600' : '500';
    });
    if (tab === 'list')  this._loadList();
    if (tab === 'prefs') this._loadPrefs();
  },

  async _loadList() {
    const el = document.getElementById('notif-tab-body');
    if (!el) return;
    el.innerHTML = '<div class="loading">Yükleniyor…</div>';

    const res = await API.notifications();
    if (!res.ok) { el.innerHTML = '<div class="empty">Yüklenemedi</div>'; return; }
    const items = res.data;
    if (!items.length) { el.innerHTML = '<div class="empty">Bildirim yok</div>'; return; }

    el.innerHTML = '<div class="card" style="margin-top:12px"><div class="card-body" style="padding:0">' +
      items.map(n => `
        <div style="padding:12px 16px;border-bottom:1px solid var(--c-border);${n.is_read ? 'opacity:.55' : ''}">
          ${!n.is_read ? '<span style="display:inline-block;width:8px;height:8px;background:var(--c-danger,#c62828);border-radius:50%;margin-right:6px;vertical-align:middle"></span>' : ''}
          <span style="font-weight:600;font-size:.9rem">${escHtml(n.title)}</span>
          <div style="font-size:.85rem;color:var(--c-text-s);margin-top:2px">${escHtml(n.body)}</div>
          <div style="font-size:.75rem;color:var(--c-disabled);margin-top:4px">${fmtDate(n.created_at?.slice(0,10) ?? '')}</div>
        </div>`).join('') +
      '</div></div>';

    // Tüm okunmamışları okundu olarak işaretle
    items.filter(n => !n.is_read).forEach(n => API.markRead(n.id).catch(() => {}));
  },

  async _loadPrefs() {
    const el = document.getElementById('notif-tab-body');
    if (!el) return;
    el.innerHTML = '<div class="loading">Yükleniyor…</div>';

    const res = await API.getNotifPrefs();
    if (!res.ok) { el.innerHTML = '<div class="empty">Yüklenemedi</div>'; return; }

    const prefMap = {};
    res.data.forEach(p => { prefMap[p.notification_type] = p.channel; });

    const types = Object.keys(NotifLabels);

    el.innerHTML = `
      <div class="card" style="margin-top:12px">
        <div class="card-header"><h2>Bildirim Tercihleri</h2></div>
        <div class="card-body" style="padding:0">
          ${types.map(t => `
          <div style="display:flex;align-items:center;justify-content:space-between;
                      padding:12px 16px;border-bottom:1px solid var(--c-border)">
            <span style="font-size:.9rem">${NotifLabels[t]}</span>
            <select data-type="${t}" onchange="NotifPage._savePref('${t}',this.value)"
                    style="font-size:.85rem;padding:4px 8px;border:1px solid var(--c-border);border-radius:6px">
              ${Object.entries(ChannelLabels).map(([k, v]) =>
                `<option value="${k}"${(prefMap[t] ?? 'push') === k ? ' selected' : ''}>${v}</option>`
              ).join('')}
            </select>
          </div>`).join('')}
        </div>
      </div>`;
  },

  async _savePref(type, channel) {
    const res = await API.setNotifPref(type, channel);
    if (res.ok) showToast('Tercih kaydedildi', 'success');
    else showToast(res.error ?? 'Hata', 'danger');
  },
};
