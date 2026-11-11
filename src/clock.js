// Kart okutarak giriş-çıkış (Kart Okutma terminali) için saf yardımcılar. Firebase'e bağlı değildir.

// Aynı personelin bu süre içindeki ikinci okutması yanlışlıkla iki kez okutma sayılır ve kaydedilmez.
export const REPEAT_MINUTES = 15;

const TR_PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
// Kurallar saati Türkiye saatine (UTC+3) göre denetler; bilgisayarın saat dilimi farklı olsa da aynı sonuç çıkar.
export function turkeyNow(value = new Date()) {
  const part = Object.fromEntries(TR_PARTS.formatToParts(value).map(item => [item.type, item.value]));
  return { date: `${part.year}-${part.month}-${part.day}`, time: `${part.hour}:${part.minute}` };
}

const toMinutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

// Okutmanın ne yapacağına karar verir. entry: bugünün puantaj kaydı, clockIn: bugünün açık girişi.
// İlk okutma giriş, sonraki okutma çıkıştır; daha sonraki okutmalar çıkış saatini ileri alır (ilk giriş – son çıkış).
export function decideClock({ entry, clockIn, now, repeatMinutes = REPEAT_MINUTES }) {
  if (entry) {
    if (entry.status !== 'present') return { action: 'blocked', reason: entry.status };
    const since = toMinutes(now.time) - toMinutes(entry.end);
    // Gün elle girilmiş ve çıkış saati henüz gelmemişse terminal kaydı değiştirmez.
    if (since < 0) return { action: 'blocked', reason: 'manual', start: entry.start, end: entry.end };
    if (since <= 0 || since < repeatMinutes) return { action: 'repeat', last: 'out', start: entry.start, end: entry.end };
    return { action: 'extend', start: entry.start, end: now.time };
  }
  if (clockIn) {
    const since = toMinutes(now.time) - toMinutes(clockIn.start);
    if (since <= 0 || since < repeatMinutes) return { action: 'repeat', last: 'in', start: clockIn.start };
    return { action: 'out', start: clockIn.start, end: now.time };
  }
  return { action: 'in', start: now.time };
}

// ---- Okuyucu ekranına mesaj ----
// Mesaj "{" + UTF-8 metnin küçük harf onaltılık hâli + "}" olarak gider. Bu karakterlerin hiçbiri eski cihaz
// yazılımının dinlediği "O" veya "E" komutu değildir; eski okuyucular mesajı görmezden gelir.
export const READER_KINDS = ['in', 'out', 'ok', 'info', 'err'];
const MAX_LINE = 40;
// Ekran yalnız büyük harf, rakam, Türkçe büyük harfler ve birkaç işaret gösterir.
export function readerText(value) {
  return String(value ?? '')
    .toLocaleUpperCase('tr-TR')
    .replace(/Â/g, 'A').replace(/Î/g, 'İ').replace(/Û/g, 'U')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[^A-Z0-9ÇĞİÖŞÜ .,:;'()\/+\-–·]/g, '')
    .replace(/–|·/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LINE);
}
export function encodeReaderMessage(kind, lines) {
  if (!READER_KINDS.includes(kind)) throw new Error(`Bilinmeyen okuyucu mesajı: ${kind}`);
  const text = [kind, ...lines.slice(0, 4).map(readerText)].join('\u001f');
  const hex = Array.from(new TextEncoder().encode(text), byte => byte.toString(16).padStart(2, '0')).join('');
  return `{${hex}}\n`;
}
export function decodeReaderMessage(message) {
  const match = /^\{([0-9a-f]*)\}\s*$/.exec(message);
  if (!match || match[1].length % 2) return null;
  const bytes = new Uint8Array(match[1].match(/../g)?.map(item => parseInt(item, 16)) || []);
  const [kind, ...lines] = new TextDecoder().decode(bytes).split('\u001f');
  return { kind, lines };
}

const firstName = name => String(name || '').trim();
// Okutma sonucunu okuyucu ekranındaki satırlara çevirir.
export function readerMessageFor(result) {
  switch (result.action) {
    case 'in': return { kind: 'in', lines: ['GİRİŞ', firstName(result.name), `${result.start}  İYİ ÇALIŞMALAR`] };
    case 'out':
    case 'extend': return { kind: 'out', lines: ['ÇIKIŞ', firstName(result.name), `${result.end}  İYİ AKŞAMLAR`] };
    case 'repeat': return { kind: 'info', lines: ['ZATEN OKUTULDU', firstName(result.name), result.last === 'out' ? `ÇIKIŞ ${result.end}` : `GİRİŞ ${result.start}`] };
    case 'blocked': return { kind: 'err', lines: ['KAYIT YAPILMADI', firstName(result.name), result.reason === 'leave' ? 'BUGÜN İZİNLİ' : result.reason === 'absent' ? 'BUGÜN DEVAMSIZ' : 'GÜN ELLE GİRİLMİŞ'] };
    default: return { kind: 'err', lines: [result.title || 'HATA', result.detail || ''] };
  }
}
export const CLOCK_ACTION_LABELS = { in: 'Giriş', out: 'Çıkış', extend: 'Çıkış (güncellendi)', repeat: 'Tekrar okutma', blocked: 'Kaydedilmedi' };
