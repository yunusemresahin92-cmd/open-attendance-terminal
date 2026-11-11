// Wi-Fi kart okuyucu (firmware 2.x) ile USB üzerinden konuşma: kurulum komutları ve cihazın durum satırları.
// Firebase'e bağlı değildir; birim testleriyle doğrulanır. Şifreler yalnız seri porta yazılır, hiçbir yerde saklanmaz.

// Komut çerçevesi (2.0): "[" + küçük harf onaltılık + "]" + "\n". Onaltılık veri sırasıyla:
//   uzunluk (2 bayt, metnin UTF-8 bayt sayısı) + CRC32 (4 bayt, metnin IEEE CRC32'si) + metin.
// Metin: komut \x1f anahtar=değer \x1f anahtar=değer ...
// Cihaz uzunluk/CRC tutmayan, tek sayıda onaltılık karakterli, bilinmeyen komut/alan içeren, \x1f veya "="
// ayracı eksik ya da aynı alanı iki kez taşıyan çerçeveyi uygulamadan reddeder: CFG:ERR:frame.
// Eski (1.x) cihazlar yalnız "O", "E" ve "{...}" komutlarını dinler; köşeli parantez ve küçük harf onaltılık
// karakterler onlar için anlamsızdır, çerçeve görmezden gelinir.
export const DEVICE_COMMAND_FIELDS = Object.freeze({
  cfg: Object.freeze(['ssid', 'wpass', 'email', 'fpass', 'ap', 'key', 'project']),
  status: Object.freeze([]), failed: Object.freeze([]), failclear: Object.freeze([]), forget: Object.freeze([]),
  assign: Object.freeze([]), setup: Object.freeze([]),
  // Cihaz saati internetten (NTP) ayarlanamadıysa bilgisayarın saati (UTC saniye) gönderilir.
  time: Object.freeze(['utc']),
});
export const DEVICE_COMMANDS = Object.freeze(Object.keys(DEVICE_COMMAND_FIELDS));
export const DEVICE_FIELD_KEYS = DEVICE_COMMAND_FIELDS.cfg;
export const SETUP_AP_NAME = 'PersonelTakip-Kurulum';
export const MAX_FRAME_TEXT = 900;
export const MAX_FRAME_FIELDS = 8;

const CONTROL = /[\u0000-\u001f\u007f]/;
const utf8Length = value => new TextEncoder().encode(String(value)).length;
const hexOf = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
// IEEE CRC32 (zlib ile aynı); cihaz yazılımı aynı hesabı yapar.
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function encodeDeviceFrame(command, fields = {}) {
  const allowed = DEVICE_COMMAND_FIELDS[command];
  if (!allowed) throw new Error(`Bilinmeyen cihaz komutu: ${command}`);
  const parts = [command];
  for (const [key, raw] of Object.entries(fields || {})) {
    if (raw == null || raw === '') continue;
    if (!allowed.includes(key)) throw new Error(`Bilinmeyen cihaz alanı: ${key}`);
    const value = String(raw);
    if (CONTROL.test(value)) throw new Error('Cihaz bilgilerinde görünmeyen (kontrol) karakter olamaz.');
    parts.push(`${key}=${value}`);
  }
  const text = new TextEncoder().encode(parts.join('\u001f'));
  if (text.length > MAX_FRAME_TEXT) throw new Error('Cihaz bilgileri çok uzun.');
  const header = new Uint8Array(6);
  new DataView(header.buffer).setUint16(0, text.length);
  new DataView(header.buffer).setUint32(2, crc32(text));
  return `[${hexOf(header)}${hexOf(text)}]\n`;
}

