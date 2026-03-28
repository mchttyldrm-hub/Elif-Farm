// ============================================================
// EF-Yem — Employee UI
// Sekmeler: Üretim Girişi | Silo Kapanış
// ============================================================

const YemEmployee = {
  coops: [],
  recipes: [],     // kümes bazlı aktif reçete cache
  activeTab: 'production',
  currentDate: today(),

  async render(container) {
    container.innerHTML = this._shell();
    await this._loadCoops();
    this._bindEvents(container);
    await this.loadTab('production', container);
  },

  _shell() {
    return `
      <div id="yem-emp">
        <div class="header"><h1>EF-Yem</h1><span class="badge">${fmtDate(this.currentDate)}</span></div>

        <div style="display:flex;background:#fff;border-bottom:1px solid var(--c-border)">
          <button class="yem-emp-tab tab-active" data-tab="production"
                  style="flex:1;padding:12px;border:none;background:none;font-weight:600;cursor:pointer;border-bottom:2px solid var(--c-primary-m);color:var(--c-primary-m)"
                  onclick="YemEmployee.loadTab('production',document.getElementById('yem-emp'))">
            Yem Üretimi
          </button>
          <button class="yem-emp-tab" data-tab="silo"
                  style="flex:1;padding:12px;border:none;background:none;font-weight:500;cursor:pointer;border-bottom:2px solid transparent;color:var(--c-text-s)"
                  onclick="YemEmployee.loadTab('silo',document.getElementById('yem-emp'))">
            Silo Kapanış
          </button>
        </div>

        <div id="yem-emp-content"></div>
      </div>`;
  },

  async _loadCoops() {
    const res = await API.coops();
    if (res.ok) this.coops = res.data;
  },

  _bindEvents(_container) {},

  async loadTab(tab, container) {
    this.activeTab = tab;
    container.querySelectorAll('.yem-emp-tab').forEach(b => {
      const active = b.dataset.tab === tab;
      b.style.borderBottomColor = active ? 'var(--c-primary-m)' : 'transparent';
      b.style.color              = active ? 'var(--c-primary-m)' : 'var(--c-text-s)';
      b.style.fontWeight         = active ? '600' : '500';
    });
    const el = document.getElementById('yem-emp-content');
    if (tab === 'production') await this._renderProduction(el);
    if (tab === 'silo')       await this._renderSilo(el);
  },

  // ── Yem Üretimi ──
  async _renderProduction(el) {
    const recipesRes = await API.yem.listRecipes();
    const activeRecipes = {};
    if (recipesRes.ok) {
      recipesRes.data.filter(r => r.is_active).forEach(r => {
        activeRecipes[r.coop_id] = r;
      });
    }

    el.innerHTML = `
      <div class="card" style="margin-top:12px">
        <div class="card-header"><h2>Yem Üretim Girişi</h2></div>
        <div class="card-body">
          <div class="form-group">
            <label>Kümes</label>
            <select id="yem-prod-coop" onchange="YemEmployee._onCoopChange(this.value)">
              <option value="">Seçin…</option>
              ${this.coops.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('')}
            </select>
          </div>

          <div id="yem-active-recipe" style="display:none" class="alert alert-info" style="margin-bottom:12px">
            Aktif reçete: <strong id="yem-recipe-name"></strong>
          </div>
          <div id="yem-no-recipe" style="display:none" class="alert alert-warn">
            Bu kümes için aktif reçete yok. Yönetici ile iletişime geçin.
          </div>

          <div class="form-group input-large">
            <label>Üretilen Miktar (kg)</label>
            <input type="number" id="yem-prod-qty" placeholder="0" step="0.1" min="1">
          </div>

          <button class="btn btn-primary" id="yem-prod-submit" disabled onclick="YemEmployee.submitProduction()">
            Kaydet
          </button>
        </div>
      </div>

      <div class="card" style="margin-top:12px">
        <div class="card-header"><h2>Bugün Üretim</h2></div>
        <div id="yem-today-prod"><div class="loading">Yükleniyor…</div></div>
      </div>
    `;

    // Reçete cache'i sakla
    this._activeRecipes = activeRecipes;

    // Bugün üretim listesi
    this._loadTodayProductions();

    document.getElementById('yem-prod-qty')?.addEventListener('input', () => {
      const qty    = parseFloat(document.getElementById('yem-prod-qty')?.value ?? '0');
      const coopId = document.getElementById('yem-prod-coop')?.value;
      const hasRec = coopId && this._activeRecipes?.[coopId];
      document.getElementById('yem-prod-submit').disabled = !(qty > 0 && hasRec);
    });
  },

  _onCoopChange(coopId) {
    const rec = this._activeRecipes?.[coopId];
    const activeDiv  = document.getElementById('yem-active-recipe');
    const noRecDiv   = document.getElementById('yem-no-recipe');
    const submitBtn  = document.getElementById('yem-prod-submit');

    if (rec) {
      activeDiv.style.display = '';
      noRecDiv.style.display  = 'none';
      document.getElementById('yem-recipe-name').textContent = `${rec.name} v${rec.version}`;
    } else {
      activeDiv.style.display = 'none';
      noRecDiv.style.display  = coopId ? '' : 'none';
      if (submitBtn) submitBtn.disabled = true;
    }
  },

  async submitProduction() {
    const coopId = document.getElementById('yem-prod-coop')?.value;
    const qty    = parseFloat(document.getElementById('yem-prod-qty')?.value ?? '0');
    if (!coopId || qty <= 0) return;

    const btn = document.getElementById('yem-prod-submit');
    btn.disabled = true; btn.textContent = 'Kaydediliyor…';

    const res = await API.yem.createProduction({ coop_id: parseInt(coopId), production_date: this.currentDate, quantity_kg: qty });
    if (res.ok) {
      showToast(`Üretim kaydedildi — Maliyet: ${fmtIQD(res.data.total_cost_iqd)}`, 'success');
      document.getElementById('yem-prod-qty').value = '';
      document.getElementById('yem-prod-coop').value = '';
      document.getElementById('yem-active-recipe').style.display = 'none';
      this._loadTodayProductions();
    } else {
      showToast(res.error ?? 'Hata', 'danger');
    }
    btn.disabled = false; btn.textContent = 'Kaydet';
  },

  async _loadTodayProductions() {
    const el  = document.getElementById('yem-today-prod');
    if (!el) return;
    const res = await API.yem.listProductions({ date_from: this.currentDate, date_to: this.currentDate });
    if (!res.ok) { el.innerHTML = '<div class="empty">Yüklenemedi</div>'; return; }
    const items = res.data.filter(p => !p.is_reversed);
    if (!items.length) { el.innerHTML = '<div class="empty">Bugün giriş yok</div>'; return; }
    el.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Kümes</th><th>Reçete</th><th>Miktar</th><th>Maliyet</th></tr></thead>
      <tbody>
      ${items.map(p => `<tr>
        <td>${escHtml(p.coop_name)}</td>
        <td style="font-size:.8rem">${escHtml(p.recipe_name)} v${p.snapshot_recipe_version}</td>
        <td>${fmt(p.quantity_kg)} kg</td>
        <td>${fmtIQD(p.total_cost_iqd)}</td>
      </tr>`).join('')}
      </tbody></table></div>`;
  },

  // ── Silo Kapanış ──
  async _renderSilo(el) {
    el.innerHTML = `
      <div class="card" style="margin-top:12px">
        <div class="card-header"><h2>Silo Kapanış Girişi</h2></div>
        <div class="card-body">
          <div class="form-group">
            <label>Kümes</label>
            <select id="silo-coop">
              <option value="">Seçin…</option>
              ${this.coops.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group input-large">
            <label>Kapanış Stoku (kg)</label>
            <input type="number" id="silo-closing-kg" placeholder="0" step="0.1" min="0">
          </div>
          <div class="form-group">
            <label>Not <span style="color:var(--c-text-s);font-weight:400">(opsiyonel)</span></label>
            <input type="text" id="silo-note" placeholder="…">
          </div>
          <button class="btn btn-primary" onclick="YemEmployee.submitSiloClosing()">Kaydet</button>
        </div>
      </div>

      <div id="silo-result" style="display:none"></div>

      <div class="card" style="margin-top:12px">
        <div class="card-header"><h2>Son Kapanışlar</h2></div>
        <div id="silo-list"><div class="loading">Yükleniyor…</div></div>
      </div>
    `;
    this._loadSiloList();
  },

  async submitSiloClosing() {
    const coopId    = document.getElementById('silo-coop')?.value;
    const closingKg = parseFloat(document.getElementById('silo-closing-kg')?.value ?? '');
    const note      = document.getElementById('silo-note')?.value.trim();
    if (!coopId) { showToast('Kümes seçin', 'danger'); return; }
    if (isNaN(closingKg) || closingKg < 0) { showToast('Geçerli bir kg değeri girin', 'danger'); return; }

    const res = await API.yem.upsertSiloClosing({ coop_id: parseInt(coopId), closing_date: this.currentDate, closing_kg: closingKg, note: note || undefined });
    if (res.ok) {
      showToast('Silo kapanışı kaydedildi', 'success');
      const resultDiv = document.getElementById('silo-result');
      if (res.data.consumption_kg !== null) {
        resultDiv.style.display = '';
        resultDiv.innerHTML = `<div class="alert alert-info" style="margin:8px 12px 0">
          Günlük tüketim: <strong>${res.data.consumption_kg.toFixed(0)} kg</strong>
        </div>`;
      } else {
        // Kural 7: tahmin yok, uyarı göster
        resultDiv.style.display = '';
        resultDiv.innerHTML = `<div class="alert alert-warn" style="margin:8px 12px 0">
          Dünkü silo kapanışı girilmemiş — tüketim hesaplanamadı
        </div>`;
      }
      this._loadSiloList();
    } else {
      showToast(res.error ?? 'Hata', 'danger');
    }
  },

  async _loadSiloList() {
    const el  = document.getElementById('silo-list');
    if (!el) return;
    const res = await API.yem.listSiloClosings();
    if (!res.ok || !res.data.length) { el.innerHTML = '<div class="empty">Kayıt yok</div>'; return; }
    el.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Tarih</th><th>Kümes</th><th>Kapanış (kg)</th></tr></thead>
      <tbody>
      ${res.data.map(s => `<tr>
        <td>${fmtDate(s.closing_date)}</td>
        <td>${escHtml(s.coop_name)}</td>
        <td>${fmt(s.closing_kg)}</td>
      </tr>`).join('')}
      </tbody></table></div>`;
  },
};
