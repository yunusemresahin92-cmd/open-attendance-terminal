import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  crc32, deviceFailText, deviceTimeFields, parseDeviceFrame, DEVICE_COMMAND_FIELDS, DEVICE_CFG_ERRORS,
  decodeDeviceFrame, deviceAccountProblem, deviceConfigFields, encodeDeviceFrame, parseDeviceLine, percentDecode, validateDeviceConfig,
  DEVICE_COMMANDS, DEVICE_FIELD_KEYS, SETUP_AP_NAME,
} from './device-config.js';
import { connectCardReader } from './card-reader.js';

const validForm = { ssid: 'Demo Atölye', wifiPassword: 'gizli-sifre-123', email: 'terminal@example.com', password: 'cihazSifre!9', setupPassword: 'kurulum123' };

test('provisioning frames round-trip Turkish text and never contain legacy O/E/{ command characters', () => {
  const frame = encodeDeviceFrame('cfg', { ssid: 'Demo Atölye', wpass: 'a=b;c%d!E', email: 'terminal@example.com' });
  assert.match(frame, /^\[[0-9a-f]+\]\n$/);
  // Eski 1.x cihaz yalnız O, E ve { karakterlerine tepki verir; çerçevede hiçbiri yoktur.
  assert.equal(/[OE{}]/.test(frame), false);
  assert.deepEqual(decodeDeviceFrame(frame), { command: 'cfg', fields: { ssid: 'Demo Atölye', wpass: 'a=b;c%d!E', email: 'terminal@example.com' } });
  assert.deepEqual(decodeDeviceFrame(encodeDeviceFrame('status')), { command: 'status', fields: {} });
});

test('frame encoder rejects unknown commands/fields, control characters and oversized frames; empty values are omitted', () => {
  assert.throws(() => encodeDeviceFrame('reboot'), /Bilinmeyen cihaz komutu/);
  assert.throws(() => encodeDeviceFrame('cfg', { token: 'x' }), /Bilinmeyen cihaz alanı/);
  assert.throws(() => encodeDeviceFrame('cfg', { ssid: 'a\u001fb' }), /kontrol/);
  assert.throws(() => encodeDeviceFrame('cfg', { ssid: 'line\nbreak' }), /kontrol/);
  assert.throws(() => encodeDeviceFrame('cfg', { fpass: 'x'.repeat(1000) }), /çok uzun/);
  assert.deepEqual(decodeDeviceFrame(encodeDeviceFrame('cfg', { ssid: 'Ağ', email: '', ap: null })).fields, { ssid: 'Ağ' });
  assert.ok(DEVICE_COMMANDS.includes('assign') && DEVICE_FIELD_KEYS.includes('fpass'));
  assert.equal(decodeDeviceFrame('[abc]'), null);
  assert.equal(decodeDeviceFrame('{6869}'), null);
});

test('device configuration form validation gives Turkish messages', () => {
  assert.equal(validateDeviceConfig(validForm, { requireAccount: true }), '');
  assert.equal(validateDeviceConfig({ ...validForm, wifiPassword: '' }), '');
  assert.match(validateDeviceConfig({ ...validForm, ssid: '' }), /Wi-Fi adı/);
  assert.match(validateDeviceConfig({ ...validForm, ssid: 'ç'.repeat(17) }), /Wi-Fi adı/);
  assert.match(validateDeviceConfig({ ...validForm, wifiPassword: 'kısa' }), /Wi-Fi şifresi/);
  assert.match(validateDeviceConfig({ ...validForm, wifiPassword: 'şifreşifre' }), /Türkçe harf/);
  assert.match(validateDeviceConfig({ ...validForm, email: '', password: '' }, { requireAccount: true }), /e-posta adresini ve şifresini/);
  assert.equal(validateDeviceConfig({ ...validForm, email: '', password: '' }, { requireAccount: false }), '');
  assert.match(validateDeviceConfig({ ...validForm, password: '' }), /birlikte/);
  assert.match(validateDeviceConfig({ ...validForm, email: 'kapi' }), /e-posta/);
  assert.match(validateDeviceConfig({ ...validForm, password: '123' }), /6–128/);
  assert.match(validateDeviceConfig({ ...validForm, setupPassword: '1234567' }), /Kurulum ağı şifresi/);
  assert.equal(validateDeviceConfig({ ...validForm, setupPassword: '' }), '');
});

