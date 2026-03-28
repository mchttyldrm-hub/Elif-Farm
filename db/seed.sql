-- ============================================================
-- ELİF FARM — Başlangıç Verisi
-- Şifreler: bcrypt hash üretilip buraya yazılmalı
-- Geçici hash = "elif2024" için bcrypt(cost=12) placeholder kullanıldı
-- Prod'a geçmeden gerçek hash ile değiştirin!
-- ============================================================

-- Kullanıcılar
-- Paylaşılan hesaplar: yonetici (manager), mudur (director)
-- Kişi başı hesaplar: employee'ler
INSERT INTO users (username, password_hash, display_name, role) VALUES
  ('stok_eleman',  '$2b$12$PLACEHOLDER_CHANGE_ME_stok',   'Stok Elemanı',  'employee'),
  ('yem_eleman',   '$2b$12$PLACEHOLDER_CHANGE_ME_yem',    'Yem Elemanı',   'employee'),
  ('gubre_eleman', '$2b$12$PLACEHOLDER_CHANGE_ME_gubre',  'Gübre Elemanı', 'employee'),
  ('yonetici',     '$2b$12$PLACEHOLDER_CHANGE_ME_mgr',    'Yönetici',      'manager'),
  ('mudur',        '$2b$12$PLACEHOLDER_CHANGE_ME_dir',    'Müdür',         'director');

-- Modül izinleri
INSERT INTO user_module_permissions (user_id, module) VALUES
  (1, 'ef_stok'),   -- stok_eleman
  (2, 'ef_yem'),    -- yem_eleman
  (3, 'ef_gubre'),  -- gubre_eleman
  (4, 'ef_stok'),   -- yonetici → tüm modüller
  (4, 'ef_yem'),
  (4, 'ef_gubre'),
  (5, 'ef_stok'),   -- mudur → ef_stok ve ef_yem (EF-Gübre'ye erişim yok)
  (5, 'ef_yem');

-- Kümesler (1-2 aktif, 3-4 pasif)
INSERT INTO coops (name, is_active) VALUES
  ('Kümes 1', 1),
  ('Kümes 2', 1),
  ('Kümes 3', 0),
  ('Kümes 4', 0);

-- Stok özet başlangıç (ledger boş başladığında 0 kayıtları)
INSERT INTO stock_summary (coop_id, category, total_kg, total_box) VALUES
  (1, 'normal', 0, 0), (1, 'kirli', 0, 0), (1, 'kirik', 0, 0), (1, 'kucuk', 0, 0),
  (2, 'normal', 0, 0), (2, 'kirli', 0, 0), (2, 'kirik', 0, 0), (2, 'kucuk', 0, 0),
  (3, 'normal', 0, 0), (3, 'kirli', 0, 0), (3, 'kirik', 0, 0), (3, 'kucuk', 0, 0),
  (4, 'normal', 0, 0), (4, 'kirli', 0, 0), (4, 'kirik', 0, 0), (4, 'kucuk', 0, 0);

-- ============================================================
-- Varsayılan bildirim tercihleri
-- Matris: Aşama 1 analizindeki tablo
-- channel: push | in_app | disabled
-- ============================================================

-- Manager (user_id=4) varsayılan bildirim tercihleri
INSERT INTO notification_preferences (user_id, notification_type, channel) VALUES
  (4, 'day_end_production_summary',   'push'),
  (4, 'missing_price_sale',           'push'),
  (4, 'weekly_closing_blocker',       'push'),
  (4, 'critical_stock_warning',       'push'),
  (4, 'missing_price_purchase',       'push'),
  (4, 'monthly_closing_blocker',      'push'),
  (4, 'manure_day_end_summary',       'push'),
  (4, 'monthly_table_ready_gubre',    'in_app'),
  (4, 'silo_consumption_calculated',  'push');

-- Director (user_id=5) — minimum set: sadece üst düzey push
INSERT INTO notification_preferences (user_id, notification_type, channel) VALUES
  (5, 'day_end_production_summary',   'in_app'),
  (5, 'missing_price_sale',           'disabled'),
  (5, 'weekly_closing_blocker',       'push'),
  (5, 'critical_stock_warning',       'push'),
  (5, 'missing_price_purchase',       'disabled'),
  (5, 'monthly_closing_blocker',      'push'),
  (5, 'manure_day_end_summary',       'disabled'),
  (5, 'monthly_table_ready_gubre',    'disabled'),
  (5, 'silo_consumption_calculated',  'disabled');
