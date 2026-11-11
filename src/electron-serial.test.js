import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { installNavigationGuard, installSerialAccess, pickSerialPort, isTrustedOrigin, usbVendorNumber } = require('../electron/serial.cjs');
const DEV = 'http://127.0.0.1:5173';

test('the ESP32 USB serial chip is preferred over other serial ports', () => {
  assert.equal(pickSerialPort([{ portId: 'bt', vendorId: '' }, { portId: 'esp', vendorId: '10C4' }]), 'esp');
  assert.equal(pickSerialPort([{ portId: 'ch340', vendorId: '0x1a86' }]), 'ch340');
  assert.equal(pickSerialPort([{ portId: 'other', vendorId: '1234' }]), '');
  assert.equal(pickSerialPort([]), '');
});

// Electron'un gerçek select-serial-port listesi (Windows, CH340 takılı): vendorId onluk metindir.
test('Electron decimal vendor ids select the reader and never a Bluetooth port', () => {
  const realList = [
    { portId: 'headset', portName: '40:58:99:37:D6:F8', displayName: 'G435 Bluetooth Gaming Headset' },
    { portId: 'com3', portName: 'COM3', displayName: 'Bluetooth Çevre Aygıtı' },
    { portId: 'com4', portName: 'COM4', displayName: 'Bluetooth Serial Port' },
    { portId: 'com5', portName: 'COM5', displayName: 'USB Serial', vendorId: '6790', productId: '29987' },
  ];
  assert.equal(pickSerialPort(realList), 'com5');
  assert.equal(pickSerialPort(realList.slice(0, 3)), '');
  assert.equal(pickSerialPort([{ portId: 'cp210x', vendorId: '4292' }]), 'cp210x');
  assert.equal(pickSerialPort([{ portId: 'ftdi', vendorId: '1027' }]), 'ftdi');
  assert.equal(pickSerialPort([{ portId: 'espressif', vendorId: '12346' }]), 'espressif');
  assert.equal(usbVendorNumber('6790'), 0x1a86);
  assert.equal(usbVendorNumber('0x1A86'), 0x1a86);
  assert.equal(usbVendorNumber('1a86'), 0x1a86);
  assert.equal(usbVendorNumber(0x1a86), 0x1a86);
  // Yalnız rakamlı metin Electron gibi onluk okunur: "0403" FTDI (0x0403 = 1027) sayılmaz.
  assert.equal(pickSerialPort([{ portId: 'not-ftdi', vendorId: '0403' }]), '');
  for (const bad of ['', '70000', '0x12345', 'xyz', null, undefined, -1, 1.5]) assert.equal(usbVendorNumber(bad), null);
});

test('only the packaged app files and the local dev server may use the serial reader', () => {
  assert.equal(isTrustedOrigin('file:///', DEV), true);
  assert.equal(isTrustedOrigin('http://127.0.0.1:5173/', DEV), true);
  assert.equal(isTrustedOrigin('https://evil.example', DEV), false);

  const handlers = {};
  const session = {
    on: (name, handler) => { handlers[name] = handler; },
    setPermissionCheckHandler: handler => { handlers.check = handler; },
    setDevicePermissionHandler: handler => { handlers.device = handler; },
  };
  installSerialAccess(session, DEV);
  let prevented = false, chosen = null;
  const ports = [{ portId: 'esp', vendorId: '10c4' }];
  handlers['select-serial-port']({ preventDefault: () => { prevented = true; } }, ports, { getURL: () => 'https://evil.example/' }, id => { chosen = id; });
  assert.equal(prevented, true);
  assert.equal(chosen, '');
  handlers['select-serial-port']({ preventDefault() {} }, ports, { getURL: () => 'file:///C:/app/dist/index.html' }, id => { chosen = id; });
  assert.equal(chosen, 'esp');
  assert.equal(handlers.check(null, 'serial', 'https://evil.example', { securityOrigin: 'https://evil.example' }), false);
  assert.equal(handlers.check(null, 'serial', 'file:///', { securityOrigin: 'file:///' }), true);
  assert.equal(handlers.check(null, 'geolocation', 'file:///', { securityOrigin: 'file:///' }), false);
  assert.equal(handlers.check(null, 'media', 'file:///', { securityOrigin: 'file:///' }), false);
  assert.equal(handlers.device({ deviceType: 'serial', origin: 'file://' }), true);
  assert.equal(handlers.device({ deviceType: 'usb', origin: 'file://' }), false);
});

test('the installed app trusts only its own files, not the dev server', () => {
  assert.equal(isTrustedOrigin('http://127.0.0.1:5173', null), false);
  assert.equal(isTrustedOrigin('null/', null), false);
  assert.equal(isTrustedOrigin('file:///', null), true);
});

test('the window cannot navigate away from the app or open new windows', () => {
  const handlers = {};
  let openHandler;
  installNavigationGuard({ on: (name, handler) => { handlers[name] = handler; }, setWindowOpenHandler: handler => { openHandler = handler; } }, null);
  const navigate = url => { let prevented = false; handlers['will-navigate']({ preventDefault: () => { prevented = true; } }, url); return prevented; };
  assert.equal(navigate('https://evil.example/'), true);
  assert.equal(navigate('http://127.0.0.1:5173/'), true);
  assert.equal(navigate('file:///C:/app/dist/index.html'), false);
  assert.equal(navigate('file:///C:/app/dist/index.html#/cards'), false);
  assert.equal(navigate('file:///C:/app/electron/update.html'), false);
  assert.equal(navigate('file:///C:/Users/someone/Desktop/other.html'), true);
  assert.deepEqual(openHandler({ url: 'https://evil.example' }), { action: 'deny' });
});
