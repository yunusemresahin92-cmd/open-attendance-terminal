import test from 'node:test';
import assert from 'node:assert/strict';
import { createReaderReconnectCoordinator } from './reader-reconnect.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('a same-port replug is retained until the old reader has fully closed', async () => {
  const port = { id: 'usb' };
  const events = [];
  let releaseClose;
  const readers = [];
  const coordinator = createReaderReconnectCoordinator({
    async open(target, disconnected) {
      events.push(`open-${readers.length + 1}`);
      const reader = {
        port: target,
        disconnected,
        async disconnect() {
          events.push('close-start');
          await new Promise(resolve => { releaseClose = resolve; });
          events.push('close-end');
          disconnected();
        },
      };
      readers.push(reader);
      return reader;
    },
  });
  await coordinator.connect(port);
  const reconnecting = coordinator.portConnected(port);
  const disconnecting = coordinator.portDisconnected(port);
  await tick();
  assert.deepEqual(events, ['open-1', 'close-start']);
  releaseClose();
  await Promise.all([reconnecting, disconnecting]);
  assert.deepEqual(events, ['open-1', 'close-start', 'close-end', 'open-2']);
  assert.equal(coordinator.currentReader(), readers[1]);
});

test('a stale disconnect for the same Web Serial object cannot close an already opened replacement', async () => {
  const port = { id: 'usb' };
  const readers = [];
  const coordinator = createReaderReconnectCoordinator({
    async open(target, disconnected) {
      const reader = {
        port: target,
        disconnected,
        closed: false,
        async disconnect() { this.closed = true; disconnected(); },
      };
      readers.push(reader);
      return reader;
    },
  });

  await coordinator.connect(port);
  await coordinator.portConnected(port);
  assert.equal(coordinator.currentReader(), readers[1]);

  await coordinator.portDisconnected(port);

  assert.equal(readers[1].closed, false);
  assert.equal(coordinator.currentReader(), readers[1]);

  await coordinator.portDisconnected(port);
  assert.equal(readers[1].closed, true);
  assert.equal(coordinator.currentReader(), null);
});

test('an observed browser disconnect before reconnect cannot swallow the replacement disconnect during stabilization', async () => {
  const port = { id: 'usb' };
  const readers = [];
  const coordinator = createReaderReconnectCoordinator({
    setTimer(callback) {
      return callback;
    },
    clearTimer() {},
    async open(target, disconnected) {
      const reader = {
        port: target,
        disconnected,
        closed: false,
        async disconnect() { this.closed = true; disconnected(); },
      };
      readers.push(reader);
      return reader;
    },
  });

  await coordinator.connect(port);
  readers[0].disconnected();
  await coordinator.portDisconnected(port);
  await coordinator.portConnected(port);
  assert.equal(coordinator.currentReader(), readers[1]);

  await coordinator.portDisconnected(port);
  assert.equal(readers[1].closed, true);
  assert.equal(coordinator.currentReader(), null);
});

test('a delayed browser disconnect from a reader-ended generation cannot close its same-port replacement', async () => {
  const port = { id: 'usb' };
  const readers = [];
  const coordinator = createReaderReconnectCoordinator({
    async open(target, disconnected) {
      const reader = {
        port: target,
        disconnected,
        closed: false,
        async disconnect() { this.closed = true; disconnected(); },
      };
      readers.push(reader);
      return reader;
    },
  });

  await coordinator.connect(port);
  readers[0].disconnected();
  await coordinator.portConnected(port);
  assert.equal(coordinator.currentReader(), readers[1]);

  await coordinator.portDisconnected(port);
  assert.equal(readers[1].closed, false);
  assert.equal(coordinator.currentReader(), readers[1]);

  await coordinator.portDisconnected(port);
  assert.equal(readers[1].closed, true);
  assert.equal(coordinator.currentReader(), null);

  await coordinator.portConnected(port);
  assert.equal(readers[2].closed, false);
  assert.equal(coordinator.currentReader(), readers[2]);
});

test('a reader-ended generation without browser connect evidence cannot swallow a later real disconnect', async () => {
  const port = { id: 'usb' };
  const readers = [];
  const coordinator = createReaderReconnectCoordinator({
    async open(target, disconnected) {
      const reader = {
        port: target,
        disconnected,
        closed: false,
        async disconnect() { this.closed = true; disconnected(); },
      };
      readers.push(reader);
      return reader;
    },
  });

  await coordinator.connect(port);
  readers[0].disconnected();
  await coordinator.connect(port);
  assert.equal(coordinator.currentReader(), readers[1]);

  await coordinator.portDisconnected(port);
  assert.equal(readers[1].closed, true);
  assert.equal(coordinator.currentReader(), null);
});

test('an opening generation ended before open resolves is matched only after a later browser connect', async () => {
  const port = { id: 'usb' };
  const readers = [];
  let resolveFirstOpen;
  const coordinator = createReaderReconnectCoordinator({
    open(target, disconnected) {
      const reader = {
        port: target,
        disconnected,
        closed: false,
        async disconnect() { this.closed = true; },
      };
      readers.push(reader);
      if (readers.length === 1) {
        disconnected();
        return new Promise(resolve => { resolveFirstOpen = () => resolve(reader); });
      }
      return Promise.resolve(reader);
    },
  });

  const firstConnect = coordinator.connect(port);
  await tick();
  resolveFirstOpen();
  await firstConnect;
  assert.equal(coordinator.currentReader(), null);

  await coordinator.portConnected(port);
  assert.equal(coordinator.currentReader(), readers[1]);

  await coordinator.portDisconnected(port);
  assert.equal(readers[1].closed, false);
  assert.equal(coordinator.currentReader(), readers[1]);

  await coordinator.portDisconnected(port);
  assert.equal(readers[1].closed, true);
  assert.equal(coordinator.currentReader(), null);
});