test('the device account must be an existing non-admin user with only the terminal permission', () => {
  const users = [
    { email: 'terminal@example.com', admin: false, menus: ['terminal'] },
    { email: 'manager@example.com', admin: true, menus: [] },
    { email: 'timesheet@example.com', admin: false, menus: ['terminal', 'timesheet'] },
  ];
  assert.equal(deviceAccountProblem(users, 'TERMINAL@EXAMPLE.COM'), '');
  assert.equal(deviceAccountProblem(users, ''), '');
  assert.match(deviceAccountProblem(users, 'missing@example.com'), /kayıtlı kullanıcı yok/);
  assert.match(deviceAccountProblem(users, 'manager@example.com'), /yalnız Kart Okutma/);
  assert.match(deviceAccountProblem(users, 'timesheet@example.com'), /yalnız Kart Okutma/);
});

test('config fields carry the public Firebase web config; account and setup password only when entered; open Wi-Fi as "-"', () => {
  const config = { apiKey: 'AIzaTestKey', projectId: 'demo-project' };
  assert.deepEqual(deviceConfigFields(validForm, config), {
    ssid: 'Demo Atölye', wpass: 'gizli-sifre-123', key: 'AIzaTestKey', project: 'demo-project', email: 'terminal@example.com', fpass: 'cihazSifre!9', ap: 'kurulum123',
  });
  assert.deepEqual(deviceConfigFields({ ssid: 'Açık Ağ', wifiPassword: '', email: '', password: '', setupPassword: '' }, config), {
    ssid: 'Açık Ağ', wpass: '-', key: 'AIzaTestKey', project: 'demo-project',
  });
});

test('device status, mode, config and failure lines are parsed; SSID is percent-decoded', () => {
  assert.deepEqual(parseDeviceLine('MODE:WIFI\r'), { type: 'mode', mode: 'wifi' });
  assert.deepEqual(parseDeviceLine('MODE:USB'), { type: 'mode', mode: 'usb' });
  assert.deepEqual(parseDeviceLine('CFG:OK'), { type: 'cfg', ok: true });
  assert.deepEqual(parseDeviceLine('CFG:ERR:wpass'), { type: 'cfg', ok: false, reason: 'wpass' });
  const status = parseDeviceLine('STATUS:fw=2.0;mode=wifi;wifi=ok;net=online;queue=3;failed=1;ssid=Demo%20At%C3%B6lye%3B1;acct=terminal%40example.com;clock=ok;time=2026-11-10%2009%3A15');
  assert.deepEqual(status, { type: 'status', firmware: '2.0', mode: 'wifi', wifi: 'ok', net: 'online', queue: 3, failed: 1, ssid: 'Demo Atölye;1', account: 'terminal@example.com', clock: 'ok', time: '2026-11-10 09:15', timeSource: '' });
  const fail = parseDeviceLine('FAIL:1789000000;A1B2C3D4;denied');
  assert.equal(fail.type, 'fail');
  assert.equal(fail.cardUid, 'A1B2C3D4');
  assert.equal(fail.at.getTime(), 1789000000 * 1000);
  assert.deepEqual(parseDeviceLine('FAIL:END'), { type: 'fail-end' });
  assert.equal(parseDeviceLine('UID:A1B2C3D4'), null);
  assert.equal(parseDeviceLine('READY'), null);
  assert.equal(percentDecode('%ZZ%41'), '%ZZA');
  assert.equal(SETUP_AP_NAME, 'PersonelTakip-Kurulum');
});

test('reader connection routes device lines to onDevice (not onCard) and sends framed commands', async () => {
  const encoder = new TextEncoder();
  const written = [];
  let feed;
  const port = {
    readable: new ReadableStream({ start(controller) { feed = controller; } }),
    writable: new WritableStream({ write(chunk) { written.push(new TextDecoder().decode(chunk)); } }),
    async open() {}, async close() {},
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serial: { requestPort: async () => port } } });
  try {
    const cards = [], device = [];
    const reader = await connectCardReader({ onCard: uid => cards.push(uid), onDevice: info => device.push(info) });
    feed.enqueue(encoder.encode('READY\r\nMODE:WIFI\r\nUID:A1B2C3D4\r\nSTATUS:fw=2.0;mode=wifi;queue=0\r\nCFG:OK\r\n'));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(cards, ['A1B2C3D4']);
    assert.deepEqual(device.map(item => item.type), ['mode', 'status', 'cfg']);
    await reader.sendFrame('cfg', { ssid: 'Ağ', wpass: 'sifre1234' });
    assert.deepEqual(decodeDeviceFrame(written[0]), { command: 'cfg', fields: { ssid: 'Ağ', wpass: 'sifre1234' } });
    await assert.rejects(reader.sendFrame('nope'), /Bilinmeyen/);
    await reader.disconnect();
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator;
  }
});

const source = await readFile(new URL('./main.jsx', import.meta.url), 'utf8');
const firmware = await readFile(new URL('../firmware/kart-okuyucu/kart-okuyucu.ino', import.meta.url), 'utf8');
const firmwareSource = firmware;

