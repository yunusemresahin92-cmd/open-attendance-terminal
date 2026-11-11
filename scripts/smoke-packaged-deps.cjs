const { join } = require('node:path');
const { existsSync } = require('node:fs');
const asar = require('@electron/asar');

const asarPath = join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'app.asar');
if (!existsSync(asarPath)) {
  console.error(`Paket bulunamadı: ${asarPath}`);
  process.exit(1);
}

const files = new Set(asar.listPackage(asarPath).map(file => file.replaceAll('\\', '/').replace(/^\//, '')));
const requiredPackages = [
  'electron-updater',
  'builder-util-runtime',
  'fs-extra',
  'js-yaml',
  'lazy-val',
  'lodash.escaperegexp',
  'lodash.isequal',
  'semver',
  'tiny-typed-emitter',
];
const missing = requiredPackages.filter(name => !files.has(`node_modules/${name}/package.json`));
if (missing.length) {
  console.error(`Windows paketinde çalışma zamanı bağımlılıkları eksik: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`Windows paket bağımlılık testi başarılı (${requiredPackages.length}/${requiredPackages.length}).`);
