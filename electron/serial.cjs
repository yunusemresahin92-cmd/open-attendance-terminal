// Masaüstü uygulamasında Kart Listesi'nin USB kart okuyucuya (ESP32 + RC522) bağlanmasına izin verir.
// Electron kendi port seçme penceresini göstermediği için ESP32 USB çipi olan port seçilir.

// CP210x (Silicon Labs), CH340/CH9102 (WCH), FTDI, Espressif yerleşik USB.
const ESP32_USB_VENDORS = ['10c4', '1a86', '0403', '303a'];

// devOrigin yalnız geliştirme sırasında verilir; kurulu uygulamada yalnız kendi dosyaları güvenilirdir.
function isTrustedOrigin(origin, devOrigin) {
  const value = String(origin || '');
  if (value.startsWith('file://')) return true;
  return Boolean(devOrigin) && (value === devOrigin || value === `${devOrigin}/`);
}

// Pencere yalnız uygulamanın kendi dosyalarında (geliştirmede yerel sunucuda) kalır; yeni pencere açılmaz.
function installNavigationGuard(webContents, devOrigin) {
  if (!webContents) return;
  // Kurulu uygulamada yalnız güncelleme ekranı ve uygulamanın kendi dist/index.html dosyası açılabilir.
  const allowed = url => {
    const value = String(url || '');
    if (Boolean(devOrigin) && value.startsWith(`${devOrigin}/`)) return true;
    if (!value.startsWith('file://')) return false;
    let path = value.replace(/[?#].*$/, '');
    try { path = decodeURIComponent(path); } catch { return false; }
    path = path.replace(/\\/g, '/');
    return /\/electron\/update\.html$/.test(path) || /\/dist\/index\.html$/.test(path);
  };
  webContents.on('will-navigate', (event, url) => { if (!allowed(url)) event.preventDefault(); });
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

// Electron vendorId'yi onluk metin olarak verir (CH340: "6790" = 0x1A86). "0x1a86" ya da harf içeren
// "10c4" gibi değerler onaltılık kabul edilir; yalnız rakamlı değer Electron'daki gibi onluktur.
function usbVendorNumber(value) {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0 && value <= 0xffff ? value : null;
  const text = String(value ?? '').trim().toLowerCase();
  let number = null;
  if (/^0x[0-9a-f]{1,4}$/.test(text)) number = parseInt(text.slice(2), 16);
  else if (/^\d{1,5}$/.test(text)) number = parseInt(text, 10);
  else if (/^[0-9a-f]{1,4}$/.test(text)) number = parseInt(text, 16);
  return number != null && number <= 0xffff ? number : null;
}

const ESP32_USB_VENDOR_NUMBERS = ESP32_USB_VENDORS.map(id => parseInt(id, 16));
const isReaderVendor = value => ESP32_USB_VENDOR_NUMBERS.includes(usbVendorNumber(value));

function pickSerialPort(portList) {
  const ports = Array.isArray(portList) ? portList : [];
  // Tanınmayan bir seri cihaz (ör. modem, Bluetooth) kart okuyucu sanılıp açılmaz.
  return ports.find(item => isReaderVendor(item?.vendorId))?.portId || '';
}

function installSerialAccess(session, devOrigin) {
  if (!session) return;
  session.on('select-serial-port', (event, portList, webContents, callback) => {
    event.preventDefault();
    const origin = webContents?.getURL?.() || '';
    callback(isTrustedOrigin(origin, devOrigin) ? pickSerialPort(portList) : '');
  });
  // Uygulamanın ihtiyaç duymadığı izinler reddedilir; seri port yalnız uygulamanın kendi kaynağına açıktır.
  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    if (permission !== 'serial') return false;
    return isTrustedOrigin(details?.securityOrigin || requestingOrigin, devOrigin);
  });
  session.setPermissionRequestHandler?.((_webContents, _permission, callback) => callback(false));
  session.setDevicePermissionHandler(details => details.deviceType === 'serial' && isTrustedOrigin(details.origin, devOrigin));
}

module.exports = { installSerialAccess, installNavigationGuard, pickSerialPort, isTrustedOrigin, usbVendorNumber, ESP32_USB_VENDORS };
