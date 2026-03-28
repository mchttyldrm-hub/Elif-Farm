# Elif Farm — Öğrenilen Dersler

## Mimari Kararlar

### Ledger önce, summary sonra
Stok doğruluğu için asıl kaynak daima ledger tablosudur.
Summary cache her yazma işleminde aynı transaction içinde güncellenir.
summary != ledger durumunda rebuild endpoint mevcuttur.

### Kapanış engeli = somut liste
Kapanış bloke edildiğinde soyut "bir şeyler eksik" mesajı değil,
hangi kayıtların eksik olduğu açıkça listelenir.

### Geri alma = compensating transaction
Finansal/stok kayıtlar hiçbir zaman hard-delete edilmez.
Tüm düzeltmeler yeni bir ledger hareketi olarak kaydedilir.
Geri almanın stoku eksiye düşürüp düşürmeyeceği önceden kontrol edilir.

### Backend validasyon = UI validasyonun kopyası
UI'da disable/hidden güvenlik sayılmaz.
Her kural (kümes aktiflik, kg aralık, stok yeterliliği, dönem açıklığı)
Worker katmanında da uygulanır. validate.ts merkezi noktadır.

### Snapshot = geçmişin bağımsızlığı
Yem üretimi kaydedilirken o anki reçete + hammadde fiyatları JSON olarak yazılır.
snapshot_data içinde "v":1 versiyon alanı tutulur.

### iOS push = Home Screen zorunlu
navigator.standalone kontrolü ilk girişte yapılır.
Home Screen'e eklenmemişse banner sürekli gösterilir, kapatılamaz.

## Düzeltmeler ve Öğrenilen Hatalar

_(Kullanıcı düzeltmesi sonrası buraya eklenecek)_
