// ============================================================
// EF-Stok — Employee UI
// Öncelik: hızlı üretim girişi, bugünkü liste
// ============================================================

const StokEmployee = {
  coops: [],
  selectedCoop: null,
  selectedCategory: null,
  currentDate: today(),

  async render(container) {
    container.innerHTML = this._shell();
    await this._loadCoops();
    this._bindEvents(container);
    await this._loadTodayProductions();
  },

  _shell() {
    return `
      <div id="stok-emp">
        <!-- iOS Banner (app.js yönetir) -->
        <div class="header">
          <h1>EF-Stok</h1>
          <span class="badge" id="emp-date">${fmtDate(this.currentDate)}</span>
        </div>

        <!-- Hızlı Giriş Kartı -->
        <div class="card" style="margin-top:12px">
          <div class="card-header">
            <h2>Üretim Girişi</h2>
          </div>
          <div class="card-body">
            <!-- Kümes seçimi -->
            <div class="form-group">
              <label>Kümes</label>
              <select id="emp-coop">
                <option value="">Kümes seçin…</option>
              </select>
            </div>

            <!-- Kategori tile'ları -->
            <div class="form-group">
              <label>Kategori</label>
              <div class="category-grid" id="emp-cat-grid">
                <div class="cat-tile" data-cat="normal">Normal<br><small style="font-weight:400;font-size:.75rem">20–30 kg</small></div>
                <div class="cat-tile" data-cat="kirli">Kirli<br><small style="font-weight:400;font-size:.75rem">22–27 kg</small></div>
                <div class="cat-tile" data-cat="kirik">Kırık<br><small style="font-weight:400;font-size:.75rem">Sadece kutu</small></div>
                <div class="cat-tile" data-cat="kucuk">Küçük<br><small style="font-weight:400;font-size:.75rem">Sadece kutu</small></div>
              </div>
            </div>

            <!-- Kg alanı (normal/kirli için görünür) -->
            <div class="form-group input-large" id="emp-kg-group" style="display:none">
              <label>Ağırlık (kg) <span id="emp-kg-hint" style="color:var(--c-text-s);font-weight:400"></span></label>
              <input type="number" id="emp-kg" placeholder="0.0" step="0.1" min="0">
            </div>

            <!-- Kutu adedi -->
            <div class="form-group input-large">
              <label>Kutu Adedi</label>
              <input type="number" id="emp-box" placeholder="0" step="1" min="1">
            </div>

            <!-- Not (opsiyonel) -->
            <div class="form-group">
              <label>Not <span style="color:var(--c-text-s);font-weight:400">(opsiyonel)</span></label>
              <input type="text" id="emp-note" placeholder="…">
            </div>

            <button class="btn btn-primary" id="emp-submit-btn" disabled>
              Kaydet
            </button>
          </div>
        </div>

        <!-- Satış Aç Butonu -->
        <div style="margin:12px 12px 0">
          <button class="btn btn-ghost" onclick="StokEmployee.showSaleForm()" style="width:100%">
            + Yeni Satış
          </button>
        </div>

        <!-- Satış Formu (collapse) -->
        <div class="card" id="emp-sale-form" style="display:none">
          <div class="card-header">
            <h2>Satış Aç</h2>
            <button class="btn btn-sm btn-ghost" onclick="StokEmployee.hideSaleForm()">Kapat</button>
          </div>
          <div class="card-body">
            <div id="emp-sale-lines"></div>
            <button class="btn btn-ghost btn-sm" onclick="StokEmployee.addSaleLine()" style="width:100%;margin-bottom:12px">
              + Satır Ekle
            </button>
            <button class="btn btn-primary" onclick="StokEmployee.submitSale()">
              Satış Oluştur
            </button>
          </div>
        </div>

        <!-- Bugünkü Üretim Listesi -->
        <div class="card" style="margin-top:12px">
          <div class="card-header">
            <h2>Bugünkü Girişler</h2>
            <span id="emp-prod-count" style="color:var(--c-text-s);font-size:.85rem"></span>
          </div>
          <div id="emp-prod-list"><div class="loading">Yükleniyor…</div></div>
        </div>

        <!-- Stok Özeti -->
        <div class="card" style="margin-top:12px;margin-bottom:4px">
          <div class="card-header"><h2>Mevcut Stok</h2></div>
          <div id="emp-stock-list"><div class="loading">Yükleniyor…</div></div>
        </div>
      </div>
    `;
  },

  async _loadCoops() {
    const res = await API.coops();
    if (!res.ok) return;
    this.coops = res.data;
    const sel = document.getElementById('emp-coop');
    if (!sel) return;
    this.coops.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      sel.appendChild(opt);
    });
    if (this.coops.length === 1) {
      sel.value = this.coops[0].id;
      this.selectedCoop = this.coops[0].id;
    }
  },

  _bindEvents(container) {
    // Kümes değişimi
    container.querySelector('#emp-coop')?.addEventListener('change', e => {
      this.selectedCoop = e.target.value;
      this._checkSubmit();
    });

    // Kategori tile seçimi
    container.querySelectorAll('.cat-tile').forEach(tile => {
      tile.addEventListener('click', () => {
        container.querySelectorAll('.cat-tile').forEach(t => {
          t.className = 'cat-tile';
        });
        const cat = tile.dataset.cat;
        tile.classList.add(`selected-${cat}`);
        this.selectedCategory = cat;
        this._toggleKgField(cat);
        this._checkSubmit();
      });
    });

    // Input değişimlerinde submit kontrolü
    container.querySelector('#emp-box')?.addEventListener('input', () => this._checkSubmit());
    container.querySelector('#emp-kg')?.addEventListener('input',  () => this._checkSubmit());

    // Submit
    container.querySelector('#emp-submit-btn')?.addEventListener('click', () => this.submitProduction());
  },

  _toggleKgField(cat) {
    const group = document.getElementById('emp-kg-group');
    const hint  = document.getElementById('emp-kg-hint');
    if (['normal', 'kirli'].includes(cat)) {
      group.style.display = '';
      hint.textContent = cat === 'normal' ? '(20–30 arası)' : '(22–27 arası)';
      document.getElementById('emp-kg').required = true;
    } else {
      group.style.display = 'none';
      document.getElementById('emp-kg').value = '';
      document.getElementById('emp-kg').required = false;
    }
  },

  _checkSubmit() {
    const coopOk = !!this.selectedCoop;
    const catOk  = !!this.selectedCategory;
    const boxOk  = parseInt(document.getElementById('emp-box')?.value) > 0;
    const kgOk   = !['normal','kirli'].includes(this.selectedCategory)
                   || parseFloat(document.getElementById('emp-kg')?.value) > 0;
    const btn = document.getElementById('emp-submit-btn');
    if (btn) btn.disabled = !(coopOk && catOk && boxOk && kgOk);
  },

  async submitProduction() {
    const btn = document.getElementById('emp-submit-btn');
    btn.disabled = true;
    btn.textContent = 'Kaydediliyor…';

    const kg       = ['normal','kirli'].includes(this.selectedCategory)
                     ? parseFloat(document.getElementById('emp-kg').value)
                     : null;
    const box      = parseInt(document.getElementById('emp-box').value);
    const note     = document.getElementById('emp-note').value.trim();

    try {
      const res = await API.stok.createProduction({
        coop_id: parseInt(this.selectedCoop),
        production_date: this.currentDate,
        category: this.selectedCategory,
        kg,
        box_count: box,
        note: note || undefined,
      });

      if (res.ok) {
        showToast('Üretim kaydedildi', 'success');
        // Formu sıfırla
        document.getElementById('emp-box').value  = '';
        document.getElementById('emp-kg').value   = '';
        document.getElementById('emp-note').value = '';
        document.querySelectorAll('.cat-tile').forEach(t => t.className = 'cat-tile');
        document.getElementById('emp-kg-group').style.display = 'none';
        this.selectedCategory = null;
        btn.disabled = true;
        await this._loadTodayProductions();
      } else {
        showToast(res.error ?? 'Kayıt başarısız', 'danger');
      }
    } catch {
      showToast('Sunucu hatası', 'danger');
    } finally {
      btn.textContent = 'Kaydet';
    }
  },

  async _loadTodayProductions() {
    const [prodRes, stockRes] = await Promise.all([
      API.stok.listProductions(this.currentDate),
      API.stok.stock(),
    ]);

    // Üretim listesi
    const list  = document.getElementById('emp-prod-list');
    const count = document.getElementById('emp-prod-count');
    if (prodRes.ok) {
      const items = prodRes.data.filter(p => !p.is_reversed);
      count.textContent = `${items.length} kayıt`;
      if (!items.length) {
        list.innerHTML = '<div class="empty">Bugün henüz giriş yok</div>';
      } else {
        list.innerHTML = `<div class="table-wrap"><table>
          <thead><tr><th>Kümes</th><th>Kategori</th><th>Kg</th><th>Kutu</th></tr></thead>
          <tbody>
          ${items.map(p => `
            <tr>
              <td>${escHtml(p.coop_name)}</td>
              <td><span class="${catClass(p.category)}">${catLabel(p.category)}</span></td>
              <td>${p.kg !== null ? p.kg : '—'}</td>
              <td>${fmt(p.box_count)}</td>
            </tr>
          `).join('')}
          </tbody></table></div>`;
      }
    }

    // Stok özeti
    const slist = document.getElementById('emp-stock-list');
    if (stockRes.ok) {
      const items = stockRes.data.filter(s => s.total_box > 0);
      if (!items.length) {
        slist.innerHTML = '<div class="empty">Stok yok</div>';
      } else {
        slist.innerHTML = `<div class="table-wrap"><table>
          <thead><tr><th>Kümes</th><th>Kategori</th><th>Kg</th><th>Kutu</th></tr></thead>
          <tbody>
          ${items.map(s => `
            <tr>
              <td>${escHtml(s.coop_name)}</td>
              <td><span class="${catClass(s.category)}">${catLabel(s.category)}</span></td>
              <td>${s.total_kg > 0 ? s.total_kg.toFixed(1) : '—'}</td>
              <td>${fmt(s.total_box)}</td>
            </tr>
          `).join('')}
          </tbody></table></div>`;
      }
    }
  },

  // Satış formu
  saleLines: [],

  showSaleForm() {
    this.saleLines = [];
    document.getElementById('emp-sale-form').style.display = '';
    this.addSaleLine();
    document.getElementById('emp-sale-form').scrollIntoView({ behavior: 'smooth' });
  },

  hideSaleForm() {
    document.getElementById('emp-sale-form').style.display = 'none';
    this.saleLines = [];
  },

  addSaleLine() {
    const idx = this.saleLines.length;
    this.saleLines.push({ coop_id: '', category: '', kg: null, box_count: '' });
    const container = document.getElementById('emp-sale-lines');
    const div = document.createElement('div');
    div.className = 'card';
    div.style.cssText = 'margin:0 0 12px;box-shadow:none;border:1.5px solid var(--c-border)';
    div.id = `sale-line-${idx}`;
    div.innerHTML = `
      <div class="card-body" style="padding:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <strong>Satır ${idx + 1}</strong>
          <button class="btn btn-sm" style="background:var(--c-danger-l);color:var(--c-danger);border:none"
                  onclick="StokEmployee.removeSaleLine(${idx})">Sil</button>
        </div>
        <div class="form-group" style="margin-bottom:8px">
          <label>Kümes</label>
          <select onchange="StokEmployee.saleLines[${idx}].coop_id=this.value">
            <option value="">Seçin…</option>
            ${this.coops.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin-bottom:8px">
          <label>Kategori</label>
          <select onchange="StokEmployee._onSaleLineCategory(${idx},this.value)">
            <option value="">Seçin…</option>
            <option value="normal">Normal (20–30 kg)</option>
            <option value="kirli">Kirli (22–27 kg)</option>
            <option value="kirik">Kırık</option>
            <option value="kucuk">Küçük</option>
          </select>
        </div>
        <div id="sale-line-kg-${idx}" style="display:none" class="form-group" style="margin-bottom:8px">
          <label>Kg</label>
          <input type="number" step="0.1" placeholder="0.0"
                 onchange="StokEmployee.saleLines[${idx}].kg=parseFloat(this.value)||null">
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label>Kutu Adedi</label>
          <input type="number" step="1" min="1" placeholder="0"
                 onchange="StokEmployee.saleLines[${idx}].box_count=parseInt(this.value)||0">
        </div>
      </div>
    `;
    container.appendChild(div);
  },

  _onSaleLineCategory(idx, val) {
    this.saleLines[idx].category = val;
    const kgDiv = document.getElementById(`sale-line-kg-${idx}`);
    if (kgDiv) kgDiv.style.display = ['normal','kirli'].includes(val) ? '' : 'none';
  },

  removeSaleLine(idx) {
    document.getElementById(`sale-line-${idx}`)?.remove();
    this.saleLines[idx] = null;
  },

  async submitSale() {
    const lines = this.saleLines.filter(Boolean).filter(l => l.coop_id && l.category && l.box_count > 0);
    if (!lines.length) { showToast('En az bir satır gerekli', 'warn'); return; }

    const res = await API.stok.createSale({
      transaction_date: this.currentDate,
      lines,
    });

    if (res.ok) {
      showToast(`Satış oluşturuldu: ${res.data.sale_no}`, 'success');
      this.hideSaleForm();
    } else {
      showToast(res.error ?? 'Hata', 'danger');
    }
  },
};
