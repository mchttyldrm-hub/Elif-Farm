// ============================================================
// Haftalık dönem hesabı
// Kural 8: Hafta Cumartesi başlar, Cuma biter.
// Hesap uygulama katmanında sabit offset ile yapılır.
// ============================================================

// ISO date string (YYYY-MM-DD) için haftanın Cumartesi başlangıcını döndür
export function getWeekStart(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  // getUTCDay(): 0=Pazar, 1=Pzt, ..., 6=Cumartesi
  // Cumartesi'ye kaç gün geri gidileceği:
  // Cmt=0, Paz=1, Pzt=2, Sal=3, Çar=4, Per=5, Cum=6
  const day = date.getUTCDay();
  const offset = day === 6 ? 0 : day + 1;  // Cumartesi offset=0, Cuma offset=6
  date.setUTCDate(date.getUTCDate() - offset);
  return toISODate(date);
}

// Haftanın Cuma bitiş tarihini döndür
export function getWeekEnd(weekStart: string): string {
  const date = new Date(`${weekStart}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 6);  // Cumartesi + 6 = Cuma
  return toISODate(date);
}

// Verilen tarih hangi haftaya ait? {week_start, week_end} döndür
export function getWeekRange(dateStr: string): { week_start: string; week_end: string } {
  const week_start = getWeekStart(dateStr);
  const week_end   = getWeekEnd(week_start);
  return { week_start, week_end };
}

// YYYY-MM-DD formatlı string üret
function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Bugünün tarihini UTC olarak döndür
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Verilen YYYY-MM-DD'nin yıl ve ay bilgisini döndür
export function getYearMonth(dateStr: string): { year: number; month: number } {
  const [year, month] = dateStr.split('-').map(Number);
  return { year, month };
}