// Cihazın çerçeve çözücüsünün (kart-okuyucu.ino: frameError/handleFrame) birebir JS karşılığı.
// Sonuç: { command, fields } ya da { error: 'frame' }.
export function parseDeviceFrame(frame) {
  const bad = { error: 'frame' };
  const match = /^\[([0-9a-f]*)\]\s*$/.exec(String(frame));
  if (!match || match[1].length % 2 || match[1].length < 12 || match[1].length > 2 * (MAX_FRAME_TEXT + 6)) return bad;
  const bytes = new Uint8Array(match[1].match(/../g).map(item => parseInt(item, 16)));
  const view = new DataView(bytes.buffer);
  const text = bytes.subarray(6);
  if (view.getUint16(0) !== text.length || view.getUint32(2) !== crc32(text)) return bad;
  let decoded;
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(text); } catch { return bad; }
  const [command, ...items] = decoded.split('\u001f');
  const allowed = DEVICE_COMMAND_FIELDS[command];
  if (!allowed || items.length > MAX_FRAME_FIELDS) return bad;
  const fields = {};
  for (const item of items) {
    const at = item.indexOf('=');
    if (at <= 0 || at === item.length - 1) return bad;
    const key = item.slice(0, at);
    if (!allowed.includes(key) || Object.hasOwn(fields, key)) return bad;
    fields[key] = item.slice(at + 1);
  }
  return { command, fields };
}
// Testler ve belgeler için: geçersiz çerçevede null.
export function decodeDeviceFrame(frame) {
  const result = parseDeviceFrame(frame);
  return result.error ? null : result;
}

// ---- Kurulum formu ----
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Boş dönerse form geçerlidir. requireAccount: cihazda henüz hesap yoksa e-posta ve şifre zorunludur.
export function validateDeviceConfig(form, { requireAccount = false } = {}) {
  const ssid = String(form.ssid ?? '');
  const wifiPassword = String(form.wifiPassword ?? '');
  const email = String(form.email ?? '').trim();
  const password = String(form.password ?? '');
  const setupPassword = String(form.setupPassword ?? '');
  if (!ssid.trim() || utf8Length(ssid) > 32) return 'Wi-Fi adı 1–32 karakter olmalı.';
  if (CONTROL.test(ssid)) return 'Wi-Fi adında görünmeyen karakter olamaz.';
  if (wifiPassword && (!PRINTABLE_ASCII.test(wifiPassword) || wifiPassword.length < 8 || wifiPassword.length > 63)) {
    return 'Wi-Fi şifresi 8–63 karakter olmalı ve Türkçe harf içermemeli (şifresiz ağ için boş bırakın).';
  }
  if (requireAccount && (!email || !password)) return 'Cihaz hesabının e-posta adresini ve şifresini girin.';
  if (Boolean(email) !== Boolean(password)) return 'Cihaz hesabını değiştirmek için e-posta ve şifreyi birlikte girin.';
  if (email && (!EMAIL.test(email) || email.length > 100)) return 'Cihaz hesabı e-posta adresi geçerli değil.';
  if (password && (CONTROL.test(password) || password.length < 6 || utf8Length(password) > 128)) return 'Cihaz hesabı şifresi 6–128 karakter olmalı.';
  if (setupPassword && (!PRINTABLE_ASCII.test(setupPassword) || setupPassword.length < 8 || setupPassword.length > 63)) {
    return 'Kurulum ağı şifresi 8–63 karakter olmalı ve Türkçe harf içermemeli.';
  }
  return '';
}

// Cihaz hesabı yalnız Kart Okutma yetkisine sahip ayrı bir kullanıcı olmalıdır (Admin listesinden denetlenir).
export function deviceAccountProblem(users, email) {
  const value = String(email || '').trim().toLowerCase();
  if (!value) return '';
  const user = users.find(item => String(item.email || '').toLowerCase() === value);
  if (!user) return 'Bu e-posta ile kayıtlı kullanıcı yok. Önce giriş ekranından cihaz için ayrı bir hesap açın, sonra burada yalnız Kart Okutma yetkisi verin.';
  const menus = user.menus || [];
  if (user.admin || menus.length !== 1 || menus[0] !== 'terminal') return 'Cihaz hesabının yalnız Kart Okutma yetkisi olmalı. Admin tablosunda diğer yetkilerini kaldırıp kaydedin.';
  return '';
}

export function deviceConfigFields(form, firebaseConfig) {
  const fields = { ssid: form.ssid, wpass: form.wifiPassword || '', key: firebaseConfig.apiKey, project: firebaseConfig.projectId };
  if (form.email && form.password) { fields.email = String(form.email).trim(); fields.fpass = form.password; }
  if (form.setupPassword) fields.ap = form.setupPassword;
  // Şifresiz ağ: boş değer çerçevede gönderilmez; cihaz "-" değerini şifresiz ağ olarak anlar.
  if (!fields.wpass) fields.wpass = '-';
  return fields;
}

