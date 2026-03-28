# Elif Farm — Geliştirme Planı

## Aşama 1 — Analiz ✅
- [x] Mimari plan
- [x] Veritabanı şeması tasarımı
- [x] Rol/modül yetki matrisi
- [x] Bildirim alıcı matrisi
- [x] Riskli noktalar + çözümler
- [x] Çelişkili noktaların netleştirilmesi (A–F kararları)

## Aşama 2 — DB Şeması + Ortak Altyapı ✅
- [x] wrangler.toml, package.json, tsconfig.json
- [x] db/schema.sql (tüm tablolar)
- [x] db/seed.sql (kullanıcılar, kümesler, bildirim tercihleri)
- [x] src/types.ts (merkezi tipler, sabitler)
- [x] src/middleware/auth.ts (JWT sign/verify, requireAuth)
- [x] src/middleware/validate.ts (kümes, kg, stok, dönem kontrolleri)
- [x] src/lib/ledger.ts (stock_ledger + raw_material_ledger yazıcıları, rebuild)
- [x] src/lib/week.ts (Cumartesi–Cuma hafta hesabı)
- [x] src/lib/closing-guard.ts (kapanış engel listesi üreticileri)
- [x] src/lib/push.ts (Web Push + in-app bildirim gönderici)
- [x] src/routes/auth.ts (login, logout, me, hash-password)
- [x] src/cron/daily.ts (gün sonu bildirim cron'u)
- [x] src/index.ts (Worker entry, router, ortak endpoint'ler)

## Aşama 3 — EF-Stok 🔲
- [ ] src/routes/stok/production.ts — üretim girişi, iptali
- [ ] src/routes/stok/sales.ts — satış aç, fiyatla, iptal, geri al
- [ ] src/routes/stok/closing.ts — haftalık + aylık kapanış
- [ ] src/routes/stok/reports.ts — günlük dashboard, haftalık, aylık, Excel export
- [ ] public/modules/stok/ — employee + manager/director UI

## Aşama 4 — EF-Yem 🔲
- [ ] src/routes/yem/materials.ts — hammadde kartları
- [ ] src/routes/yem/purchases.ts — alım girişi, fiyatlama, iptali
- [ ] src/routes/yem/recipes.ts — reçete oluştur, yeni versiyon, aktivasyon
- [ ] src/routes/yem/production.ts — yem üretimi (snapshot dahil), iptali
- [ ] src/routes/yem/silo.ts — silo kapanış, tüketim hesabı, bildirim tetikleme
- [ ] src/routes/yem/closing.ts — aylık kapanış
- [ ] src/routes/yem/reports.ts — dashboard, raporlar, Excel export
- [ ] public/modules/yem/ — employee + manager/director UI

## Aşama 5 — EF-Gübre 🔲
- [ ] src/routes/gubre/entries.ts — giriş, silme
- [ ] src/routes/gubre/closing.ts — aylık kapanış + Excel export
- [ ] public/modules/gubre/ — employee + manager UI

## Aşama 6 — Push, Export, Polish 🔲
- [ ] VAPID key üretimi + Web Push tam implementasyonu (src/lib/push.ts tamamlama)
- [ ] Service worker (public/sw.js) — push event, offline fallback
- [ ] PWA manifest (public/manifest.json) — iOS Home Screen yönlendirmesi
- [ ] Excel export — SheetJS client-side (tüm modüller)
- [ ] UX polish — mobile-first, renk kodlaması, form akışı
- [ ] Bildirim tercih yönetimi UI

## Kararlar Logu
- Director EF-Gübre'ye erişemez (A)
- Employee hammadde alımı yapamaz (B)
- Opening balance kg validasyonu uygulanır (C)
- Aylık kapanış için haftalık kapanış önkoşul (D)
- Silo kapanışı employee + manager girebilir; hesaplandığında manager Push alır (E)
- stock_summary + raw_material_summary tabloları zorunlu, rebuild endpoint mevcut (F)
- Manager ve director paylaşılan hesap (kabul edildi)
- Geri alma: tüm modüllerde compensating transaction, hard-delete yok (Gübre hariç soft-delete)
