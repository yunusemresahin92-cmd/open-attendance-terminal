import test from 'node:test';
import assert from 'node:assert/strict';
import { canEditEntryRates, cardDirectoryChanges, initialEntryRate, manualEntryRecord, normalizeCardUid, normalizePermissions, retryVerifiedCleanup, runEmployeeRecordCleanup, subscriptionCollections } from './data.js';

test('entry rate editing requires timesheet plus employees or settings permission', () => {
  assert.equal(canEditEntryRates({ admin: false, menus: ['employees'] }), false);
  assert.equal(canEditEntryRates({ admin: false, menus: ['settings'] }), false);
  assert.equal(canEditEntryRates({ admin: false, menus: ['timesheet', 'employees'] }), true);
  assert.equal(canEditEntryRates({ admin: false, menus: ['timesheet', 'settings'] }), true);
  assert.equal(canEditEntryRates({ admin: true, menus: [] }), true);
});

test('timesheet-only users create entries with a null protected rate', () => {
  assert.equal(initialEntryRate({ existingEntry: null, offDay: false, canEditRates: false, employeeRate: 175, defaultRate: 130 }), null);
});

test('rate editors may initialize a normal workday from the employee or default rate', () => {
  assert.equal(initialEntryRate({ existingEntry: null, offDay: false, canEditRates: true, employeeRate: 175, defaultRate: 130 }), 175);
  assert.equal(initialEntryRate({ existingEntry: null, offDay: false, canEditRates: true, employeeRate: null, defaultRate: 130 }), 130);
});

test('existing entries preserve their stored rate for display and save', () => {
  assert.equal(initialEntryRate({ existingEntry: { rate: 210 }, offDay: true, canEditRates: false, employeeRate: 175, defaultRate: 130 }), 210);
  assert.equal(initialEntryRate({ existingEntry: { rate: null }, offDay: false, canEditRates: false, employeeRate: 175, defaultRate: 130 }), null);
});

test('card assignment is an independent admin-selectable permission', () => {
  assert.deepEqual(normalizePermissions(['cards']), ['cards']);
  assert.deepEqual(normalizePermissions(['cards', 'cards', 'unknown']), ['cards']);
});

test('card-only subscriptions expose no payroll directory or calculation settings', () => {
  assert.deepEqual(subscriptionCollections({ admin: false, menus: ['cards'] }), {
    employeeCollection: 'cardDirectory', entries: false, clockIns: false, cards: true, settings: false, syncCardDirectory: false,
  });
  assert.deepEqual(subscriptionCollections({ admin: false, menus: ['timesheet'] }), {
    employeeCollection: 'employeeDirectory', entries: true, clockIns: true, cards: false, settings: true, syncCardDirectory: false,
  });
  assert.equal(subscriptionCollections({ admin: false, menus: ['dashboard', 'cards'] }).syncCardDirectory, false);
  assert.equal(subscriptionCollections({ admin: false, menus: ['employees', 'cards'] }).syncCardDirectory, true);
});

test('card directory sync writes only valid missing or changed minimal records', () => {
  const employees = [
    { id: '1', name: 'Ali', company: 'Demo', active: true, salary: 1 },
    { id: '2', name: 'Veli', company: '', active: false },
    { id: '3', name: '', company: '', active: true },
  ];
  const existing = [{ id: '1', name: 'Ali', company: 'Demo', active: true, endDate: '' }, { id: '2', name: 'Eski', company: '', active: false, endDate: '' }];
  assert.deepEqual(cardDirectoryChanges(employees, existing), [{ id: '2', name: 'Veli', company: '', active: false, endDate: '' }]);
  // Çıkış tarihi Kart Atama listesine de taşınır; eski (tarihsiz) kayıtlar güncellenir.
  assert.deepEqual(cardDirectoryChanges([{ id: '1', name: 'Ali', company: 'Demo', active: true, endDate: '2026-11-30' }], existing),
    [{ id: '1', name: 'Ali', company: 'Demo', active: true, endDate: '2026-11-30' }]);
  assert.deepEqual(cardDirectoryChanges([{ id: '1', name: 'Ali', company: 'Demo', active: true }], [{ id: '1', name: 'Ali', company: 'Demo', active: true }]),
    [{ id: '1', name: 'Ali', company: 'Demo', active: true, endDate: '' }]);
});