// ---- Cihazdan gelen satırlar ----
// Cihaz SSID ve e-posta gibi metinleri yüzde kodlamasıyla (%XX) gönderir.
export function percentDecode(value) {
  const text = String(value ?? '');
  const bytes = [];
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '%' && /^[0-9A-Fa-f]{2}$/.test(text.slice(index + 1, index + 3))) {
      bytes.push(parseInt(text.slice(index + 1, index + 3), 16));
      index += 2;
    } else bytes.push(...new TextEncoder().encode(text[index]));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

const number = value => (Number.isFinite(Number(value)) && value !== '' ? Number(value) : null);
export function parseDeviceLine(line) {
  const text = String(line ?? '').replace(/\r/g, '').trim();
  let match;
  if ((match = /^MODE:(WIFI|USB)$/.exec(text))) return { type: 'mode', mode: match[1].toLowerCase() };
  if (text === 'CFG:OK') return { type: 'cfg', ok: true };
  if ((match = /^CFG:ERR:([a-z]+)$/.exec(text))) return { type: 'cfg', ok: false, reason: match[1] };
  if (text === 'FAIL:END') return { type: 'fail-end' };
  if ((match = /^FAIL:(\d+);([0-9A-F]+);([a-z]+)$/.exec(text))) return { type: 'fail', at: new Date(Number(match[1]) * 1000), cardUid: match[2], reason: match[3] };
  if (text.startsWith('STATUS:')) {
    const values = {};
    for (const part of text.slice(7).split(';')) {
      const at = part.indexOf('=');
      if (at > 0) values[part.slice(0, at)] = percentDecode(part.slice(at + 1));
    }
    return {
      type: 'status',
      firmware: values.fw || '',
      mode: values.mode === 'wifi' ? 'wifi' : 'usb',
      wifi: values.wifi || 'off',
      net: values.net || 'offline',
      queue: number(values.queue) ?? 0,
      failed: number(values.failed) ?? 0,
      ssid: values.ssid || '',
      account: values.acct || '',
      clock: values.clock || '',
      time: values.time || '',
      // Saatin kaynağı (2.0): ntp | http (Google sunucu saati) | usb (bu bilgisayar) | rtc | none
      timeSource: values.tsrc || '',
    };
  }
  return null;
}

export const DEVICE_WIFI_LABELS = { off: 'Kapalı (USB modu)', connecting: 'Bağlanıyor…', ok: 'Bağlı', setup: 'Kurulum ağı açık' };
export const DEVICE_NET_LABELS = { online: 'Çevrimiçi', offline: 'İnternet yok', auth: 'Cihaz hesabı girilemedi', denied: 'Yetki yok (Kart Okutma yetkisi?)', noaccount: 'Cihaz hesabı girilmemiş' };
export const DEVICE_CFG_ERRORS = {
  frame: 'Komut cihaza bozuk ulaştı. Tekrar deneyin.',
  ssid: 'Wi-Fi adı geçersiz.',
  wpass: 'Wi-Fi şifresi geçersiz.',
  email: 'Cihaz hesabı e-postası geçersiz.',
  fpass: 'Cihaz hesabı şifresi geçersiz.',
  ap: 'Kurulum ağı şifresi geçersiz.',
  key: 'Firebase anahtarı geçersiz.',
  project: 'Firebase proje adı geçersiz.',
  account: 'Cihazda kayıtlı hesap yok; e-posta ve şifreyi girin.',
  storage: 'Cihaz bilgileri kaydedemedi (hafıza hatası).',
  time: 'Cihaz saati ayarlanamadı (bilgisayar saati geçersiz ya da cihaz saati internetten ayarlı).',
};
// Cihazın saati internetten (NTP) ayarlanamadıysa bilgisayarın saati gönderilir; cihaz NTP'yi her zaman önceler.
export const deviceTimeFields = (now = Date.now()) => ({ utc: String(Math.floor(now / 1000)) });
export const DEVICE_FAIL_REASONS = {
  denied: 'Kurallar reddetti (personel ayrılmış, işe başlamadan önceki gün veya gün elle girilmiş olabilir)',
  moved: 'Kart okutmadan sonra başkasına geçmiş; okutma yeni sahibine yazılmadı',
  edited: 'Gün okutmadan sonra elle düzeltilmiş (ya da elle girilmiş); düzeltme korundu',
  old: '7 günden eski okutma; sistem kabul etmiyor',
  clock: 'Cihaz saati ayarsızken okutuldu',
  bad: 'Bozuk kayıt',
};
export const deviceFailText = reason => DEVICE_FAIL_REASONS[reason] || 'Gönderilemedi';