test('failed replacement clears causal stale markers before a direct reconnect', async () => {
  const port = { id: 'usb' };
  const readers = [];
  let attempts = 0;
  const coordinator = createReaderReconnectCoordinator({
    retryDelay: 0,
    async open(target, disconnected) {
      attempts += 1;
      if (attempts === 2 || attempts === 3) throw new Error('replacement failed');
      const reader = {
        port: target,
        closed: false,
        async disconnect() { this.closed = true; disconnected(); },
      };
      readers.push(reader);
      return reader;
    },
  });

  await coordinator.connect(port);
  readers[0].closed = true;
  readers[0].disconnect = async () => {};
  readers[0].disconnected?.();
  await coordinator.portConnected(port);
  assert.equal(coordinator.currentReader(), null);

  await coordinator.connect(port);
  const replacement = coordinator.currentReader();
  await coordinator.portDisconnected(port);
  assert.equal(replacement.closed, true);
  assert.equal(coordinator.currentReader(), null);
});

test('manual disconnect and dispose cancel pending stale-marker expiry', async () => {
  const port = { id: 'usb' };
  const timers = new Set();
  let cleared = 0;
  const readers = [];
  const coordinator = createReaderReconnectCoordinator({
    setTimer(callback) {
      const handle = { callback };
      timers.add(handle);
      return handle;
    },
    clearTimer(handle) {
      if (timers.delete(handle)) cleared += 1;
    },
    async open(target, disconnected) {
      const reader = {
        port: target,
        disconnected,
        async disconnect() { disconnected(); },
      };
      readers.push(reader);
      return reader;
    },
  });

  await coordinator.connect(port);
  readers[0].disconnected();
  await coordinator.portConnected(port);
  assert.equal(timers.size, 1);

  await coordinator.manualDisconnect();
  assert.equal(timers.size, 0);
  assert.equal(cleared, 1);

  await coordinator.connect(port);
  readers[2].disconnected();
  await coordinator.portConnected(port);
  assert.equal(timers.size, 1);

  await coordinator.dispose();
  assert.equal(timers.size, 0);
  assert.equal(cleared, 2);
});

test('replacement stabilization expires an unconsumed stale marker', async () => {
  const port = { id: 'usb' };
  const readers = [];
  let stabilization;
  const coordinator = createReaderReconnectCoordinator({
    setTimer(callback) {
      stabilization = callback;
      return callback;
    },
    clearTimer(handle) {
      if (stabilization === handle) stabilization = null;
    },
    async open(target, disconnected) {
      const reader = {
        port: target,
        disconnected,
        closed: false,
        async disconnect() { this.closed = true; disconnected(); },
      };
      readers.push(reader);
      return reader;
    },
  });

  await coordinator.connect(port);
  readers[0].disconnected();
  await coordinator.portConnected(port);
  assert.equal(typeof stabilization, 'function');

  const stabilize = stabilization;
  stabilization = null;
  stabilize();

  await coordinator.portDisconnected(port);
  assert.equal(readers[1].closed, true);
  assert.equal(coordinator.currentReader(), null);
});

test('same-port disconnect before connect closes the old generation and opens a replacement', async () => {
  const port = { id: 'usb' };
  const readers = [];
  const states = [];
  const coordinator = createReaderReconnectCoordinator({
    onState: state => states.push(state),
    async open(target, disconnected) {
      const reader = {
        port: target,
        closed: false,
        async disconnect() { this.closed = true; disconnected(); },
      };
      readers.push(reader);
      return reader;
    },
  });

  await coordinator.connect(port);
  await coordinator.portDisconnected(port);
  assert.equal(readers[0].closed, true);
  assert.equal(coordinator.currentReader(), null);

  await coordinator.portConnected(port);
  assert.equal(coordinator.currentReader(), readers[1]);
  assert.equal(readers[1].closed, false);
  assert.deepEqual(states, ['connecting', 'connected', 'idle', 'connecting', 'connected']);

  await coordinator.portDisconnected(port);
  assert.equal(readers[1].closed, true);
  assert.equal(coordinator.currentReader(), null);
});

test('a replug retries the known port once when opening races the USB device', async () => {
  const port = { id: 'usb' };
  let attempts = 0;
  const coordinator = createReaderReconnectCoordinator({
    retryDelay: 0,
    async open(target) {
      attempts += 1;
      if (attempts === 1) throw new Error('port not ready');
      return { port: target, async disconnect() {} };
    },
  });
  await coordinator.portConnected(port);
  assert.equal(attempts, 2);
  assert.equal(coordinator.currentReader()?.port, port);
});

test('manual disconnect and disposal never start an automatic reconnect loop', async () => {
  const port = { id: 'usb' };
  let attempts = 0, disconnected;
  const coordinator = createReaderReconnectCoordinator({
    async open(target, onDisconnected) {
      attempts += 1;
      disconnected = onDisconnected;
      return { port: target, async disconnect() { onDisconnected(); } };
    },
  });
  await coordinator.connect(port);
  await coordinator.manualDisconnect();
  disconnected();
  await tick();
  assert.equal(attempts, 1);
  await coordinator.dispose();
  await coordinator.portConnected(port);
  assert.equal(attempts, 1);
});