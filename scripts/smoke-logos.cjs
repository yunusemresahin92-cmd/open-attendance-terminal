const { app, BrowserWindow } = require('electron');
const { mkdtempSync, readdirSync, rmSync, realpathSync } = require('fs');
const { join, sep } = require('path');
const { tmpdir } = require('os');

const temporaryData = mkdtempSync(join(tmpdir(), 'brand-logo-smoke-'));
app.setPath('userData', temporaryData);

async function main() {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const dist = join(__dirname, '..', 'dist');
  const entry = process.argv.includes('--packaged')
    ? join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'app.asar', 'dist', 'index.html')
    : join(dist, 'index.html');
  const images = readdirSync(join(dist, 'assets')).filter(name => /^(app-logo|brand-logo)-.*\.png$/.test(name));
  if (images.length !== 2) throw new Error(`İki logo bekleniyordu, ${images.length} bulundu.`);
  await window.loadFile(entry);
  const result = await window.webContents.executeJavaScript(`Promise.all(${JSON.stringify(images)}.map(name => new Promise(resolve => {
    const image = new Image();
    image.onload = () => resolve({ name, width: image.naturalWidth, loaded: true });
    image.onerror = () => resolve({ name, width: 0, loaded: false });
    image.src = './assets/' + name;
  })))`);
  console.log(JSON.stringify(result));
  if (result.some(item => !item.loaded || !item.width)) throw new Error('Kurulu uygulama logosu yüklenemedi.');
}

app.whenReady().then(main).then(() => app.exit(0)).catch(error => {
  console.error(error);
  app.exit(1);
});

app.on('quit', () => {
  const root = realpathSync(tmpdir());
  const target = realpathSync(temporaryData);
  if (target.startsWith(root + sep)) rmSync(target, { recursive: true, force: true });
});
