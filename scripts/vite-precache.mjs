// Derleme sonrası dist/sw.js içine tüm Vite çıktılarının (giriş, statik/dinamik parçalar, CSS, görseller)
// listesini ve içerikten türetilen sürüm kimliğini yazar. Böylece servis çalışanı çevrimdışı açılış için
// gereken her dosyayı tarayıcının HTTP önbelleğine güvenmeden kurulumda indirir.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const PRECACHE_PLACEHOLDER = '/*__PRECACHE_MANIFEST__*/null';

export function precacheManifest({ serviceWorker = 'sw.js' } = {}) {
  let outDir;
  let manifest;
  return {
    name: 'attendance-precache-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    generateBundle(_options, bundle) {
      const items = Object.values(bundle).sort((a, b) => a.fileName.localeCompare(b.fileName));
      const assets = items.map(item => item.fileName).filter(file => file !== 'index.html' && !file.endsWith('.map'));
      const hash = createHash('sha256');
      for (const item of items) {
        hash.update(item.fileName).update('\0').update(item.type === 'chunk' ? item.code : item.source).update('\0');
      }
      manifest = { version: hash.digest('hex').slice(0, 12), assets };
    },
    async writeBundle() {
      const file = resolve(outDir, serviceWorker);
      const source = await readFile(file, 'utf8');
      if (!source.includes(PRECACHE_PLACEHOLDER)) throw new Error(`${serviceWorker} içinde ${PRECACHE_PLACEHOLDER} bulunamadı.`);
      await writeFile(file, source.replace(PRECACHE_PLACEHOLDER, JSON.stringify(manifest)));
    },
  };
}
