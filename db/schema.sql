-- ============================================================
-- ELİF FARM — Veritabanı Şeması v1
-- Cloudflare D1 (SQLite)
-- ============================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ============================================================
-- ORTAK TABLOLAR
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  display_name  TEXT    NOT NULL,
  role          TEXT    NOT NULL CHECK(role IN ('employee','manager','director')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Hangi kullanıcı hangi modüle erişebilir
CREATE TABLE IF NOT EXISTS user_module_permissions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module    TEXT    NOT NULL CHECK(module IN ('ef_stok','ef_yem','ef_gubre')),
  UNIQUE(user_id, module)
);

-- Kümesler (başlangıç: 1-2 aktif, 3-4 pasif)
CREATE TABLE IF NOT EXISTS coops (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Kritik işlem denetim logu
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  action      TEXT    NOT NULL,
  entity_type TEXT    NOT NULL,
  entity_id   INTEGER,
  old_data    TEXT,  -- JSON
  new_data    TEXT,  -- JSON
  note        TEXT,
  created_at  TEXT   NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user   ON audit_log(user_id);

-- ============================================================
-- EF-STOK
-- ============================================================

-- Ana ledger: tüm stok hareketlerinin doğruluk kaynağı
-- NOT: Stok hiçbir zaman direkt stock = X yazılarak güncellenmez.
CREATE TABLE IF NOT EXISTS stock_ledger (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  coop_id       INTEGER NOT NULL REFERENCES coops(id),
  category      TEXT    NOT NULL CHECK(category IN ('normal','kirli','kirik','kucuk')),
  movement_type TEXT    NOT NULL CHECK(movement_type IN (
                  'opening','production','production_reversal',
                  'sale','sale_cancel','adjustment')),
  reference_id  INTEGER,  -- sale_line_id, production_id vb.
  kg            REAL,     -- sadece normal/kirli; kirik/kucuk için NULL
  box_count     INTEGER   NOT NULL,
  note          TEXT,
  created_by    INTEGER   NOT NULL REFERENCES users(id),
  created_at    TEXT      NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stock_ledger_coop     ON stock_ledger(coop_id);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_category ON stock_ledger(category);
CREATE INDEX IF NOT EXISTS idx_stock_ledger_ref      ON stock_ledger(reference_id);

-- Performans cache — ledger'dan rebuild edilebilir
CREATE TABLE IF NOT EXISTS stock_summary (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  coop_id    INTEGER NOT NULL REFERENCES coops(id),
  category   TEXT    NOT NULL CHECK(category IN ('normal','kirli','kirik','kucuk')),
  total_kg   REAL    NOT NULL DEFAULT 0,  -- kirik/kucuk için her zaman 0
  total_box  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(coop_id, category)
);

-- Satış belgeleri
CREATE TABLE IF NOT EXISTS sales (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_no          TEXT    NOT NULL UNIQUE,  -- EFS-YYYYMMDD-NNN
  transaction_date TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'pending'
                   CHECK(status IN ('pending','partially_priced','closed','cancelled')),
  note             TEXT,
  created_by       INTEGER NOT NULL REFERENCES users(id),
  updated_by       INTEGER REFERENCES users(id),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_sales_date   ON sales(transaction_date);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);

-- Satış satırları
CREATE TABLE IF NOT EXISTS sale_lines (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id       INTEGER NOT NULL REFERENCES sales(id),
  coop_id       INTEGER NOT NULL REFERENCES coops(id),
  category      TEXT    NOT NULL CHECK(category IN ('normal','kirli','kirik','kucuk')),
  kg            REAL,     -- normal/kirli için; kirik/kucuk NULL
  box_count     INTEGER   NOT NULL,
  price_per_box REAL,     -- NULL = fiyat girilmemiş (pending)
  created_at    TEXT      NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_sale_lines_sale ON sale_lines(sale_id);

-- Üretim kayıtları (stok ledger'a yazılır, bu tablo detay tutar)
CREATE TABLE IF NOT EXISTS productions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  coop_id          INTEGER NOT NULL REFERENCES coops(id),
  production_date  TEXT    NOT NULL,
  category         TEXT    NOT NULL CHECK(category IN ('normal','kirli','kirik','kucuk')),
  kg               REAL,     -- normal/kirli için
  box_count        INTEGER   NOT NULL,
  is_reversed      INTEGER   NOT NULL DEFAULT 0,  -- iptal edilmiş mi
  note             TEXT,
  created_by       INTEGER   NOT NULL REFERENCES users(id),
  created_at       TEXT      NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_productions_date ON productions(production_date);
CREATE INDEX IF NOT EXISTS idx_productions_coop ON productions(coop_id);

-- Haftalık kapanışlar (Cumartesi–Cuma)
CREATE TABLE IF NOT EXISTS weekly_closings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start  TEXT    NOT NULL,  -- ISO date (Cumartesi)
  week_end    TEXT    NOT NULL,  -- ISO date (Cuma)
  status      TEXT    NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  closed_by   INTEGER REFERENCES users(id),
  closed_at   TEXT,
  UNIQUE(week_start)
);

-- Aylık kapanışlar — EF-Stok
CREATE TABLE IF NOT EXISTS monthly_closings_stok (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  year      INTEGER NOT NULL,
  month     INTEGER NOT NULL,
  status    TEXT    NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  closed_by INTEGER REFERENCES users(id),
  closed_at TEXT,
  UNIQUE(year, month)
);

-- ============================================================
-- EF-YEM
-- ============================================================

-- Hammadde kartları
CREATE TABLE IF NOT EXISTS raw_materials (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL UNIQUE,
  min_stock_kg REAL    NOT NULL DEFAULT 0,
  is_active    INTEGER NOT NULL DEFAULT 1,
  note         TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Hammadde stok ledger
CREATE TABLE IF NOT EXISTS raw_material_ledger (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_material_id INTEGER NOT NULL REFERENCES raw_materials(id),
  movement_type   TEXT    NOT NULL CHECK(movement_type IN (
                    'opening','purchase','purchase_cancel',
                    'production_use','production_reversal','adjustment')),
  reference_id    INTEGER,  -- purchase_id veya feed_production_id
  quantity_kg     REAL      NOT NULL,  -- (+) giriş, (−) çıkış
  created_by      INTEGER   NOT NULL REFERENCES users(id),
  created_at      TEXT      NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rm_ledger_material ON raw_material_ledger(raw_material_id);
CREATE INDEX IF NOT EXISTS idx_rm_ledger_ref      ON raw_material_ledger(reference_id);

-- Hammadde özet cache — raw_material_ledger'dan rebuild edilebilir
CREATE TABLE IF NOT EXISTS raw_material_summary (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_material_id INTEGER NOT NULL REFERENCES raw_materials(id) UNIQUE,
  total_kg        REAL    NOT NULL DEFAULT 0,
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Hammadde alımları
-- Birim fiyat normalde zorunlu; force_incomplete=1 ile manager sadece istisnai durumlarda boş bırakabilir
CREATE TABLE IF NOT EXISTS raw_material_purchases (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_material_id  INTEGER NOT NULL REFERENCES raw_materials(id),
  transaction_date TEXT    NOT NULL,
  quantity_kg      REAL    NOT NULL,
  unit_price_iqd   REAL,     -- NULL = eksik_fiyatlı
  total_price_iqd  REAL,     -- hesaplanan; NULL ise eksik
  status           TEXT    NOT NULL DEFAULT 'complete'
                   CHECK(status IN ('complete','missing_price','cancelled')),
  force_incomplete INTEGER NOT NULL DEFAULT 0,  -- manager explicit override
  is_cancelled     INTEGER NOT NULL DEFAULT 0,
  note             TEXT,
  created_by       INTEGER NOT NULL REFERENCES users(id),
  price_entered_by INTEGER REFERENCES users(id),
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_rm_purchases_date   ON raw_material_purchases(transaction_date);
CREATE INDEX IF NOT EXISTS idx_rm_purchases_status ON raw_material_purchases(status);

-- Reçete başlıkları — her kümes için ayrı, versiyonlanmış
-- Yeni versiyon eklenince aynı coop_id için önceki is_active=1 kayıt otomatik pasife alınır (uygulama katmanında)
CREATE TABLE IF NOT EXISTS feed_recipes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  coop_id    INTEGER NOT NULL REFERENCES coops(id),
  name       TEXT    NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  valid_from TEXT    NOT NULL,  -- ISO date
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feed_recipes_coop ON feed_recipes(coop_id);

-- Reçete satırları (1 ton yem için kullanılan hammadde kg'ı)
CREATE TABLE IF NOT EXISTS feed_recipe_lines (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  recipe_id       INTEGER NOT NULL REFERENCES feed_recipes(id),
  raw_material_id INTEGER NOT NULL REFERENCES raw_materials(id),
  kg_per_ton      REAL    NOT NULL,
  UNIQUE(recipe_id, raw_material_id)
);

-- Yem üretimleri
-- snapshot_data: üretim anındaki reçete versiyonu ve hammadde birim fiyatları
-- Format: {"v":1,"recipe_version":N,"lines":[{"raw_material_id":X,"name":"...","kg_per_ton":Y,"unit_price_iqd":Z}]}
CREATE TABLE IF NOT EXISTS feed_productions (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  coop_id                INTEGER NOT NULL REFERENCES coops(id),
  recipe_id              INTEGER NOT NULL REFERENCES feed_recipes(id),
  production_date        TEXT    NOT NULL,
  quantity_kg            REAL    NOT NULL,
  total_cost_iqd         REAL    NOT NULL,
  cost_per_ton_iqd       REAL    NOT NULL,  -- (total_cost / quantity_kg) * 1000
  snapshot_recipe_version INTEGER NOT NULL,
  snapshot_data          TEXT    NOT NULL,  -- JSON blob (bkz. yukarıdaki format)
  is_reversed            INTEGER NOT NULL DEFAULT 0,
  created_by             INTEGER NOT NULL REFERENCES users(id),
  created_at             TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_feed_productions_date ON feed_productions(production_date);
CREATE INDEX IF NOT EXISTS idx_feed_productions_coop ON feed_productions(coop_id);

-- Silo günlük kapanışları
-- Tüketim formülü: dünkü_kapanış + bugün_üretilen − bugün_kapanış = bugün_tüketim
-- Kural 7: kapanış girilmemişse tüketim hesaplanmaz, tahmin yapılmaz
CREATE TABLE IF NOT EXISTS silo_closings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  coop_id      INTEGER NOT NULL REFERENCES coops(id),
  closing_date TEXT    NOT NULL,
  closing_kg   REAL    NOT NULL,
  note         TEXT,
  created_by   INTEGER NOT NULL REFERENCES users(id),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(coop_id, closing_date)
);

CREATE INDEX IF NOT EXISTS idx_silo_closings_coop ON silo_closings(coop_id, closing_date);

-- Aylık kapanışlar — EF-Yem
CREATE TABLE IF NOT EXISTS monthly_closings_yem (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  year      INTEGER NOT NULL,
  month     INTEGER NOT NULL,
  status    TEXT    NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  closed_by INTEGER REFERENCES users(id),
  closed_at TEXT,
  UNIQUE(year, month)
);

-- ============================================================
-- EF-GÜBRE
-- ============================================================

CREATE TABLE IF NOT EXISTS manure_entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  coop_id       INTEGER NOT NULL REFERENCES coops(id),
  entry_date    TEXT    NOT NULL,
  vehicle_count INTEGER NOT NULL CHECK(vehicle_count > 0),
  is_deleted    INTEGER NOT NULL DEFAULT 0,
  note          TEXT,
  created_by    INTEGER NOT NULL REFERENCES users(id),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_manure_date ON manure_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_manure_coop ON manure_entries(coop_id);

-- Aylık kapanışlar — EF-Gübre
CREATE TABLE IF NOT EXISTS monthly_closings_gubre (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  year                 INTEGER NOT NULL,
  month                INTEGER NOT NULL,
  status               TEXT    NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  export_generated_at  TEXT,
  closed_by            INTEGER REFERENCES users(id),
  closed_at            TEXT,
  UNIQUE(year, month)
);

-- ============================================================
-- BİLDİRİM SİSTEMİ
-- ============================================================

-- Web Push abonelikleri (cihaz bazlı — birden fazla cihaz aynı user'a bağlı olabilir)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     TEXT    NOT NULL UNIQUE,
  p256dh       TEXT    NOT NULL,
  auth_key     TEXT    NOT NULL,
  user_agent   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

-- Kullanıcı bazlı bildirim kanal tercihleri
-- Varsayılan davranış notification_defaults tablosundan okunur; override burada tutulur
CREATE TABLE IF NOT EXISTS notification_preferences (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type TEXT    NOT NULL,
  channel           TEXT    NOT NULL CHECK(channel IN ('push','in_app','disabled')),
  UNIQUE(user_id, notification_type)
);

-- Bildirim gönderim logu — spam önleme (aynı type+date+user günde 1 kez)
CREATE TABLE IF NOT EXISTS notification_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_type TEXT    NOT NULL,
  trigger_date      TEXT    NOT NULL,  -- YYYY-MM-DD
  target_user_id    INTEGER NOT NULL REFERENCES users(id),
  channel           TEXT    NOT NULL,
  status            TEXT    NOT NULL CHECK(status IN ('sent','failed')),
  sent_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(notification_type, trigger_date, target_user_id)
);

-- In-app bildirim merkezi (push izni olmayan kullanıcılar dahil herkese fallback)
CREATE TABLE IF NOT EXISTS in_app_notifications (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type   TEXT    NOT NULL,
  title               TEXT    NOT NULL,
  body                TEXT    NOT NULL,
  is_read             INTEGER NOT NULL DEFAULT 0,
  related_entity_type TEXT,
  related_entity_id   INTEGER,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_in_app_notif_user ON in_app_notifications(user_id, is_read);
