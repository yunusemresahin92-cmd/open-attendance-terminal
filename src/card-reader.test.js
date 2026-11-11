import test from 'node:test';
import assert from 'node:assert/strict';
import { connectCardReader, createLineSplitter, createScanFilter, isReaderPort, parseReaderLine, rememberedReaderPort, READER_USB_VENDOR_IDS } from './card-reader.js';

test('reader lines must carry the UID prefix and a valid card UID', () => {
  assert.equal(parseReaderLine('UID:a1b2c3d4\r'), 'A1B2C3D4');
  assert.equal(parseReaderLine('  UID: 04 A1 B2 C3 D4 E5 F6 '), '04A1B2C3D4E5F6');
  assert.equal(parseReaderLine('READY'), null);
  assert.equal(parseReaderLine('A1B2C3D4'), null);
  assert.equal(parseReaderLine('UID:XYZ'), null);
  assert.equal(parseReaderLine('UID:A1B2C3'), null);
});

test('serial chunks are reassembled into complete lines', () => {
  const lines = [];
  const push = createLineSplitter(line => lines.push(line));
  push('UID:A1B2');
  push('C3D4\r\nREA');
  push('DY\nUID:B1B2C3D4\n');
  assert.deepEqual(lines, ['UID:A1B2C3D4', 'READY', 'UID:B1B2C3D4']);
});

test('overlong garbage without newlines cannot grow the buffer without limit', () => {
  const lines = [];
  const push = createLineSplitter(line => lines.push(line));
  push('x'.repeat(5000));
  push('\nUID:A1B2C3D4\n');
  assert.deepEqual(lines, ['UID:A1B2C3D4']);
});

test('the same card held on the reader is reported once within the repeat window', () => {
  let now = 0;
  const accept = createScanFilter(1500, () => now);
  assert.equal(accept('A1B2C3D4'), true);
  now = 1000;
  assert.equal(accept('A1B2C3D4'), false);
  assert.equal(accept('B1B2C3D4'), true);
  now = 3000;
  assert.equal(accept('A1B2C3D4'), true);
});

test('a connected reader reports each card once, can beep errors and disconnects cleanly', async () => {
  const encoder = new TextEncoder();
  const written = [];
  let feed;
  const port = {
    opened: null, closed: false,
    readable: new ReadableStream({ start(controller) { feed = controller; } }),
    writable: new WritableStream({ write(chunk) { written.push(new TextDecoder().decode(chunk)); } }),
    async open(options) { this.opened = options; },
    async close() { this.closed = true; },
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serial: { requestPort: async () => port } } });
  try {
    const cards = [], states = [], errors = [];
    const reader = await connectCardReader({ onCard: uid => cards.push(uid), onStatus: state => states.push(state), onError: cause => errors.push(cause.message) });
    assert.deepEqual(port.opened, { baudRate: 115200 });
    feed.enqueue(encoder.encode('READY\r\nUID:a1b2'));
    feed.enqueue(encoder.encode('c3d4\r\nUID:A1B2C3D4\r\nERROR:RC522 bulunamadi\r\n'));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(cards, ['A1B2C3D4']);
    assert.match(errors[0], /RC522/);
    await reader.beepError();
    assert.deepEqual(written, ['E']);
    await reader.display('in', ['GİRİŞ', 'Ömer Öz']);
    assert.match(written[1], /^\{[0-9a-f]+\}\n$/);
    assert.equal(/[OE]/.test(written[1]), false);
    await reader.disconnect();
    assert.equal(port.closed, true);
    assert.deepEqual(states, ['connected', 'ready', 'disconnected']);
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator;
  }
});

test('a missing Web Serial API gives a clear Turkish message', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  try { await assert.rejects(connectCardReader({ onCard() {} }), /Chrome veya Edge/); }
  finally { if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator; }
});

test('a brief read error does not drop the reader; it keeps reading on the same port', async () => {
  const encoder = new TextEncoder();
  let streams = 0;
  const port = {
    get readable() {
      streams += 1;
      if (streams > 2) return null;
      return streams === 1
        ? new ReadableStream({ pull(controller) { controller.error(new Error('BufferOverrunError')); } })
        : new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('UID:A1B2C3D4\n')); } });
    },
    writable: new WritableStream(),
    async open() {}, async close() {},
  };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serial: { requestPort: async () => port } } });
  try {
    const cards = [], states = [];
    const reader = await connectCardReader({ onCard: uid => cards.push(uid), onStatus: state => states.push(state) });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(cards, ['A1B2C3D4']);
    assert.equal(states.includes('disconnected'), false);
    await reader.disconnect();
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator;
  }
});

// Windows'ta izinli portlar arasında Bluetooth kulaklık/COM portları da bulunur; yalnız USB okuyucu çipi seçilir.
test('only a known USB reader chip is remembered, requested or opened; Bluetooth ports are ignored', async () => {
  const bluetooth = { getInfo: () => ({}), open: async () => { throw new Error('bluetooth must not be opened'); } };
  const ch340 = { getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }) };
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let requested = null;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serial: {
    getPorts: async () => [bluetooth, ch340],
    requestPort: async options => { requested = options; throw Object.assign(new Error('none'), { name: 'NotFoundError' }); },
  } } });
  try {
    assert.equal(isReaderPort(ch340), true);
    assert.equal(isReaderPort(bluetooth), false);
    assert.equal(isReaderPort({ getInfo: () => { throw new Error('gone'); } }), false);
    assert.equal(isReaderPort(null), false);
    assert.equal(await rememberedReaderPort(), ch340);
    navigator.serial.getPorts = async () => [bluetooth];
    assert.equal(await rememberedReaderPort(), null);
    await assert.rejects(connectCardReader({ port: bluetooth, onCard() {} }), /kart okuyucu değil/);
    await assert.rejects(connectCardReader({ onCard() {} }), /Kart okuyucu seçilmedi/);
    assert.deepEqual(requested, { filters: READER_USB_VENDOR_IDS.map(usbVendorId => ({ usbVendorId })) });
    assert.ok(READER_USB_VENDOR_IDS.includes(0x1a86) && READER_USB_VENDOR_IDS.includes(0x10c4));
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator;
  }
});