test('Kart Okutma does not record scans itself while the device announces Wi-Fi mode', () => {
  assert.match(source, /if \(deviceMode\.current === 'wifi'\) \{[\s\S]{0,200}Cihaz Wi-Fi ile kendisi kaydediyor[\s\S]{0,80}return;/);
  assert.match(source, /Cihaz Wi-Fi ile kendisi kaydediyor<\/strong>/);
});

test('Kart Atama keeps the Wi-Fi device in assignment mode so added cards are not clocked', () => {
  assert.match(source, /sendFrame\?\.\('assign'\)/);
});

test('Admin page has the Kart Okuyucu Cihazı section; secrets are not persisted or logged', () => {
  assert.match(source, /<h2>Kart Okuyucu Cihazı<\/h2>/);
  assert.match(source, /Cihaza Gönder/);
  assert.match(source, /tab === 'admin' && profile\?\.admin && <AdminPage/);
  const panel = source.slice(source.indexOf('function DeviceSetupPanel'), source.indexOf('function SettingsPage'));
  assert.doesNotMatch(panel, /localStorage|sessionStorage|console\.|setDoc|updateDoc/);
  assert.match(panel, /setForm\(EMPTY_DEVICE_FORM\)/);
  assert.doesNotMatch(panel, /window\.(alert|confirm|prompt)|\balert\(|\bconfirm\(|\bprompt\(/);
  assert.match(panel, /askConfirm\(/);
});

test('Günlük Saatler marks offline-replayed scans in the legend and the cell', () => {
  assert.match(source, /<i className="dot offline" \/> Çevrimdışı okutma/);
  assert.match(source, /shownEntry \? shownEntry\.source === 'offline' : clockIn\?\.source === 'offline'/);
  assert.match(source, /offline-mark/);
});

test('firmware 2.0 keeps the USB protocol, pins and pinned TLS roots', () => {
  assert.match(firmware, /Surum 2\.0/);
  assert.match(firmware, /Serial\.print\("UID:"\)/);
  assert.match(firmware, /Serial\.println\("READY"\)/);
  assert.match(firmware, /constexpr uint8_t PIN_SCK = 18, PIN_MISO = 19, PIN_MOSI = 23;/);
  assert.match(firmware, /constexpr uint8_t TFT_CS = 33, TFT_DC = 26, TFT_RST = 32;/);
  assert.match(firmware, /constexpr uint8_t RFID_SS = 25, RFID_RST = 27;/);
  assert.match(firmware, /constexpr uint8_t RTC_SDA = 21, RTC_SCL = 22;/);
  assert.match(firmware, /constexpr uint8_t BUZZER_PIN = 16;/);
  assert.match(firmware, /BOOT_BUTTON = 0/);
  assert.match(firmware, /setCACert\(/);
  assert.doesNotMatch(firmware, /setInsecure\s*\(/);
  assert.match(firmware, /MODE:WIFI/);
  assert.match(firmware, /PersonelTakip-Kurulum/);
});

// ---- G: çerçeve uzunluğu + CRC32, katı ayrıştırma ----
const hex = text => Array.from(new TextEncoder().encode(text), byte => byte.toString(16).padStart(2, '0')).join('');
const rawFrame = (text, { length, crc } = {}) => {
  const bytes = new TextEncoder().encode(text);
  const header = new Uint8Array(6);
  new DataView(header.buffer).setUint16(0, length ?? bytes.length);
  new DataView(header.buffer).setUint32(2, crc ?? crc32(bytes));
  return `[${Array.from(header, b => b.toString(16).padStart(2, '0')).join('')}${hex(text)}]`;
};

test('G: crc32 matches the IEEE/zlib reference values', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  assert.equal(crc32(new Uint8Array()), 0);
});

test('G: frames carry the UTF-8 length and CRC32 of the text in front of the payload', () => {
  const frame = encodeDeviceFrame('cfg', { ssid: 'Ağ' });
  const text = 'cfg\u001fssid=Ağ';
  const bytes = new TextEncoder().encode(text);
  assert.equal(frame, `[${bytes.length.toString(16).padStart(4, '0')}${crc32(bytes).toString(16).padStart(8, '0')}${hex(text)}]\n`);
  assert.equal(frame, `${rawFrame(text)}\n`);
});

test('G: device parser mirror rejects odd hex, wrong length/CRC, unknown keys/commands, missing separators and duplicates', () => {
  const ok = rawFrame('cfg\u001fssid=Ağ\u001fwpass=sifre1234');
  assert.deepEqual(parseDeviceFrame(ok), { command: 'cfg', fields: { ssid: 'Ağ', wpass: 'sifre1234' } });
  assert.deepEqual(parseDeviceFrame(ok.replace(']', '0]')), { error: 'frame' });                         // tek sayıda onaltılık
  assert.deepEqual(parseDeviceFrame(ok.slice(0, -3) + ']'), { error: 'frame' });                         // eksik bayt (uzunluk tutmaz)
  assert.deepEqual(parseDeviceFrame(rawFrame('cfg\u001fssid=Ağ', { length: 3 })), { error: 'frame' });    // uzunluk yanlış
  assert.deepEqual(parseDeviceFrame(rawFrame('cfg\u001fssid=Ağ', { crc: 1 })), { error: 'frame' });      // CRC yanlış
  const flipped = ok.slice(0, 20) + (ok[20] === '0' ? '1' : '0') + ok.slice(21);
  assert.deepEqual(parseDeviceFrame(flipped), { error: 'frame' });                                       // tek bit bozulması
  assert.deepEqual(parseDeviceFrame(rawFrame('cfg\u001fssid=Ağ\u001ftoken=x')), { error: 'frame' });     // bilinmeyen alan
  assert.deepEqual(parseDeviceFrame(rawFrame('cfg\u001fssidAğ')), { error: 'frame' });                   // "=" yok
  assert.deepEqual(parseDeviceFrame(rawFrame('cfgssid=Ağ')), { error: 'frame' });                        // \x1f yok
  assert.deepEqual(parseDeviceFrame(rawFrame('cfg\u001fssid=')), { error: 'frame' });                    // boş değer
  assert.deepEqual(parseDeviceFrame(rawFrame('cfg\u001fssid=a\u001fssid=b')), { error: 'frame' });       // aynı alan iki kez
  assert.deepEqual(parseDeviceFrame(rawFrame('reboot')), { error: 'frame' });                            // bilinmeyen komut
  assert.deepEqual(parseDeviceFrame(rawFrame('status\u001fssid=x')), { error: 'frame' });                // komut alan almaz
  assert.deepEqual(parseDeviceFrame('[' + hex('cfg\u001fssid=Ağ') + ']'), { error: 'frame' });           // eski (başlıksız) biçim
  assert.deepEqual(parseDeviceFrame('[0000]'), { error: 'frame' });
  assert.match(DEVICE_CFG_ERRORS.frame, /bozuk/);
});

test('G: firmware enlarges the serial RX buffer before Serial.begin and validates length + CRC before applying config', () => {
  const setup = firmwareSource.slice(firmwareSource.indexOf('void setup()'));
  assert.ok(setup.indexOf('Serial.setRxBufferSize(4096)') >= 0 && setup.indexOf('Serial.setRxBufferSize(4096)') < setup.indexOf('Serial.begin(115200)'));
  assert.match(firmwareSource, /crc32Bytes\(/);
  assert.match(firmwareSource, /CFG:ERR:frame/);
  // Önce tamamı doğrulanır, sonra tek seferde (iki yuvalı NVS) kaydedilir.
  assert.match(firmwareSource, /bool saveConfigAtomic\(const Config &next\)/);
  assert.equal(DEVICE_COMMAND_FIELDS.cfg.length, 7);
});

// ---- H: saat yedeği ----
test('H: the admin page can send the PC time; the frame carries only digits; firmware keeps NTP preferred', () => {
  assert.deepEqual(deviceTimeFields(Date.UTC(2026, 10, 10, 9, 0, 5)), { utc: String(Date.UTC(2026, 10, 10, 9, 0, 5) / 1000) });
  assert.deepEqual(decodeDeviceFrame(encodeDeviceFrame('time', deviceTimeFields(1_789_000_000_000))), { command: 'time', fields: { utc: '1789000000' } });
  assert.throws(() => encodeDeviceFrame('time', { ssid: 'x' }), /Bilinmeyen cihaz alanı/);
  assert.match(source, /command\('time', deviceTimeFields\(\)\)/);
  assert.match(firmwareSource, /\"Date\"/);                       // Google yanıtının Date başlığı
  assert.match(firmwareSource, /parseHttpDate\(/);
  assert.match(firmwareSource, /if \(ntpSynced\) \{ Serial\.println\(\"CFG:ERR:time\"\)/);
  assert.equal(parseDeviceLine('STATUS:fw=2.0;clock=ok;tsrc=http').timeSource, 'http');
});

test('A/B: failure reasons for reassigned cards and hand-corrected days are explained in Turkish', () => {
  assert.match(deviceFailText('moved'), /başkasına geçmiş/);
  assert.match(deviceFailText('edited'), /elle düzeltilmiş/);
});
