// ============================================================
// EF-Yem — Manager/Director UI
// Sekmeler: Özet | Alımlar | Hammaddeler | Reçeteler | Kapanış
// ============================================================

const YemManager = {
  activeTab: 'dashboard',

  async render(container) {
    container.innerHTML = `
      <div id="yem-mgr">
        <div class="header"><h1>EF-Yem</h1></div>
        <div style="display:flex;background:#fff;border-bottom:1px solid var(--c-border);overflow-x:auto;-webkit-overflow-scrolling:touch">
          ${['dashboard','purchases','materials','recipes','closing'].map(t =>
            `<button class="yem-tab ${t==='dashboard'?'tab-active':''}" data-tab="${t}"
                     onclick="YemManager.switchTab('${t}')"
                     style="padding:12px 14px;border:none;background:none;font-size:.85rem;font-weight:500;white-space:nowrap;cursor:pointer;border-bottom:2px solid ${t==='dashboard'?'var(--c-primary-m)':'transparent'};color:${t==='dashboard'?'var(--c-primary-m)':'var(--c-text-s)'}">
               ${{dashboard:'Özet',purchases:'Alımlar',materials:'Hammaddeler',recipes:'Reçeteler',closing:'Kapanış'}[t]}
             </button>`
          ).join('')}
        </div>
        <div id="yem-tab-content"></div>
      </div>`;
    this.switchTab('dashboard');
  },

  switchTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('.yem-tab').forEach(b => {
      const a = b.dataset.tab === tab;
      b.style.borderBottomColor = a ? 'var(--c-primary-m)' : 'transparent';
      b.style.color              = a ? 'var(--c-primary-m)' : 'var(--c-text-s)';
    });
    const el = document.getElementById('yem-tab-content');
    el.innerHTML = '<div class="loading">Yükleniyor…</div>';
    switch (tab) {
      case 'dashboard':  this._renderDashboard(el);  break;
      case 'purchases':  this._renderPurchases(el);  break;
      case 'materials':  this._renderMaterials(el);  break;
      case 'recipes':    this._renderRecipes(el);    break;
      case 'closing':    this._renderClosing(el);    break;
    }
  },

  // ── Dashboard ──
  async _renderDashboard(el) {
    const res = await API.yem.dashboard();
    if (!res.ok) { el.innerHTML = '<div class="empty">Yüklenemedi</div>'; return; }
    const d = res.data;

    let html = '';

    if (d.critical_count > 0) {
      html += `<div class="alert alert-danger" style="margin:12px">⚠️ ${d.critical_count} hammadde kritik stok altında</div>`;
    }
    if (d.missing_price_count > 0) {
      html += `<div class="alert alert-warn" style="margin:0 12px 0">📋 ${d.missing_price_count} alımda fiyat eksik</div>`;
    }

    // Kümes bazlı üretim + tüketim
    html += `<div class="card" style="margin-top:12px">
      <div class="card-header"><h2>Kümes Durumu — ${fmtDate(d.date)}</h2></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Kümes</th><th>Üretilen</th><th>Tüketim</th></tr></thead>
        <tbody>
        ${d.coop_stats.map(c => `<tr>
          <td>${escHtml(c.coop_name)}</td>
          <td>${c.produced_kg > 0 ? fmt(c.produced_kg) + ' kg' : '—'}</td>
          <td>${c.consumption_kg !== null ? fmt(c.consumption_kg) + ' kg' : '<span style="color:var(--c-text-s);font-size:.8rem">Veri eksik</span>'}</td>
        </tr>`).join('')}
        </tbody></table></div></div>`;

    // Hammadde stoku (kritik önce)
    const critical = d.material_stock.filter(m => m.is_critical);
    const normal   = d.material_stock.filter(m => !m.is_critical && m.current_stock_kg > 0);

    if (critical.length) {
      html += `<div class="card" style="margin-top:12px">
        <div class="card-header"><h2>⚠️ Kritik Stok</h2></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Hammadde</th><th>Mevcut</th><th>Min</th></tr></thead>
          <tbody>
          ${critical.map(m => `<tr>
            <td style="color:var(--c-danger);font-weight:600">${escHtml(m.name)}</td>
            <td style="color:var(--c-danger)">${fmt(m.current_stock_kg)} kg</td>
            <td style="color:var(--c-text-s)">${fmt(m.min_stock_kg)} kg</td>
          </tr>`).join('')}
          </tbody></table></div></div>`;
    }

    if (normal.length) {
      html += `<div class="card" style="margin-top:12px">
        <div class="card-header"><h2>Hammadde Stoku</h2></div>
        <div class="table-wrap"><table>
          <thead><tr><th>Hammadde</th><th>Mevcut</th><th>Min</th></tr></thead>
          <tbody>
          ${normal.map(m => `<tr>
            <td>${escHtml(m.name)}</td>
            <td>${fmt(m.current_stock_kg)} kg</td>
            <td style="color:var(--c-text-s)">${fmt(m.min_stock_kg)} kg</td>
          </tr>`).join('')}
          </tbody></table></div></div>`;
    }

    el.innerHTML = html + '<div style="height:16px"></div>';
  },

  // ── Alımlar ──
  async _renderPurchases(el) {
    el.innerHTML = `
      <div style="margin:12px">
        <button class="btn btn-primary" onclick="YemManager._showPurchaseForm()">+ Yeni Alım</button>
      </div>
      <div id="yem-purchase-form" style="display:none" class="card" style="margin:0 12px 12px">
        <div class="card-header"><h2>Yeni Hammadde Alımı</h2>
          <button class="btn btn-sm btn-ghost" onclick="YemManager._hidePurchaseForm()">Kapat</button></div>
        <div class="card-body" id="yem-purchase-form-body"></div>
      </div>
      <div id="yem-purchases-list"><div class="loading">Yükleniyor…</div></div>
    `;
    this._loadPurchases();
  },

  async _loadPurchases() {
    const el  = document.getElementById('yem-purchases-list');
    if (!el) return;
    const res = await API.yem.listPurchases({});
    if (!res.ok || !res.data.length) { el.innerHTML = '<div class="empty">Alım kaydı yok</div>'; return; }
    el.innerHTML = `<div class="table-wrap" style="margin:0 12px"><table>
      <thead><tr><th>Tarih</th><th>Hammadde</th><th>Miktar</th><th>Birim Fiyat</th><th>Durum</th><th></th></tr></thead>
      <tbody>
      ${res.data.map(p => `<tr>
        <td>${fmtDate(p.transaction_date)}</td>
        <td>${escHtml(p.material_name)}</td>
        <td>${fmt(p.quantity_kg)} kg</td>
        <td>${p.unit_price_iqd ? fmtIQD(p.unit_price_iqd) : '<span style="color:var(--c-warn)">Eksik</span>'}</td>
        <td>${statusBadge(p.status === 'missing_price' ? 'pending' : 'closed')}</td>
        <td>
          ${p.status === 'missing_price' ? `<button class="btn btn-sm btn-primary" onclick="YemManager._enterPurchasePrice(${p.id},this)">Fiyat Gir</button>` : ''}
          <button class="btn btn-sm" style="background:var(--c-danger-l);color:var(--c-danger);border:none;margin-left:4px"
                  onclick="YemManager._cancelPurchase(${p.id})">İptal</button>
        </td>
      </tr>`).join('')}
      </tbody></table></div>`;
  },

  async _showPurchaseForm() {
    const matRes = await API.yem.listMaterials();
    const mats   = matRes.ok ? matRes.data.filter(m => m.is_active) : [];
    document.getElementById('yem-purchase-form').style.display = '';
    document.getElementById('yem-purchase-form-body').innerHTML = `
      <div class="form-group">
        <label>Hammadde</label>
        <select id="p-material">
          <option value="">Seçin…</option>
          ${mats.map(m => `<option value="${m.id}">${escHtml(m.name)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Tarih</label><input type="date" id="p-date" value="${today()}"></div>
      <div class="form-group input-large"><label>Miktar (kg)</label><input type="number" id="p-qty" placeholder="0" step="0.1" min="1"></div>
      <div class="form-group input-large"><label>Birim Fiyat (IQD/kg) <span style="font-weight:400;color:var(--c-text-s)">— zorunlu</span></label>
        <input type="number" id="p-price" placeholder="0" min="0"></div>
      <div class="form-group" style="display:flex;gap:8px;align-items:center">
        <input type="checkbox" id="p-force"> <label for="p-force" style="margin:0;font-size:.9rem">Fiyatı daha sonra gireceğim (istisnai)</label>
      </div>
      <div class="form-group"><label>Not</label><input type="text" id="p-note" placeholder="opsiyonel"></div>
      <button class="btn btn-primary" onclick="YemManager._submitPurchase()">Kaydet</button>
    `;
  },

  _hidePurchaseForm() { document.getElementById('yem-purchase-form').style.display = 'none'; },

  async _submitPurchase() {
    const matId = parseInt(document.getElementById('p-material')?.value ?? '0');
    const date  = document.getElementById('p-date')?.value;
    const qty   = parseFloat(document.getElementById('p-qty')?.value ?? '0');
    const price = parseFloat(document.getElementById('p-price')?.value ?? '0');
    const force = document.getElementById('p-force')?.checked;
    const note  = document.getElementById('p-note')?.value.trim();

    if (!matId || !date || qty <= 0) { showToast('Hammadde, tarih ve miktar zorunludur', 'danger'); return; }
    if (!force && (!price || price <= 0)) { showToast('Fiyat zorunludur. Sonra girmek için onay kutusunu işaretleyin.', 'danger'); return; }

    const res = await API.yem.createPurchase({
      raw_material_id: matId, transaction_date: date, quantity_kg: qty,
      unit_price_iqd: price > 0 ? price : null,
      force_incomplete: force || undefined,
      note: note || undefined,
    });

    if (res.ok) {
      showToast('Alım kaydedildi', 'success');
      this._hidePurchaseForm();
      this._loadPurchases();
    } else {
      showToast(res.error ?? 'Hata', 'danger');
    }
  },

  async _enterPurchasePrice(id, btn) {
    const price = parseFloat(prompt('Birim fiyat (IQD/kg):') ?? '0');
    if (!price || price <= 0) return;
    btn.disabled = true;
    const res = await API.yem.updatePurchasePrice(id, price);
    if (res.ok) { showToast('Fiyat güncellendi', 'success'); this._loadPurchases(); }
    else { showToast(res.error ?? 'Hata', 'danger'); btn.disabled = false; }
  },

  async _cancelPurchase(id) {
    const reason = prompt('İptal nedeni:');
    if (!reason) return;
    const res = await API.yem.cancelPurchase(id, reason);
    if (res.ok) { showToast('Alım iptal edildi', 'success'); this._loadPurchases(); }
    else showToast(res.error ?? 'Hata', 'danger');
  },

  // ── Hammaddeler ──
  async _renderMaterials(el) {
    const res = await API.yem.listMaterials();
    if (!res.ok) { el.innerHTML = '<div class="empty">Yüklenemedi</div>'; return; }

    el.innerHTML = `
      <div style="margin:12px"><button class="btn btn-primary" onclick="YemManager._showMaterialForm()">+ Yeni Hammadde</button></div>
      <div id="mat-form" style="display:none" class="card" style="margin:0 12px 12px">
        <div class="card-header"><h2>Yeni Hammadde</h2>
          <button class="btn btn-sm btn-ghost" onclick="document.getElementById('mat-form').style.display='none'">Kapat</button></div>
        <div class="card-body">
          <div class="form-group"><label>Ad</label><input type="text" id="mat-name" placeholder="…"></div>
          <div class="form-group"><label>Min Stok (kg)</label><input type="number" id="mat-min" value="0" min="0"></div>
          <div class="form-group"><label>Not</label><input type="text" id="mat-note" placeholder="opsiyonel"></div>
          <button class="btn btn-primary" onclick="YemManager._submitMaterial()">Kaydet</button>
        </div>
      </div>
      <div class="table-wrap" style="margin:12px 12px 0"><table>
        <thead><tr><th>Hammadde</th><th>Stok</th><th>Min</th><th>Durum</th></tr></thead>
        <tbody>
        ${res.data.map(m => `<tr>
          <td style="${m.is_critical?'color:var(--c-danger);font-weight:600':''}">${escHtml(m.name)}</td>
          <td style="${m.is_critical?'color:var(--c-danger)':''}">${fmt(m.current_stock_kg)} kg</td>
          <td>${fmt(m.min_stock_kg)} kg</td>
          <td><span class="badge-status ${m.is_active?'badge-closed':'badge-cancelled'}">${m.is_active?'Aktif':'Pasif'}</span></td>
        </tr>`).join('')}
        </tbody></table></div>`;
  },

  _showMaterialForm() { document.getElementById('mat-form').style.display = ''; },

  async _submitMaterial() {
    const name = document.getElementById('mat-name')?.value.trim();
    const min  = parseFloat(document.getElementById('mat-min')?.value ?? '0');
    const note = document.getElementById('mat-note')?.value.trim();
    if (!name) { showToast('Ad zorunludur', 'danger'); return; }
    const res = await API.yem.createMaterial({ name, min_stock_kg: min, note: note || undefined });
    if (res.ok) { showToast('Hammadde oluşturuldu', 'success'); this.switchTab('materials'); }
    else showToast(res.error ?? 'Hata', 'danger');
  },

  // ── Reçeteler ──
  async _renderRecipes(el) {
    const [coopsRes, recipesRes] = await Promise.all([API.coops(), API.yem.listRecipes()]);
    const coops   = coopsRes.ok   ? coopsRes.data   : [];
    const recipes = recipesRes.ok ? recipesRes.data : [];

    // Kümes bazlı grupla
    const byCoopHtml = coops.map(coop => {
      const coopRecs = recipes.filter(r => r.coop_id === coop.id);
      return `<div class="card" style="margin-top:12px">
        <div class="card-header">
          <h2>${escHtml(coop.name)}</h2>
          <button class="btn btn-sm btn-ghost" onclick="YemManager._showRecipeForm(${coop.id})">+ Yeni</button>
        </div>
        ${coopRecs.length ? `<div class="table-wrap"><table>
          <thead><tr><th>Ad</th><th>Versiyon</th><th>Geçerlilik</th><th>Durum</th><th></th></tr></thead>
          <tbody>
          ${coopRecs.map(r => `<tr>
            <td>${escHtml(r.name)}</td>
            <td>v${r.version}</td>
            <td>${fmtDate(r.valid_from)}</td>
            <td><span class="badge-status ${r.is_active?'badge-closed':'badge-cancelled'}">${r.is_active?'Aktif':'Pasif'}</span></td>
            <td>
              ${!r.is_active ? `<button class="btn btn-sm btn-ghost" onclick="YemManager._activateRecipe(${r.id})">Aktive Et</button>` : ''}
              <button class="btn btn-sm btn-ghost" onclick="YemManager._viewRecipe(${r.id})">Detay</button>
            </td>
          </tr>`).join('')}
          </tbody></table></div>`
          : '<div class="empty" style="padding:12px">Reçete yok</div>'}
      </div>`;
    }).join('');

    el.innerHTML = `
      <div id="recipe-form" style="display:none" class="card" style="margin:12px 12px 0">
        <div class="card-header"><h2>Yeni Reçete</h2>
          <button class="btn btn-sm btn-ghost" onclick="document.getElementById('recipe-form').style.display='none'">Kapat</button></div>
        <div class="card-body" id="recipe-form-body"></div>
      </div>
      ${byCoopHtml}
      <div style="height:16px"></div>`;
  },

  async _showRecipeForm(coopId) {
    const matsRes = await API.yem.listMaterials();
    const mats    = matsRes.ok ? matsRes.data.filter(m => m.is_active) : [];
    document.getElementById('recipe-form').style.display = '';
    document.getElementById('recipe-form-body').innerHTML = `
      <input type="hidden" id="rf-coop" value="${coopId}">
      <div class="form-group"><label>Reçete Adı</label><input type="text" id="rf-name" placeholder="Yumurtacı Yemi v1"></div>
      <div class="form-group"><label>Geçerlilik Başlangıcı</label><input type="date" id="rf-date" value="${today()}"></div>
      <div class="form-group"><label>Hammadde Satırları (kg/ton)</label></div>
      <div id="rf-lines">
        ${mats.map(m => `
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
            <span style="flex:1;font-size:.9rem">${escHtml(m.name)}</span>
            <input type="number" data-mat="${m.id}" placeholder="0" step="0.1" min="0"
                   style="width:100px;padding:8px;border:1.5px solid var(--c-border);border-radius:var(--radius)">
            <span style="font-size:.8rem;color:var(--c-text-s)">kg/ton</span>
          </div>`).join('')}
      </div>
      <button class="btn btn-primary" onclick="YemManager._submitRecipe()">Kaydet</button>
    `;
    document.getElementById('recipe-form').scrollIntoView({ behavior: 'smooth' });
  },

  async _submitRecipe() {
    const coopId  = parseInt(document.getElementById('rf-coop')?.value ?? '0');
    const name    = document.getElementById('rf-name')?.value.trim();
    const date    = document.getElementById('rf-date')?.value;
    const inputs  = document.querySelectorAll('#rf-lines input[data-mat]');
    const lines   = Array.from(inputs)
      .map(inp => ({ raw_material_id: parseInt(inp.dataset.mat), kg_per_ton: parseFloat(inp.value) || 0 }))
      .filter(l => l.kg_per_ton > 0);

    if (!name || !date) { showToast('Ad ve tarih zorunludur', 'danger'); return; }
    if (!lines.length)  { showToast('En az bir satır gereklidir', 'danger'); return; }

    const res = await API.yem.createRecipe({ coop_id: coopId, name, valid_from: date, lines });
    if (res.ok) { showToast(`Reçete oluşturuldu (v${res.data.version})`, 'success'); this.switchTab('recipes'); }
    else showToast(res.error ?? 'Hata', 'danger');
  },

  async _activateRecipe(id) {
    if (!confirm('Bu reçeteyi aktive etmek istiyor musunuz? Önceki aktif reçete pasife alınır.')) return;
    const res = await API.yem.activateRecipe(id);
    if (res.ok) { showToast(res.data.message, 'success'); this.switchTab('recipes'); }
    else showToast(res.error ?? 'Hata', 'danger');
  },

  async _viewRecipe(id) {
    const res = await API.yem.getRecipe(id);
    if (!res.ok) { showToast('Yüklenemedi', 'danger'); return; }
    const r = res.data;
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:300;display:flex;align-items:flex-end;padding-bottom:env(safe-area-inset-bottom)';
    modal.innerHTML = `<div style="background:#fff;border-radius:16px 16px 0 0;width:100%;max-height:80dvh;overflow-y:auto;padding:16px">
      <div style="display:flex;justify-content:space-between;margin-bottom:12px">
        <strong>${escHtml(r.name)} v${r.version}</strong>
        <button class="btn btn-sm btn-ghost" onclick="this.closest('[style*=fixed]').remove()">Kapat</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Hammadde</th><th>kg/ton</th></tr></thead>
        <tbody>${r.lines.map(l => `<tr><td>${escHtml(l.material_name)}</td><td>${fmt(l.kg_per_ton)}</td></tr>`).join('')}</tbody>
      </table></div>
      <p style="text-align:right;font-size:.8rem;color:var(--c-text-s);margin-top:8px">
        Toplam: ${fmt(r.lines.reduce((s, l) => s + l.kg_per_ton, 0))} kg/ton
      </p>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  },

  // ── Kapanış ──
  async _renderClosing(el) {
    const res = await API.yem.monthlyClosingStatus();
    if (!res.ok) { el.innerHTML = '<div class="empty">Yüklenemedi</div>'; return; }
    const m = res.data;
    el.innerHTML = `<div class="card" style="margin-top:12px">
      <div class="card-header"><h2>${m.year}/${String(m.month).padStart(2,'0')} Aylık Kapanış</h2>${statusBadge(m.status)}</div>
      <div class="card-body">
        ${m.blockers?.length ? `
          <p style="font-weight:600;margin-bottom:8px">Engeller:</p>
          <ul class="blocker-list">${m.blockers.map(b => `<li>${escHtml(b.message)}</li>`).join('')}</ul>
        ` : m.status === 'closed' ? '<div class="alert alert-success">Bu ay kapalı</div>' : ''}
        ${m.can_close ? `<button class="btn btn-primary" style="margin-top:12px" onclick="YemManager._closeMonth()">Ayı Kapat</button>` : ''}
      </div>
    </div>`;
  },

  async _closeMonth() {
    if (!confirm('EF-Yem ayını kapatmak istiyor musunuz?')) return;
    const res = await API.yem.closeMonth();
    if (res.ok) { showToast(res.data.message, 'success'); this.switchTab('closing'); }
    else showToast(res.error ?? 'Hata', 'danger');
  },
};
