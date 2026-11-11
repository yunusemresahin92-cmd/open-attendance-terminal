import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('retry keeps a previously found mandatory update non-skippable', async () => {
  const source = await readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const updater = new EventEmitter();
  updater.checkForUpdates = () => Promise.resolve();
  const handlers = new Map();
  let didFinishLoad;
  const webContents = {
    once: (event, handler) => { if (event === 'did-finish-load') didFinishLoad = handler; },
    send: () => {}
  };
  class BrowserWindow {
    constructor() { this.webContents = webContents; }
    static getAllWindows() { return []; }
    isDestroyed() { return false; }
    loadFile() {}
    setMenuBarVisibility() {}
  }
  const app = {
    isPackaged: true,
    whenReady: () => Promise.resolve(),
    on: () => {},
    quit: () => {}
  };
  const ipcMain = { handle: (name, handler) => handlers.set(name, handler) };
  const fakeTimeout = () => ({ unref() {} });
  const context = {
    require: (name) => {
      if (name === 'electron') return { app, BrowserWindow, dialog: {}, ipcMain };
      if (name === 'electron-updater') return { autoUpdater: updater };
      if (name === 'path') return { join: (...parts) => parts.join('/') };
      if (name === 'fs/promises') return { writeFile: async () => {} };
      if (name === './serial.cjs') return { installSerialAccess: () => {}, installNavigationGuard: () => {} };
      throw new Error(`Unexpected module: ${name}`);
    },
    __dirname: 'electron',
    Buffer,
    process: { platform: process.platform, env: { OPEN_ATTENDANCE_UPDATES: '1' } },
    setTimeout: fakeTimeout,
    clearTimeout: () => {},
    setInterval: fakeTimeout,
    clearInterval: () => {},
    setImmediate
  };
  vm.runInNewContext(source, context, { filename: 'electron/main.cjs' });
  await Promise.resolve();
  didFinishLoad();
  updater.emit('update-available', { version: '0.2.15' });
  updater.emit('error', new Error('download failed'));
  assert.equal(handlers.get('get-update-status')().canSkip, false);

  updater.checkForUpdates = () => Promise.reject(new Error('retry failed'));
  handlers.get('retry-update')();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(handlers.get('get-update-status')().canSkip, false);
});

test('update-not-available after a mandatory update retry does not open the application', async () => {
  const source = await readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const updater = new EventEmitter();
  updater.checkForUpdates = () => Promise.resolve();
  const handlers = new Map();
  const loadedFiles = [];
  let didFinishLoad;
  const webContents = {
    once: (event, handler) => { if (event === 'did-finish-load') didFinishLoad = handler; },
    send: () => {}
  };
  class BrowserWindow {
    constructor() { this.webContents = webContents; }
    static getAllWindows() { return []; }
    isDestroyed() { return false; }
    loadFile(file) { loadedFiles.push(file); }
    setMenuBarVisibility() {}
  }
  const app = {
    isPackaged: true,
    whenReady: () => Promise.resolve(),
    on: () => {},
    quit: () => {}
  };
  const ipcMain = { handle: (name, handler) => handlers.set(name, handler) };
  const fakeTimeout = () => ({ unref() {} });
  const context = {
    require: (name) => {
      if (name === 'electron') return { app, BrowserWindow, dialog: {}, ipcMain };
      if (name === 'electron-updater') return { autoUpdater: updater };
      if (name === 'path') return { join: (...parts) => parts.join('/') };
      if (name === 'fs/promises') return { writeFile: async () => {} };
      if (name === './serial.cjs') return { installSerialAccess: () => {}, installNavigationGuard: () => {} };
      throw new Error(`Unexpected module: ${name}`);
    },
    __dirname: 'electron',
    Buffer,
    process: { platform: process.platform, env: { OPEN_ATTENDANCE_UPDATES: '1' } },
    setTimeout: fakeTimeout,
    clearTimeout: () => {},
    setInterval: fakeTimeout,
    clearInterval: () => {},
    setImmediate
  };
  vm.runInNewContext(source, context, { filename: 'electron/main.cjs' });
  await Promise.resolve();
  didFinishLoad();
  updater.emit('update-available', { version: '0.2.15' });
  updater.emit('error', new Error('download failed'));
  handlers.get('retry-update')();
  updater.emit('update-not-available');

  assert.deepEqual(loadedFiles, ['electron/update.html']);
  assert.equal(handlers.get('get-update-status')().canSkip, false);
});

test('public packaged build opens locally without contacting an update provider', async () => {
  const source = await readFile(new URL('../electron/main.cjs', import.meta.url), 'utf8');
  const updater = new EventEmitter();
  let updateChecks = 0;
  updater.checkForUpdates = () => { updateChecks += 1; return Promise.resolve(); };
  const loadedFiles = [];
  const handlers = new Map();
  const webContents = {
    once: () => { throw new Error('disabled updater must not register a load-triggered check'); },
    send: () => {}
  };
  class BrowserWindow {
    constructor() { this.webContents = webContents; }
    static getAllWindows() { return []; }
    isDestroyed() { return false; }
    loadFile(file) { loadedFiles.push(file); }
    setMenuBarVisibility() {}
  }
  const app = { isPackaged: true, whenReady: () => Promise.resolve(), on: () => {}, quit: () => {} };
  const context = {
    require: (name) => {
      if (name === 'electron') return { app, BrowserWindow, dialog: {}, ipcMain: { handle: (key, value) => handlers.set(key, value) }, session: {} };
      if (name === 'electron-updater') return { autoUpdater: updater };
      if (name === 'path') return { join: (...parts) => parts.join('/') };
      if (name === 'fs/promises') return { writeFile: async () => {} };
      if (name === './serial.cjs') return { installSerialAccess: () => {}, installNavigationGuard: () => {} };
      throw new Error(`Unexpected module: ${name}`);
    },
    __dirname: 'electron',
    Buffer,
    process: { platform: process.platform, env: {} },
    setTimeout: () => ({ unref() {} }),
    clearTimeout: () => {},
    setInterval: () => ({ unref() {} }),
    clearInterval: () => {},
    setImmediate
  };
  vm.runInNewContext(source, context, { filename: 'electron/main.cjs' });
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(loadedFiles, ['electron/../dist/index.html']);
  assert.equal(updateChecks, 0);
  assert.equal(handlers.get('get-update-status')().state, 'disabled');
});
