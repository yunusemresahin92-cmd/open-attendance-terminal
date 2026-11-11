// ESP32 + RC522 kart okuyucusunu USB (Web Serial) üzerinden okur.
// Cihaz her kart için "UID:A1B2C3D4" satırı gönderir (firmware/kart-okuyucu).
import { normalizeCardUid } from './cards.js';
import { encodeReaderMessage } from './clock.js';
import { encodeDeviceFrame, parseDeviceLine } from './device-config.js';

const MAX_LINE = 256;

export function parseReaderLine(line) {
  const match = /^\s*UID:\s*([0-9A-Fa-f :-]+?)\s*$/.exec(String(line).replace(/\r/g, ''));
  if (!match) return null;
  try { return normalizeCardUid(match[1]); } catch { return null; }
}

export function createLineSplitter(onLine) {
  let buffer = '';
  return chunk => {
    buffer += chunk;
    const parts = buffer.split('\n');
    buffer = parts.pop();
    if (buffer.length > MAX_LINE) buffer = ''; // satır sonu gelmeyen bozuk veri birikmesin
    for (const part of parts) {
      const line = part.replace(/\r$/, '');
      if (line.length && line.length <= MAX_LINE) onLine(line);
    }
  };
}

export function createScanFilter(windowMs = 1500, now = () => Date.now()) {
  let lastUid = '';
  let lastAt = -Infinity;
  return uid => {
    const time = now();
    if (uid === lastUid && time - lastAt < windowMs) return false;
    lastUid = uid; lastAt = time;
    return true;
  };
}

export const serialSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator;

// ESP32 kartlarındaki USB-seri çipleri: CP210x (Silicon Labs), CH340/CH9102 (WCH), FTDI, Espressif yerleşik USB.
export const READER_USB_VENDOR_IDS = Object.freeze([0x10c4, 0x1a86, 0x0403, 0x303a]);

// Yalnız bilinen USB okuyucu çipleri okuyucu sayılır; Bluetooth/modem gibi seri portlar açılmaz.
export function isReaderPort(port) {
  try {
    const vendor = port?.getInfo?.()?.usbVendorId;
    return READER_USB_VENDOR_IDS.includes(vendor);
  } catch { return false; }
}

// Daha önce izin verilmiş okuyucu portu (tıklamadan yeniden bağlanmak için). Yoksa null.
export async function rememberedReaderPort() {
  if (!serialSupported() || !navigator.serial.getPorts) return null;
  try { return (await navigator.serial.getPorts()).find(isReaderPort) || null; } catch { return null; }
}

// onDevice: Wi-Fi okuyucunun (firmware 2.x) MODE/STATUS/CFG/FAIL satırları. Eski okuyucular bu satırları göndermez.
export async function connectCardReader({ port: knownPort = null, onCard, onStatus = () => {}, onError = () => {}, onDevice = () => {} }) {
  if (!serialSupported()) throw new Error('Bu tarayıcı USB kart okuyucuyu desteklemiyor. Masaüstü uygulamasını, Chrome veya Edge kullanın.');
  let port = knownPort;
  if (port && !isReaderPort(port)) throw new Error('Seçilen port kart okuyucu değil. ESP32 USB kablosuyla takılı mı kontrol edin.');
  if (!port) try { port = await navigator.serial.requestPort({ filters: READER_USB_VENDOR_IDS.map(usbVendorId => ({ usbVendorId })) }); }
  catch (cause) {
    if (cause?.name === 'NotFoundError') throw new Error('Kart okuyucu seçilmedi. ESP32 USB kablosuyla takılı mı kontrol edin.');
    throw cause;
  }
  try { await port.open({ baudRate: 115200 }); }
  catch { throw new Error('Kart okuyucu açılamadı. Başka bir program (ör. Arduino IDE seri monitörü) kullanıyorsa kapatın.'); }
  const accept = createScanFilter();
  const encoder = new TextEncoder();
  let closed = false;
  let reader = null;
  const send = async text => {
    if (closed || !port.writable) return;
    const writer = port.writable.getWriter();
    try { await writer.write(encoder.encode(text)); } catch { /* cihaz çıkarıldı */ } finally { writer.releaseLock(); }
  };
  const split = createLineSplitter(line => {
    if (line.trim() === 'READY') onStatus('ready');
    if (line.startsWith('ERROR:RC522')) onError(new Error('Kart okuyucu modülü (RC522) bulunamadı. Kabloları ve 3.3V bağlantısını kontrol edin.'));
    const device = parseDeviceLine(line);
    if (device) { try { onDevice(device); } catch { /* ekran güncellemesi okumayı durdurmaz */ } return; }
    const uid = parseReaderLine(line);
    if (uid && accept(uid)) onCard(uid);
  });
  // Kısa süreli okuma hatalarında (ör. arabellek taşması) port yeniden okunur; cihaz çıkarılınca bağlantı kapanır.
  const loop = (async () => {
    const decoder = new TextDecoder();
    let failures = 0;
    while (!closed && port.readable) {
      reader = port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          failures = 0;
          split(decoder.decode(value, { stream: true }));
        }
      } catch {
        if (++failures > 3) break;
      } finally { reader.releaseLock(); reader = null; }
    }
    if (!closed) {
      onError(new Error('Kart okuyucu bağlantısı koptu. USB kablosunu kontrol edip yeniden bağlanın.'));
      closed = true;
      try { await port.close(); } catch { /* zaten kapalı */ }
      onStatus('disconnected');
    }
  })();
  onStatus('connected');
  return {
    port,
    beepOk: () => send('O'),
    beepError: () => send('E'),
    // Ekranlı okuyucuda kısa mesaj gösterir (ör. personelin adı). Eski okuyucular bu satırı görmezden gelir.
    display: (kind, lines) => send(encodeReaderMessage(kind, lines)),
    // Wi-Fi okuyucuya kurulum/durum komutu (device-config.js). Eski okuyucular çerçeveyi görmezden gelir.
    sendFrame: async (command, fields) => send(encodeDeviceFrame(command, fields)),
    async disconnect() {
      if (closed) return;
      closed = true;
      try { await reader?.cancel(); } catch { /* okuma zaten bitti */ }
      await loop.catch(() => {});
      try { await port.close(); } catch { /* zaten kapalı */ }
      onStatus('disconnected');
    },
  };
}
