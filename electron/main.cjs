const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const { join } = require('path');
const { writeFile } = require('fs/promises');
const { autoUpdater } = require('electron-updater');
const { installNavigationGuard, installSerialAccess } = require('./serial.cjs');
const DEV_ORIGIN = 'http://127.0.0.1:5173';
// Public builds start without contacting a release server. Maintainers may opt
// in only after packaging with a trusted update provider.
const UPDATES_ENABLED = process.env.OPEN_ATTENDANCE_UPDATES === '1';

let mainWindow;
let status = UPDATES_ENABLED
  ? { state: 'checking', message: 'Yeni sürüm kontrol ediliyor…' }
  : { state: 'disabled', message: 'Otomatik güncelleme bu derlemede kapalı.' };
let checking = false;
let installing = false;
let updateFound = false; // Açılışta yeni sürüm bulunduysa güncelleme zorunludur, atlanamaz.
let skipped = false;     // Kullanıcı kontrol hatasında güncellemeden devam etti.
let running = false;     // Uygulama ekranı açık: güncellemeler arka planda indirilir, çalışma kesilmez.
let readyVersion = null; // Arka planda indirilip kurulmayı bekleyen sürüm.
let checkTimer = null;
let stallTimer = null;
let backgroundTimer = null;
const CHECK_TIMEOUT_MS = 60_000;
const DOWNLOAD_STALL_MS = 120_000;
const BACKGROUND_CHECK_MS = 30 * 60_000;

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}
function setStatus(next) {
  status = next;
  send('update-status', next);
}
function clearTimers() {
  clearTimeout(checkTimer); checkTimer = null;
  clearTimeout(stallTimer); stallTimer = null;
}
function openApplication() {
  running = true;
  clearTimers();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadFile(join(__dirname, '..', 'dist', 'index.html'));
  if (UPDATES_ENABLED) {
    // Gün boyu açık kalan bilgisayarlar da yeni sürümü alsın.
    clearInterval(backgroundTimer);
    backgroundTimer = setInterval(backgroundCheck, BACKGROUND_CHECK_MS);
  }
}
function fail(message) {
  clearTimers();
  checking = false;
  if (installing || running) return; // Arka plan kontrolündeki hatalar çalışmayı etkilemez.
  setStatus({ state: 'error', message, canSkip: !updateFound });
}
function watchDownload() {
  clearTimeout(stallTimer);
  stallTimer = setTimeout(() => fail('Güncelleme indirmesi ilerlemiyor. İnternet bağlantısını kontrol edip tekrar deneyin.'), DOWNLOAD_STALL_MS);
}
function checkForUpdates() {
  if (!UPDATES_ENABLED) return;
  if (checking || installing || running) return;
  checking = true;
  setStatus({ state: 'checking', message: 'Yeni sürüm kontrol ediliyor…' });
  clearTimeout(checkTimer);
  checkTimer = setTimeout(() => fail('Güncelleme sunucusu yanıt vermedi. İnternet bağlantısını kontrol edin.'), CHECK_TIMEOUT_MS);
  autoUpdater.checkForUpdates().catch((error) => fail(`Güncelleme kontrol edilemedi: ${error.message}`));
}
function backgroundCheck() {
  if (!UPDATES_ENABLED || !app.isPackaged || !running || installing || readyVersion || checking) return;
  checking = true;
  autoUpdater.checkForUpdates().catch(() => { checking = false; }).finally(() => { checking = false; });
}
function skipUpdate() {
  if (!UPDATES_ENABLED || !app.isPackaged || status.state !== 'error' || !status.canSkip || updateFound || installing) return false;
  skipped = true;
  setStatus({ state: 'skipped', message: 'Güncelleme kontrolü atlandı.' });
  openApplication();
  return true;
}
function installNow() {
  if (!UPDATES_ENABLED || !readyVersion || installing) return false;
  installing = true;
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return true;
}
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1100, minHeight: 700,
    backgroundColor: '#f6f7f9',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  mainWindow.setMenuBarVisibility(false);
  installNavigationGuard(mainWindow.webContents, app.isPackaged ? null : DEV_ORIGIN);
  if (app.isPackaged && UPDATES_ENABLED) {
    mainWindow.loadFile(join(__dirname, 'update.html'));
    mainWindow.webContents.once('did-finish-load', checkForUpdates);
  } else if (app.isPackaged) openApplication();
  else mainWindow.loadURL(DEV_ORIGIN);
}

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.on('update-available', (info) => {
  clearTimeout(checkTimer);
  checking = false;
  if (running) return; // Arka planda sessizce indirilir.
  updateFound = true;
  setStatus({ state: 'downloading', message: `${info.version} sürümü indiriliyor…`, percent: 0 });
  watchDownload();
});
autoUpdater.on('download-progress', (progress) => {
  if (running || installing) return;
  watchDownload();
  setStatus({ state: 'downloading', message: 'Yeni sürüm indiriliyor…', percent: Math.round(progress.percent) });
});
autoUpdater.on('update-downloaded', (info) => {
  clearTimers();
  if (running) {
    // Çalışan uygulamayı kesme: kullanıcıya haber ver; kapatınca da kurulsun.
    readyVersion = info.version;
    autoUpdater.autoInstallOnAppQuit = true;
    send('update-ready', readyVersion);
    return;
  }
  installing = true;
  setStatus({ state: 'installing', message: 'Güncelleme kuruluyor. Uygulama yeniden açılacak…', percent: 100 });
  setTimeout(() => autoUpdater.quitAndInstall(false, true), 800);
});
autoUpdater.on('update-not-available', () => {
  clearTimeout(checkTimer);
  checking = false;
  if (running) return;
  if (updateFound) {
    fail('Zorunlu güncelleme tamamlanamadı. İnternet bağlantısını kontrol edip tekrar deneyin.');
    return;
  }
  setStatus({ state: 'ready', message: 'Uygulama güncel.' });
  openApplication();
});
autoUpdater.on('error', (error) => fail(`Güncelleme tamamlanamadı: ${error.message}`));

app.whenReady().then(() => {
  ipcMain.handle('save-xlsx', async (_event, { filename, bytes }) => {
    const safeName = String(filename).replace(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ._ -]/g, '_').slice(0, 120);
    const result = await dialog.showSaveDialog({ defaultPath: safeName, filters: [{ name: 'Excel Çalışma Kitabı', extensions: ['xlsx'] }] });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, Buffer.from(bytes));
    return true;
  });
  ipcMain.handle('get-update-status', () => status);
  ipcMain.handle('retry-update', () => { if (UPDATES_ENABLED && app.isPackaged && status.state === 'error') checkForUpdates(); });
  ipcMain.handle('skip-update', () => skipUpdate());
  ipcMain.handle('get-update-ready', () => readyVersion);
  ipcMain.handle('install-update', () => installNow());
  installSerialAccess(session?.defaultSession, app.isPackaged ? null : DEV_ORIGIN);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
