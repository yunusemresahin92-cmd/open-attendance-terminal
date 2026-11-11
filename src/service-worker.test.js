import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build, loadConfigFromFile } from 'vite';
import { precacheManifest } from '../scripts/vite-precache.mjs';

async function runNavigationFetch(response) {
  const listeners = {};
  const cachedWrites = [];
  let responsePromise;
  const context = {
    URL,
    Request,
    Headers,
    fetch: async () => response,
    caches: {
      open: async () => ({ put: async (key, value) => cachedWrites.push({ key, value }) }),
      match: async () => null,
      keys: async () => [],
      delete: async () => true,
    },
    self: {
      location: { origin: 'https://app.test' },
      addEventListener: (type, listener) => { listeners[type] = listener; },
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
  };
  vm.runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  listeners.fetch({
    request: { method: 'GET', url: 'https://app.test/personel', mode: 'navigate' },
    respondWith: promise => { responsePromise = promise; },
  });
  await responsePromise;
  await new Promise(resolve => setImmediate(resolve));
  return cachedWrites;
}

async function runLifecycle({ html, cacheKeys = [] }) {
  const listeners = {};
  const added = [];
  const deleted = [];
  const context = {
    URL, Request,
    fetch: async request => {
      const url = typeof request === 'string' ? request : request.url;
      if (String(url).includes('index.html')) return { ok: true, text: async () => html };
      return { ok: true, clone() { return this; } };
    },
    caches: {
      open: async () => ({
        addAll: async requests => added.push(...requests.map(request => request.url)),
        put: async key => added.push(typeof key === 'string' ? key : key.url),
      }),
      match: async () => null,
      keys: async () => cacheKeys,
      delete: async key => { deleted.push(key); return true; },
    },
    self: {
      location: { origin: 'https://app.test' },
      addEventListener: (type, listener) => { listeners[type] = listener; },
      skipWaiting: async () => {}, clients: { claim: async () => {} },
    },
  };
  vm.runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  let promise;
  listeners.install({ waitUntil: value => { promise = value; } });
  await promise;
  listeners.activate({ waitUntil: value => { promise = value; } });
  await promise;
  return { added, deleted };
}

test('failed navigation responses never replace the cached application shell', async () => {
  const response = { ok: false, status: 503, clone: () => ({ status: 503 }) };
  assert.deepEqual(await runNavigationFetch(response), []);
});

test('navigation responses that are not HTML never replace the cached application shell', async () => {
  const response = { ok: true, status: 200, headers: new Headers({ 'content-type': 'image/png' }), clone: () => ({ status: 200 }) };
  assert.deepEqual(await runNavigationFetch(response), []);
});

test('runtime asset caching rejects HTML rewrite fallbacks', async () => {
  const listeners = {};
  const cachedWrites = [];
  let responsePromise;
  const response = { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }), clone() { return this; } };
  vm.runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    URL, Request, Headers,
    fetch: async () => response,
    caches: { open: async () => ({ put: async key => cachedWrites.push(key) }), match: async () => null, keys: async () => [], delete: async () => true },
    self: { location: { origin: 'https://app.test' }, addEventListener: (type, listener) => { listeners[type] = listener; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
  });
  listeners.fetch({ request: { method: 'GET', url: 'https://app.test/assets/old-chunk-ABC.js', mode: 'cors' }, respondWith: promise => { responsePromise = promise; } });
  await responsePromise;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(cachedWrites, []);
});

test('successful navigation responses refresh the cached application shell', async () => {
  const copy = { status: 200 };
  const response = { ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }), clone: () => copy };
  assert.deepEqual(await runNavigationFetch(response), [{ key: './index.html', value: copy }]);
});

test('first successful install caches hashed JavaScript and CSS referenced by index.html', async () => {
  const html = '<link rel="stylesheet" href="/assets/index-abc123.css"><script type="module" src="/assets/index-def456.js"></script>';
  const result = await runLifecycle({ html });
  assert.ok(result.added.some(url => url.endsWith('/assets/index-abc123.css')));
  assert.ok(result.added.some(url => url.endsWith('/assets/index-def456.js')));
});

test('activation deletes only caches owned by this application', async () => {
  const result = await runLifecycle({ html: '', cacheKeys: ['personel-takip-v1', 'personel-takip-v5', 'other-app-v1'] });
  assert.deepEqual(result.deleted, ['personel-takip-v1']);
});

async function listFiles(dir, prefix = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await listFiles(join(dir, entry.name), relative));
    else out.push(relative);
  }
  return out;
}