test('RFID card UIDs are stored as canonical hexadecimal values', () => {
  assert.equal(normalizeCardUid('a1 b2-c3:d4'), 'A1B2C3D4');
  assert.equal(normalizeCardUid('04-A1-B2-C3-D4-E5-F6'), '04A1B2C3D4E5F6');
  assert.throws(() => normalizeCardUid('1234'), /8, 14 veya 20/);
  assert.throws(() => normalizeCardUid('A1B2C3ZZ'), /onaltılık/);
});

test('verified cleanup retries query and delete failures before reporting success', async () => {
  const documents = [{ id: 'one' }, { id: 'two' }];
  let queries = 0, deletes = 0;
  await retryVerifiedCleanup({
    attempts: 3,
    async queryRecords() {
      queries += 1;
      if (queries === 1) throw new Error('temporary query failure');
      return documents;
    },
    async deleteRecords(records) {
      deletes += 1;
      assert.equal(records, documents);
      if (deletes === 1) throw new Error('temporary delete failure');
      documents.length = 0;
    },
  });
  assert.equal(deletes, 2);
  assert.ok(queries >= 4, 'success must be confirmed by a query after deletion');
});

test('verified cleanup throws when documents remain after bounded attempts', async () => {
  await assert.rejects(retryVerifiedCleanup({
    attempts: 2,
    queryRecords: async () => [{ id: 'left' }],
    deleteRecords: async () => {},
  }), cause => cause?.remaining === 1);
});

test('employee cleanup attempts clock-ins even when entry cleanup fails and reports partial failure', async () => {
  let clockInsAttempted = false;
  await assert.rejects(runEmployeeRecordCleanup({
    entries: async () => { throw Object.assign(new Error('entries failed'), { remaining: 2 }); },
    clockIns: async () => { clockInsAttempted = true; },
  }), /puantaj \(2 kayıt kaldı\)/);
  assert.equal(clockInsAttempted, true);
});

test('B: manual timesheet saves keep only rule-allowed fields, drop offline marks and carry the editedAt stamp', () => {
  const stamp = { server: true };
  const value = { id: 'e1_2026-11-05', employeeId: 'e1', date: '2026-11-05', status: 'present', start: '08:00', end: '18:00', rate: 175, cardUid: 'A1B2C3D4', source: 'offline', scanAt: 'x', offDay: false };
  assert.deepEqual(manualEntryRecord(value, stamp), { id: 'e1_2026-11-05', employeeId: 'e1', date: '2026-11-05', status: 'present', start: '08:00', end: '18:00', rate: 175, cardUid: 'A1B2C3D4', editedAt: stamp });
  assert.deepEqual(manualEntryRecord({ id: 'a', employeeId: 'e1', date: '2026-11-05', status: 'leave', rate: null }, stamp), { id: 'a', employeeId: 'e1', date: '2026-11-05', status: 'leave', rate: null, editedAt: stamp });
});

test('A: card assignment stamps new and legacy mappings with assignedAt (server time)', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./data.js', import.meta.url), 'utf8');
  assert.match(source, /transaction\.set\(claimedReference, \{ employeeId, cardUid, assignedAt: serverTimestamp\(\) \}\)/);
  assert.match(source, /transaction\.update\(claimedReference, \{ assignedAt: serverTimestamp\(\) \}\)/);
  assert.match(source, /batch\.set\(doc\(db, 'entries', value\.id\), manualEntryRecord\(value, serverTimestamp\(\)\)\)/);
});
