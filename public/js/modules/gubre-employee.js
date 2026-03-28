// ============================================================
// EF-Gübre — Employee UI
// Sekme: Gübre Girişi
// ============================================================

const GubreEmployee = {
  coops: [],
  currentDate: today(),

  async render(container) {
    container.innerHTML = this._shell();
    await this._loadCoops();
    this._renderForm();
    await this._loadTodayEntries();
  },

  _shell() {
    return `
      <div id="gubre-emp">
        <div class="header"><h1>EF-Gübre</h1><span class="badge">${fmtDate(this.currentDate)}</span></div>
        <div id="gubre-emp-content"></div>
      </div>`;
  },

  async _loadCoops() {
    const res = await API.coops();
    if (res.ok) this.coops = res.data;
  },

  _renderForm() {
    const el = document.getElementById('gubre-emp-content');
    el.innerHTML = `
      <div class="card" style="margin-top:12px">
        <div class="card-header"><h2>Gübre Girişi</h2></div>
        <div class="card-body">
          <div class="form-group">
            <label>Kümes</label>
            <select id="gubre-coop">
              <option value="">Seçin…</option>
              ${this.coops.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group input-large">
            <label>Araç Sayısı</label>
            <input type="number" id="gubre-vehicle-count" placeholder="0" step="1" min="1">
          </div>
          <div class="form-group">
            <label>Not <span style="color:var(--c-text-s);font-weight:400">(opsiyonel)</span></label>
            <input type="text" id="gubre-note" placeholder="…">
          </div>
          <button class="btn btn-primary" onclick="GubreEmployee.submitEntry()">Kaydet</button>
        </div>
      </div>

      <div class="card" style="margin-top:12px">
        <div class="card-header"><h2>Bugün Girişler</h2></div>
        <div id="gubre-today-list"><div class="loading">Yükleniyor…</div></div>
      </div>
    `;
  },

  async submitEntry() {
    const coopId       = document.getElementById('gubre-coop')?.value;
    const vehicleCount = parseInt(document.getElementById('gubre-vehicle-count')?.value ?? '0');
    const note         = document.getElementById('gubre-note')?.value?.trim();

    if (!coopId)           { showToast('Kümes seçin', 'danger'); return; }
    if (!(vehicleCount > 0)) { showToast('Araç sayısı 0\'dan büyük olmalıdır', 'danger'); return; }

    const btn = document.querySelector('#gubre-emp-content .btn-primary');
    if (btn) { btn.disabled = true; btn.textContent = 'Kaydediliyor…'; }

    const res = await API.gubre.createEntry({
      coop_id: parseInt(coopId),
      entry_date: this.currentDate,
      vehicle_count: vehicleCount,
      note: note || undefined,
    });

    if (res.ok) {
      showToast('Gübre girişi kaydedildi', 'success');
      document.getElementById('gubre-coop').value = '';
      document.getElementById('gubre-vehicle-count').value = '';
      document.getElementById('gubre-note').value = '';
      await this._loadTodayEntries();
    } else {
      showToast(res.error ?? 'Hata', 'danger');
    }

    if (btn) { btn.disabled = false; btn.textContent = 'Kaydet'; }
  },

  async _loadTodayEntries() {
    const el = document.getElementById('gubre-today-list');
    if (!el) return;

    const [y, m] = this.currentDate.split('-');
    const res = await API.gubre.listEntries({ year: y, month: m });
    if (!res.ok) { el.innerHTML = '<div class="empty">Yüklenemedi</div>'; return; }

    const todayItems = res.data.filter(e => e.entry_date === this.currentDate && !e.is_deleted);
    if (!todayItems.length) { el.innerHTML = '<div class="empty">Bugün giriş yok</div>'; return; }

    el.innerHTML = `<div class="table-wrap"><table>
      <thead><tr><th>Kümes</th><th>Araç</th><th>Not</th></tr></thead>
      <tbody>
      ${todayItems.map(e => `<tr>
        <td>${escHtml(e.coop_name)}</td>
        <td style="font-weight:600">${e.vehicle_count}</td>
        <td style="font-size:.8rem;color:var(--c-text-s)">${escHtml(e.note ?? '—')}</td>
      </tr>`).join('')}
      </tbody></table></div>`;
  },
};