async function buildFixture() {
  const root = await mkdtemp(join(tmpdir(), 'sw-precache-'));
  const write = async (file, content) => {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), content);
  };
  await write('index.html', '<!doctype html><html><head></head><body><script type="module" src="/src/main.js"></script></body></html>');
  await write('src/main.js', "import './style.css';\nimport { a } from './a.js';\nconsole.log(a);\nexport const load = () => import('./lazy.js');\nload();\n");
  await write('src/a.js', "import { b } from './nested/b.js';\nexport const a = 'a' + b;\n");
  await write('src/nested/b.js', "export const b = 'b';\n");
  await write('src/style.css', "body { background: url('./bg.png'); }\n");
  await write('src/lazy.js', "import logo from './logo.png';\nexport const deep = () => import('./deep.js');\nexport default logo;\n");
  await write('src/deep.js', "export default 'deep';\n");
  const png = await readFile(new URL('../public/icons/favicon-64.png', import.meta.url));
  await write('src/logo.png', png);
  await write('src/bg.png', Buffer.concat([png, Buffer.from('bg')]));
  await write('public/sw.js', await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'));
  const outDir = join(root, 'dist');
  await build({
    root, configFile: false, logLevel: 'silent', base: './', plugins: [precacheManifest()],
    build: { outDir, emptyOutDir: true, minify: false, assetsInlineLimit: 0 },
  });
  return { root, outDir };
}

async function installFrom(swSource, html, cacheKeys = []) {
  const listeners = {};
  const added = [];
  const fetched = [];
  const deleted = [];
  const opened = [];
  const context = {
    URL, Request,
    fetch: async request => {
      fetched.push(request);
      const url = typeof request === 'string' ? request : request.url;
      if (String(url).endsWith('/index.html')) return { ok: true, text: async () => html };
      return { ok: true, clone() { return this; } };
    },
    caches: {
      open: async name => {
        opened.push(name);
        return {
          addAll: async requests => added.push(...requests.map(request => new URL(request.url).pathname)),
          put: async () => {},
        };
      },
      match: async () => null,
      keys: async () => cacheKeys,
      delete: async key => { deleted.push(key); return true; },
    },
    self: {
      location: { origin: 'https://app.test' },
      addEventListener: (type, listener) => { listeners[type] = listener; },
      skipWaiting: async () => {}, clients: { claim: async () => {} },
    },
  };
  vm.runInNewContext(swSource, context);
  let promise;
  listeners.install({ waitUntil: value => { promise = value; } });
  await promise;
  listeners.activate({ waitUntil: value => { promise = value; } });
  await promise;
  return { added, fetched, deleted, opened };
}

test('production build precaches the whole Vite asset graph, including nested and dynamic imports', async () => {
  const { root, outDir } = await buildFixture();
  try {
    const html = await readFile(join(outDir, 'index.html'), 'utf8');
    const assets = (await listFiles(join(outDir, 'assets'))).map(file => `/assets/${file}`);
    const jsAssets = assets.filter(file => file.endsWith('.js'));
    // Fixture sanity: dynamic chunks and images are not referenced directly by index.html.
    assert.ok(jsAssets.length >= 3, `expected entry + dynamic chunks, got ${jsAssets.join(', ')}`);
    assert.ok(jsAssets.some(file => !html.includes(file.slice(1))), 'fixture must contain a JS chunk not referenced by index.html');
    assert.equal(assets.filter(file => file.endsWith('.png')).length, 2);
    assert.ok(assets.some(file => file.endsWith('.css')));

    const result = await installFrom(await readFile(join(outDir, 'sw.js'), 'utf8'), html);
    for (const asset of assets) assert.ok(result.added.includes(asset), `${asset} was not precached`);
    for (const shell of ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png']) {
      assert.ok(result.added.includes(shell), `${shell} was not precached`);
    }
    // Every install request bypasses the browser HTTP cache.
    assert.ok(result.fetched.every(request => typeof request !== 'string' && request.cache === 'reload'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('each production build uses its own versioned cache and removes only older app caches', async () => {
  const { root, outDir } = await buildFixture();
  try {
    const sw = await readFile(join(outDir, 'sw.js'), 'utf8');
    const result = await installFrom(sw, await readFile(join(outDir, 'index.html'), 'utf8'), ['personel-takip-v5', 'other-app-v1']);
    const [cacheName] = result.opened;
    assert.match(cacheName, /^personel-takip-[0-9a-f]{12}$/);
    assert.deepEqual(result.deleted, ['personel-takip-v5']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the app Vite config injects the precache manifest into the service worker', async () => {
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, fileURLToPath(new URL('../vite.config.js', import.meta.url)));
  const names = loaded.config.plugins.flat(Infinity).filter(Boolean).map(plugin => plugin.name);
  assert.ok(names.includes('attendance-precache-manifest'), `plugins: ${names.join(', ')}`);
});
