import test, { after, before, beforeEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';

const projectId = 'demo-open-attendance-rules';
let env;

const entry = (overrides = {}) => ({
  id: 'employee-1_2026-11-05',
  employeeId: 'employee-1',
  date: '2026-11-05',
  status: 'present',
  start: '08:00',
  end: '18:00',
  rate: null,
  // 0.4.0: puantaj yetkilisinin her yazımı sunucu saatiyle damgalanır.
  editedAt: serverTimestamp(),
  ...overrides,
});
const without = (value, key) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
const employee = (overrides = {}) => ({
  id: 'employee-1', name: 'Çalışan 1', company: 'Demo Şirket', startDate: '2026-01-01', endDate: '', active: true,
  salary: 30000, bank: 28000, overtimeRate: 175,
  salaryHistory: [{ effectiveMonth: '2026-01', salary: 30000, bank: 28000 }],
  ...overrides,
});
const directoryEmployee = (overrides = {}) => ({
  id: 'employee-1', name: 'Çalışan 1', company: 'Demo Şirket', startDate: '2026-01-01', endDate: '', active: true,
  overtimeRate: 175, ...overrides,
});
const cardDirectoryEmployee = (overrides = {}) => ({
  id: 'employee-1', name: 'Çalışan 1', company: 'Demo Şirket', active: true, endDate: '', ...overrides,
});
const inventoryCard = (overrides = {}) => ({ cardUid: 'A1B2C3D4', label: '001', lost: false, events: 0, ...overrides });
const NAMES = { 'employee-1': 'Çalışan 1', 'employee-2': 'Çalışan 2' };
const todayTr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
const historyItem = (overrides = {}) => ({
  cardUid: 'A1B2C3D4', employeeId: 'employee-1', employeeName: 'Çalışan 1', action: 'assigned', date: todayTr(), at: serverTimestamp(), ...overrides,
});
// Her kart olayı kartın işlem sayacını bir artırır ve tam o numaralı geçmiş kaydını yazar.
const cardEvent = (batch, db, cardUid, events, history, inventory = {}) => {
  batch.update(doc(db, `cardInventory/${cardUid}`), { events, ...inventory });
  batch.set(doc(db, `cardHistory/${cardUid}_${events}`), historyItem({ cardUid, ...history }));
  return batch;
};
const assignBatch = (db, employeeId, cardUid, events = 1, batch = writeBatch(db)) => {
  batch.set(doc(db, `employeeCards/${employeeId}`), { employeeId, cardUid });
  batch.set(doc(db, `cardUids/${cardUid}`), { employeeId, cardUid, assignedAt: serverTimestamp() });
  return cardEvent(batch, db, cardUid, events, { employeeId, employeeName: NAMES[employeeId], action: 'assigned' });
};
const returnBatch = (db, employeeId, cardUid, events, batch = writeBatch(db)) => {
  batch.delete(doc(db, `employeeCards/${employeeId}`));
  batch.delete(doc(db, `cardUids/${cardUid}`));
  return cardEvent(batch, db, cardUid, events, { employeeId, employeeName: NAMES[employeeId], action: 'returned' });
};
const seedAssigned = (employeeId, cardUid, events = 1) => env.withSecurityRulesDisabled(async context => {
  const db = context.firestore();
  await setDoc(doc(db, `employeeCards/${employeeId}`), { employeeId, cardUid });
  await setDoc(doc(db, `cardUids/${cardUid}`), { employeeId, cardUid });
  await updateDoc(doc(db, `cardInventory/${cardUid}`), { events });
});
const settingsRules = (overrides = {}) => ({
  workdays: [1, 2, 3, 4, 5, 6], startTime: '09:00', endTime: '18:00', breakMinutes: 60,
  dailyTargetMinutes: 480, salaryDays: 30, overtimeRate: 130, overtimeRoundMinutes: 15,
  deductionOrder: 'extra-first', allowBankDeduction: false, carryForward: false, ...overrides,
});
const settings = (overrides = {}) => ({
  ...settingsRules(), companies: ['Demo Şirket'],
  history: [{ effectiveDate: '2026-11-05', rules: settingsRules({ overtimeRate: 175 }) }], ...overrides,
});

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/timesheet-user'), { email: 'time@example.com', name: 'Puantaj', admin: false, menus: ['timesheet'] });
    await setDoc(doc(db, 'users/rate-editor'), { email: 'rate@example.com', name: 'Yetkili', admin: false, menus: ['timesheet', 'employees'] });
    await setDoc(doc(db, 'users/employees-user'), { email: 'employee@example.com', name: 'Personel', admin: false, menus: ['employees'] });
    await setDoc(doc(db, 'users/settings-user'), { email: 'settings@example.com', name: 'Ayarlar', admin: false, menus: ['settings'] });
    await setDoc(doc(db, 'users/cards-user'), { email: 'cards@example.com', name: 'Kart Yetkilisi', admin: false, menus: ['cards'] });
    await setDoc(doc(db, 'users/delete-user'), { email: 'delete@example.com', name: 'Silme Yetkilisi', admin: false, menus: ['employees', 'deleteEmployee'] });
    await setDoc(doc(db, 'users/admin-user'), { email: 'admin@example.com', name: 'Admin', admin: true, menus: [] });
    await setDoc(doc(db, 'employeeDirectory/employee-1'), directoryEmployee());
    await setDoc(doc(db, 'employeeDirectory/employee-2'), directoryEmployee({ id: 'employee-2', name: 'Çalışan 2', overtimeRate: 200 }));
    await setDoc(doc(db, 'cardDirectory/employee-1'), cardDirectoryEmployee());
    await setDoc(doc(db, 'cardDirectory/employee-2'), cardDirectoryEmployee({ id: 'employee-2', name: 'Çalışan 2' }));
    await setDoc(doc(db, 'config/settings'), settings());
    await setDoc(doc(db, 'cardInventory/A1B2C3D4'), inventoryCard());
    await setDoc(doc(db, 'cardInventory/B1B2C3D4'), inventoryCard({ cardUid: 'B1B2C3D4', label: '002' }));
  });
});

after(async () => env?.cleanup());

test('timesheet-only users may create attendance only with a null protected rate', async () => {
  const db = env.authenticatedContext('timesheet-user').firestore();
  await assertSucceeds(setDoc(doc(db, 'entries/employee-1_2026-11-05'), entry()));
  await assertFails(setDoc(doc(db, 'entries/employee-1_2026-11-06'), entry({ id: 'employee-1_2026-11-06', date: '2026-11-06', rate: 175 })));
});

test('present entries require a real calendar date and a valid increasing time range', async () => {
  const db = env.authenticatedContext('timesheet-user').firestore();
  await assertFails(setDoc(doc(db, 'entries/missing-start'), without(entry({ id: 'missing-start' }), 'start')));
  await assertFails(setDoc(doc(db, 'entries/missing-end'), without(entry({ id: 'missing-end' }), 'end')));
  await assertFails(setDoc(doc(db, 'entries/invalid-hour'), entry({ id: 'invalid-hour', start: '25:00' })));
  await assertFails(setDoc(doc(db, 'entries/invalid-minute'), entry({ id: 'invalid-minute', end: '18:60' })));
  await assertFails(setDoc(doc(db, 'entries/reversed-time'), entry({ id: 'reversed-time', start: '18:00', end: '08:00' })));
  await assertFails(setDoc(doc(db, 'entries/employee-1_2026-02-31'), entry({ id: 'employee-1_2026-02-31', date: '2026-02-31' })));
  await assertSucceeds(setDoc(doc(db, 'entries/employee-1_2028-02-29'), entry({ id: 'employee-1_2028-02-29', date: '2028-02-29' })));
});

test('timesheet-only users preserve an existing rate but cannot clear or transplant it', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'entries/employee-1_2026-11-05'), entry({ rate: 175 }));
  });
  const ref = doc(env.authenticatedContext('timesheet-user').firestore(), 'entries/employee-1_2026-11-05');
  const editedAt = serverTimestamp();
  await assertSucceeds(updateDoc(ref, { end: '19:00', editedAt }));
  await assertFails(updateDoc(ref, { rate: null, editedAt }));
  await assertFails(updateDoc(ref, { employeeId: 'employee-2', id: 'employee-2_2026-11-05', rate: 175, editedAt }));
  await assertFails(updateDoc(ref, { date: '2026-11-06', id: 'employee-1_2026-11-06', rate: 175, editedAt }));
});

test('timesheet-only users cannot delete rated entries but may delete null-rate entries', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'entries/employee-1_2026-11-05'), entry({ rate: 175 }));
    await setDoc(doc(db, 'entries/employee-1_2026-11-06'), entry({ id: 'employee-1_2026-11-06', date: '2026-11-06' }));
  });
  const db = env.authenticatedContext('timesheet-user').firestore();
  await assertFails(deleteDoc(doc(db, 'entries/employee-1_2026-11-05')));
  await assertSucceeds(deleteDoc(doc(db, 'entries/employee-1_2026-11-06')));
  await assertSucceeds(deleteDoc(doc(env.authenticatedContext('rate-editor').firestore(), 'entries/employee-1_2026-11-05')));
});

test('employee cleanup cannot delete dependent records until the authoritative directory is deleted', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'employees/employee-1'), employee());
    await setDoc(doc(db, 'entries/employee-1_2026-11-05'), entry());
    await setDoc(doc(db, 'clockIns/employee-1_2026-11-05'), { id: 'employee-1_2026-11-05', employeeId: 'employee-1', date: '2026-11-05', cardUid: 'A1B2C3D4', start: '08:00', at: new Date() });
  });
  const db = env.authenticatedContext('delete-user').firestore();
  await assertFails(deleteDoc(doc(db, 'entries/employee-1_2026-11-05')));
  await assertFails(deleteDoc(doc(db, 'clockIns/employee-1_2026-11-05')));

  const batch = writeBatch(db);
  batch.delete(doc(db, 'employees/employee-1'));
  batch.delete(doc(db, 'employeeDirectory/employee-1'));
  batch.delete(doc(db, 'cardDirectory/employee-1'));
  batch.delete(doc(db, 'entries/employee-1_2026-11-05'));
  batch.delete(doc(db, 'clockIns/employee-1_2026-11-05'));
  await assertSucceeds(batch.commit());
});

test('employee cleanup binds each dependent employee to its canonical document path', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'employees/employee-1'), employee());
    await setDoc(doc(db, 'entries/forged-entry'), entry({ id: 'forged-entry' }));
    await setDoc(doc(db, 'clockIns/forged-clock'), { id: 'forged-clock', employeeId: 'employee-1', date: '2026-11-05', cardUid: 'A1B2C3D4', start: '08:00', at: new Date() });
  });
  const db = env.authenticatedContext('delete-user').firestore();
  const batch = writeBatch(db);
  batch.delete(doc(db, 'employees/employee-1'));
  batch.delete(doc(db, 'employeeDirectory/employee-1'));
  batch.delete(doc(db, 'cardDirectory/employee-1'));
  batch.delete(doc(db, 'entries/forged-entry'));
  batch.delete(doc(db, 'clockIns/forged-clock'));
  await assertFails(batch.commit());
});

test('entry document IDs must be the canonical employee and date key', async () => {
  const db = env.authenticatedContext('timesheet-user').firestore();
  await assertFails(setDoc(doc(db, 'entries/arbitrary-id'), entry({ id: 'arbitrary-id' })));
  await assertFails(setDoc(doc(db, 'entries/employee-1_2026-11-06'), entry({ id: 'employee-1_2026-11-06' })));
  await assertSucceeds(setDoc(doc(db, 'entries/employee-1_2026-11-05'), entry()));
});

test('rate editing requires timesheet plus employee or settings permission', async () => {
  const value = entry({ rate: 175 });
  await assertFails(setDoc(doc(env.authenticatedContext('employees-user').firestore(), 'entries/employee-1_2026-11-05'), value));
  await assertFails(setDoc(doc(env.authenticatedContext('settings-user').firestore(), 'entries/employee-1_2026-11-05'), value));
  await assertSucceeds(setDoc(doc(env.authenticatedContext('rate-editor').firestore(), 'entries/employee-1_2026-11-05'), value));
});

test('only card-authorized users can read the minimal card directory and maintain paired mappings', async () => {
  const cardsDb = env.authenticatedContext('cards-user').firestore();
  const timesheetDb = env.authenticatedContext('timesheet-user').firestore();
  await assertSucceeds(getDocs(collection(cardsDb, 'cardDirectory')));
  await assertFails(getDocs(collection(cardsDb, 'employeeDirectory')));
  await assertFails(getDoc(doc(cardsDb, 'config/settings')));
  await assertFails(getDocs(collection(timesheetDb, 'employeeCards')));
  await assertSucceeds(assignBatch(cardsDb, 'employee-1', 'A1B2C3D4').commit());
  await assertSucceeds(getDoc(doc(cardsDb, 'employeeCards/employee-1')));
});

test('card mappings reject malformed, duplicate, unpaired or unlogged writes', async () => {
  const db = env.authenticatedContext('cards-user').firestore();
  await assertFails(setDoc(doc(db, 'employeeCards/employee-1'), { employeeId: 'employee-1', cardUid: 'A1B2C3D4' }));

  const malformed = writeBatch(db);
  malformed.set(doc(db, 'employeeCards/employee-1'), { employeeId: 'employee-1', cardUid: 'not-a-uid' });
  malformed.set(doc(db, 'cardUids/not-a-uid'), { employeeId: 'employee-1', cardUid: 'not-a-uid', assignedAt: serverTimestamp() });
  await assertFails(malformed.commit());

  // Geçmişe yazılmadan yapılan atama reddedilir.
  const unlogged = writeBatch(db);
  unlogged.set(doc(db, 'employeeCards/employee-1'), { employeeId: 'employee-1', cardUid: 'A1B2C3D4' });
  unlogged.set(doc(db, 'cardUids/A1B2C3D4'), { employeeId: 'employee-1', cardUid: 'A1B2C3D4', assignedAt: serverTimestamp() });
  await assertFails(unlogged.commit());
  // Sayaç artar ama geçmiş kaydı yazılmazsa da reddedilir.
  const counterOnly = writeBatch(db);
  counterOnly.set(doc(db, 'employeeCards/employee-1'), { employeeId: 'employee-1', cardUid: 'A1B2C3D4' });
  counterOnly.set(doc(db, 'cardUids/A1B2C3D4'), { employeeId: 'employee-1', cardUid: 'A1B2C3D4', assignedAt: serverTimestamp() });
  counterOnly.update(doc(db, 'cardInventory/A1B2C3D4'), { events: 1 });
  await assertFails(counterOnly.commit());
  // Geçmiş numarası sayaçla aynı olmalı.
  const wrongId = writeBatch(db);
  wrongId.set(doc(db, 'employeeCards/employee-1'), { employeeId: 'employee-1', cardUid: 'A1B2C3D4' });
  wrongId.set(doc(db, 'cardUids/A1B2C3D4'), { employeeId: 'employee-1', cardUid: 'A1B2C3D4', assignedAt: serverTimestamp() });
  wrongId.update(doc(db, 'cardInventory/A1B2C3D4'), { events: 1 });
  wrongId.set(doc(db, 'cardHistory/A1B2C3D4_7'), historyItem());
  await assertFails(wrongId.commit());

  await assertSucceeds(assignBatch(db, 'employee-1', 'A1B2C3D4').commit());
  await assertFails(assignBatch(db, 'employee-2', 'A1B2C3D4', 2).commit());

  // Kart doğrudan başka personele devredilemez; önce teslim alınmalı.
  const transfer = writeBatch(db);
  transfer.delete(doc(db, 'employeeCards/employee-1'));
  transfer.set(doc(db, 'employeeCards/employee-2'), { employeeId: 'employee-2', cardUid: 'A1B2C3D4' });
  transfer.set(doc(db, 'cardUids/A1B2C3D4'), { employeeId: 'employee-2', cardUid: 'A1B2C3D4', assignedAt: serverTimestamp() });
  cardEvent(transfer, db, 'A1B2C3D4', 2, { employeeId: 'employee-2', employeeName: 'Çalışan 2' });
  await assertFails(transfer.commit());

  // A→B kart değişimi: eski kart teslim alınır, yeni kart verilir; ikisi de geçmişe yazılır.
  const replace = writeBatch(db);
  replace.delete(doc(db, 'cardUids/A1B2C3D4'));
  cardEvent(replace, db, 'A1B2C3D4', 2, { action: 'returned' });
  replace.set(doc(db, 'employeeCards/employee-1'), { employeeId: 'employee-1', cardUid: 'B1B2C3D4' });
  replace.set(doc(db, 'cardUids/B1B2C3D4'), { employeeId: 'employee-1', cardUid: 'B1B2C3D4', assignedAt: serverTimestamp() });
  cardEvent(replace, db, 'B1B2C3D4', 1, { cardUid: 'B1B2C3D4' });
  await assertSucceeds(replace.commit());
  await assertFails(deleteDoc(doc(db, 'cardUids/B1B2C3D4')));
  await assertSucceeds(returnBatch(db, 'employee-1', 'B1B2C3D4', 2).commit());
});

test('cards cannot be given to employees who have left or are leaving today', async () => {
  const db = env.authenticatedContext('cards-user').firestore();
  await env.withSecurityRulesDisabled(async context => {
    const admin = context.firestore();
    await setDoc(doc(admin, 'employeeDirectory/employee-2'), directoryEmployee({ id: 'employee-2', name: 'Çalışan 2', active: false }));
  });
  await assertFails(assignBatch(db, 'employee-2', 'A1B2C3D4').commit());
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'employeeDirectory/employee-2'), directoryEmployee({ id: 'employee-2', name: 'Çalışan 2', endDate: todayTr() }));
  });
  await assertFails(assignBatch(db, 'employee-2', 'A1B2C3D4').commit());
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'employeeDirectory/employee-2'), directoryEmployee({ id: 'employee-2', name: 'Çalışan 2', endDate: '2099-12-31' }));
  });
  await assertSucceeds(assignBatch(db, 'employee-2', 'A1B2C3D4').commit());
});

test('card directory records mirror the employee directory and cannot be created for missing employees', async () => {
  const db = env.authenticatedContext('employees-user').firestore();
  await assertFails(setDoc(doc(db, 'cardDirectory/ghost'), cardDirectoryEmployee({ id: 'ghost' })));
  await assertFails(setDoc(doc(db, 'cardDirectory/employee-1'), cardDirectoryEmployee({ name: 'Yeni Ad' })));
  await assertFails(setDoc(doc(db, 'cardDirectory/employee-1'), cardDirectoryEmployee({ active: false })));
  await assertFails(setDoc(doc(db, 'cardDirectory/employee-1'), cardDirectoryEmployee({ endDate: '2026-12-31' })));
  await assertFails(setDoc(doc(db, 'cardDirectory/employee-1'), without(cardDirectoryEmployee(), 'endDate')));
  const rename = writeBatch(db);
  rename.set(doc(db, 'employeeDirectory/employee-1'), directoryEmployee({ name: 'Yeni Ad', endDate: '2026-12-31' }));
  rename.set(doc(db, 'cardDirectory/employee-1'), cardDirectoryEmployee({ name: 'Yeni Ad', endDate: '2026-12-31' }));
  await assertSucceeds(rename.commit());
});

test('delete permission may fetch one mapping for cleanup but cannot list all RFID assignments', async () => {
  await seedAssigned('employee-1', 'A1B2C3D4');
  const db = env.authenticatedContext('delete-user').firestore();
  await assertSucceeds(getDoc(doc(db, 'employeeCards/employee-1')));
  await assertSucceeds(getDoc(doc(db, 'cardInventory/A1B2C3D4')));
  await assertSucceeds(getDoc(doc(db, 'cardDirectory/employee-1')));
  await assertFails(getDoc(doc(db, 'cardUids/A1B2C3D4')));
  await assertFails(getDocs(collection(db, 'employeeCards')));
  await assertFails(getDocs(collection(db, 'cardUids')));
  await assertFails(getDocs(collection(db, 'cardInventory')));
  await assertFails(getDocs(collection(db, 'cardHistory')));
});

test('delete permission frees a card only while deleting its employee and always logs the return', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'employees/employee-1'), employee());
    await setDoc(doc(db, 'employees/employee-2'), employee({ id: 'employee-2', name: 'Çalışan 2' }));
  });
  await seedAssigned('employee-1', 'A1B2C3D4');
  const deleteDb = env.authenticatedContext('delete-user').firestore();
  await assertFails(deleteDoc(doc(deleteDb, 'employees/employee-1')));
  await assertFails(deleteDoc(doc(deleteDb, 'employeeDirectory/employee-1')));
  // Personel kadroda kalırken kartını elinden alamaz.
  await assertFails(returnBatch(deleteDb, 'employee-1', 'A1B2C3D4', 2).commit());

  const deleteAll = batch => {
    batch.delete(doc(deleteDb, 'employees/employee-1'));
    batch.delete(doc(deleteDb, 'employeeDirectory/employee-1'));
    batch.delete(doc(deleteDb, 'cardDirectory/employee-1'));
    return batch;
  };
  // Geçmişe yazmadan silme reddedilir.
  const silent = deleteAll(writeBatch(deleteDb));
  silent.delete(doc(deleteDb, 'employeeCards/employee-1'));
  silent.delete(doc(deleteDb, 'cardUids/A1B2C3D4'));
  await assertFails(silent.commit());
  // Silme yetkisi kartı "kayıp" yazamaz.
  const lost = deleteAll(writeBatch(deleteDb));
  lost.delete(doc(deleteDb, 'employeeCards/employee-1'));
  lost.delete(doc(deleteDb, 'cardUids/A1B2C3D4'));
  cardEvent(lost, deleteDb, 'A1B2C3D4', 2, { action: 'lost' }, { lost: true });
  await assertFails(lost.commit());
  await assertSucceeds(returnBatch(deleteDb, 'employee-1', 'A1B2C3D4', 2, deleteAll(writeBatch(deleteDb))).commit());

  const adminDb = env.authenticatedContext('admin-user').firestore();
  const createAndOrphan = assignBatch(adminDb, 'employee-2', 'B1B2C3D4');
  createAndOrphan.delete(doc(adminDb, 'employees/employee-2'));
  createAndOrphan.delete(doc(adminDb, 'employeeDirectory/employee-2'));
  createAndOrphan.delete(doc(adminDb, 'cardDirectory/employee-2'));
  await assertFails(createAndOrphan.commit());
});


test('employee records reject malformed payroll data, non-finite values and huge amounts', async () => {
  const db = env.authenticatedContext('employees-user').firestore();
  await assertSucceeds(setDoc(doc(db, 'employees/employee-1'), employee()));
  await assertFails(setDoc(doc(db, 'employees/employee-1'), employee({ bank: 31000 })));
  await assertFails(setDoc(doc(db, 'employees/employee-1'), employee({ salaryHistory: [{ effectiveMonth: 202601, salary: 30000, bank: 28000 }] })));
  await assertFails(setDoc(doc(db, 'employees/employee-1'), employee({ salaryHistory: [{ effectiveMonth: '2026-13', salary: 30000, bank: 28000 }] })));
  await assertFails(setDoc(doc(db, 'employees/employee-1'), employee({ salaryHistory: [{ effectiveMonth: '2026-01', salary: 30000, bank: 31000 }] })));
  await assertFails(setDoc(doc(db, 'employees/employee-1'), employee({ salaryHistory: [{ effectiveMonth: '2026-01', salary: 30000, bank: 28000, injected: true }] })));
  await assertFails(setDoc(doc(db, 'employees/employee-1'), employee({ injected: true })));
  await assertFails(setDoc(doc(db, 'employees/employee-1'), employee({ salary: Infinity })));
  await assertFails(setDoc(doc(db, 'employees/employee-1'), employee({ salary: 1000000001, bank: 0 })));
  await assertFails(setDoc(doc(db, 'employees/employee-1'), employee({ overtimeRate: Infinity })));
  await assertFails(setDoc(doc(db, 'employees/employee-1'), employee({ salaryHistory: [{ effectiveMonth: '2026-01', salary: Infinity, bank: 0 }] })));
});

test('employee directory enforces its full schema, types, dates, active flag and bounded rate', async () => {
  const db = env.authenticatedContext('employees-user').firestore();
  await assertSucceeds(setDoc(doc(db, 'employeeDirectory/employee-1'), directoryEmployee()));
  await assertFails(setDoc(doc(db, 'employeeDirectory/employee-1'), directoryEmployee({ id: 'employee-2' })));
  await assertFails(setDoc(doc(db, 'employeeDirectory/employee-1'), directoryEmployee({ name: 42 })));
  await assertFails(setDoc(doc(db, 'employeeDirectory/employee-1'), directoryEmployee({ startDate: '2026-02-31' })));
  await assertFails(setDoc(doc(db, 'employeeDirectory/employee-1'), directoryEmployee({ endDate: '2025-12-31' })));
  await assertFails(setDoc(doc(db, 'employeeDirectory/employee-1'), directoryEmployee({ active: 'yes' })));
  await assertFails(setDoc(doc(db, 'employeeDirectory/employee-1'), directoryEmployee({ overtimeRate: Infinity })));
  await assertFails(setDoc(doc(db, 'employeeDirectory/employee-1'), directoryEmployee({ overtimeRate: 1000001 })));
  await assertFails(setDoc(doc(db, 'employeeDirectory/employee-1'), directoryEmployee({ injected: true })));
});

test('settings accept the app shape and reject malformed fields and revisions', async () => {
  const db = env.authenticatedContext('settings-user').firestore();
  const adminDb = env.authenticatedContext('admin-user').firestore();
  await assertSucceeds(setDoc(doc(db, 'config/settings'), settings()));
  await assertSucceeds(setDoc(doc(adminDb, 'config/settings'), settings()));
  await assertFails(setDoc(doc(adminDb, 'config/settings'), settings({ injected: true })));
  await assertSucceeds(setDoc(doc(db, 'config/settings'), { companies: ['Demo Şirket'] }));
  await assertSucceeds(setDoc(doc(db, 'config/settings'), { history: [{ effectiveMonth: '2026-11', rules: settingsRules() }] }));
  await assertFails(setDoc(doc(db, 'config/settings'), settings({ workdays: [1, 7] })));
  await assertFails(setDoc(doc(db, 'config/settings'), settings({ startTime: '9:00' })));
  await assertFails(setDoc(doc(db, 'config/settings'), settings({ breakMinutes: -1 })));
  await assertFails(setDoc(doc(db, 'config/settings'), settings({ overtimeRate: Infinity })));
  await assertFails(setDoc(doc(db, 'config/settings'), settings({ overtimeRate: 1000001 })));
  await assertFails(setDoc(doc(db, 'config/settings'), settings({ allowBankDeduction: 'false' })));
  await assertFails(setDoc(doc(db, 'config/settings'), settings({ deductionOrder: 'bank-first' })));
  await assertFails(setDoc(doc(db, 'config/settings'), settings({ companies: [''] })));
  await assertFails(setDoc(doc(db, 'config/settings'), settings({ history: [{ effectiveDate: '2026-02-31', rules: settingsRules() }] })));
  await assertFails(setDoc(doc(db, 'config/settings'), settings({ history: [{ effectiveDate: '2026-11-05', rules: settingsRules({ carryForward: 'yes' }) }] })));
  await assertFails(setDoc(doc(db, 'config/settings'), settings({ injected: true })));
});

test('settings reject breaks that consume the full work interval', async () => {
  const db = env.authenticatedContext('settings-user').firestore();
  await assertFails(setDoc(doc(db, 'config/settings'), settings({ breakMinutes: 540 })));
  await assertFails(setDoc(doc(db, 'config/settings'), {
    history: [{ effectiveMonth: '2026-11', rules: settingsRules({ breakMinutes: 540 }) }],
  }));
});

test('settings reject daily targets longer than the post-break work interval', async () => {
  const db = env.authenticatedContext('settings-user').firestore();
  await assertSucceeds(setDoc(doc(db, 'config/settings'), settings({ dailyTargetMinutes: 480 })));
  await assertFails(setDoc(doc(db, 'config/settings'), settings({ dailyTargetMinutes: 481 })));
  await assertFails(setDoc(doc(db, 'config/settings'), {
    history: [{ effectiveDate: '2026-11-05', rules: settingsRules({ dailyTargetMinutes: 481 }) }],
  }));
});

test('partial base settings are validated after merging with client defaults', async () => {
  const db = env.authenticatedContext('settings-user').firestore();
  await assertFails(setDoc(doc(db, 'config/settings'), { startTime: '08:00', endTime: '08:30' }));
  await assertFails(setDoc(doc(db, 'config/settings'), { breakMinutes: 600 }));
  await assertFails(setDoc(doc(db, 'config/settings'), { dailyTargetMinutes: 1440 }));
  await assertSucceeds(setDoc(doc(db, 'config/settings'), { startTime: '08:00', endTime: '18:00' }));
});

const revisionHistory = count => Array.from({ length: count }, (_, index) => ({
  effectiveDate: `2026-${String(index + 1).padStart(2, '0')}-01`, rules: settingsRules({ overtimeRate: 130 + index }),
}));

test('settings with a full revision history still accept the app transaction writes', async () => {
  await env.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'config/settings'), { companies: ['Demo Şirket'], history: revisionHistory(9) });
  });
  const db = env.authenticatedContext('settings-user').firestore();
  const ref = doc(db, 'config/settings');
  const history = [...revisionHistory(9), { effectiveDate: '2026-11-05', rules: settingsRules({ overtimeRate: 200 }) }];
  await assertSucceeds(setDoc(ref, { companies: ['Demo Şirket'], history }));
  await assertSucceeds(setDoc(ref, { companies: ['Demo Şirket', 'Demo Servis'], history }));
  await assertFails(setDoc(ref, {
    companies: ['Demo Şirket', 'Demo Servis'],
    history: [...revisionHistory(9), { effectiveDate: '2026-11-05', rules: settingsRules({ breakMinutes: 540 }) }],
  }));
  await assertFails(setDoc(ref, {
    companies: ['Demo Şirket', 'Demo Servis'],
    history: [...revisionHistory(9), { effectiveDate: '2026-11-05', rules: settingsRules({ dailyTargetMinutes: 481 }) }],
  }));
});

test('card inventory is readable and writable only with the card permission and a strict schema', async () => {
  const cardsDb = env.authenticatedContext('cards-user').firestore();
  const timesheetDb = env.authenticatedContext('timesheet-user').firestore();
  const employeesDb = env.authenticatedContext('employees-user').firestore();
  await assertSucceeds(getDocs(collection(cardsDb, 'cardInventory')));
  await assertFails(getDocs(collection(timesheetDb, 'cardInventory')));
  await assertFails(setDoc(doc(employeesDb, 'cardInventory/C1C2C3D4'), inventoryCard({ cardUid: 'C1C2C3D4', label: '003' })));
  await assertSucceeds(setDoc(doc(cardsDb, 'cardInventory/C1C2C3D4'), inventoryCard({ cardUid: 'C1C2C3D4', label: '003' })));
  await assertFails(setDoc(doc(cardsDb, 'cardInventory/D1D2D3D4'), inventoryCard({ cardUid: 'C1C2C3D4', label: '004' })));
  await assertFails(setDoc(doc(cardsDb, 'cardInventory/d1d2d3d4'), inventoryCard({ cardUid: 'd1d2d3d4', label: '004' })));
  await assertFails(setDoc(doc(cardsDb, 'cardInventory/D1D2D3D4'), inventoryCard({ cardUid: 'D1D2D3D4', label: '' })));
  await assertFails(setDoc(doc(cardsDb, 'cardInventory/D1D2D3D4'), inventoryCard({ cardUid: 'D1D2D3D4', label: 'x'.repeat(21) })));
  await assertFails(setDoc(doc(cardsDb, 'cardInventory/D1D2D3D4'), inventoryCard({ cardUid: 'D1D2D3D4', lost: 'no' })));
  await assertFails(setDoc(doc(cardsDb, 'cardInventory/D1D2D3D4'), inventoryCard({ cardUid: 'D1D2D3D4', employeeId: 'employee-1' })));
  await assertFails(setDoc(doc(cardsDb, 'cardInventory/D1D2D3D4'), inventoryCard({ cardUid: 'D1D2D3D4', events: 3 })));
  await assertFails(setDoc(doc(cardsDb, 'cardInventory/D1D2D3D4'), inventoryCard({ cardUid: 'D1D2D3D4', lost: true })));
  await assertFails(setDoc(doc(cardsDb, 'cardInventory/D1D2D3D4'), without(inventoryCard({ cardUid: 'D1D2D3D4' }), 'events')));
  // Numara değişikliği sayaç ve durumla birlikte yapılamaz.
  await assertSucceeds(updateDoc(doc(cardsDb, 'cardInventory/C1C2C3D4'), { label: 'Yedek' }));
  await assertFails(updateDoc(doc(cardsDb, 'cardInventory/C1C2C3D4'), { events: 1 }));
  await assertFails(updateDoc(doc(cardsDb, 'cardInventory/C1C2C3D4'), { lost: true }));
});

test('cards can only be assigned from the inventory and never while marked lost', async () => {
  const db = env.authenticatedContext('cards-user').firestore();
  const missing = writeBatch(db);
  missing.set(doc(db, 'employeeCards/employee-1'), { employeeId: 'employee-1', cardUid: 'C1C2C3D4' });
  missing.set(doc(db, 'cardUids/C1C2C3D4'), { employeeId: 'employee-1', cardUid: 'C1C2C3D4', assignedAt: serverTimestamp() });
  await assertFails(missing.commit());
  await assertSucceeds(cardEvent(writeBatch(db), db, 'B1B2C3D4', 1, { cardUid: 'B1B2C3D4', employeeId: '', employeeName: '', action: 'lost' }, { lost: true }).commit());
  await assertFails(assignBatch(db, 'employee-1', 'B1B2C3D4', 2).commit());
  await assertSucceeds(cardEvent(writeBatch(db), db, 'B1B2C3D4', 2, { cardUid: 'B1B2C3D4', employeeId: '', employeeName: '', action: 'found' }, { lost: false }).commit());
  await assertSucceeds(assignBatch(db, 'employee-1', 'B1B2C3D4', 3).commit());
});

test('an assigned card cannot be marked lost or deleted unless its assignment ends in the same write', async () => {
  const db = env.authenticatedContext('cards-user').firestore();
  await assertSucceeds(assignBatch(db, 'employee-1', 'A1B2C3D4').commit());
  await assertFails(cardEvent(writeBatch(db), db, 'A1B2C3D4', 2, { employeeId: '', employeeName: '', action: 'lost' }, { lost: true }).commit());
  await assertFails(deleteDoc(doc(db, 'cardInventory/A1B2C3D4')));
  const lose = writeBatch(db);
  lose.delete(doc(db, 'employeeCards/employee-1'));
  lose.delete(doc(db, 'cardUids/A1B2C3D4'));
  cardEvent(lose, db, 'A1B2C3D4', 2, { action: 'lost' }, { lost: true });
  await assertSucceeds(lose.commit());
  // Geçmişi olan kart listeden silinemez; hiç kullanılmamış kart silinebilir.
  await assertFails(deleteDoc(doc(db, 'cardInventory/A1B2C3D4')));
  await assertSucceeds(deleteDoc(doc(db, 'cardInventory/B1B2C3D4')));
});

test('card history is append-only and every record must match a real change', async () => {
  const db = env.authenticatedContext('cards-user').firestore();
  const timesheetDb = env.authenticatedContext('timesheet-user').firestore();
  await assertFails(setDoc(doc(db, 'cardHistory/A1B2C3D4_1'), historyItem()));
  await assertSucceeds(assignBatch(db, 'employee-1', 'A1B2C3D4').commit());
  await assertFails(updateDoc(doc(db, 'cardHistory/A1B2C3D4_1'), { employeeName: 'Başkası' }));
  await assertFails(deleteDoc(doc(db, 'cardHistory/A1B2C3D4_1')));
  await assertSucceeds(getDocs(collection(db, 'cardHistory')));
  await assertFails(getDocs(collection(timesheetDb, 'cardHistory')));

  const forged = async (history, inventory = {}) => assertFails(cardEvent(writeBatch(db), db, 'A1B2C3D4', 2, history, inventory).commit());
  await forged({ action: 'stolen' });
  await forged({ action: 'returned', employeeId: 'employee-2', employeeName: 'Çalışan 2' }); // kartı hiç almamış kişi
  await forged({ action: 'returned', employeeId: 'ghost', employeeName: 'Hayalet' }); // olmayan personel
  await forged({ action: 'assigned' }); // değişiklik olmadan ikinci "verildi"
  await forged({ action: 'returned' }); // atama kalkmadan "teslim alındı"
  await forged({ action: 'lost', employeeId: '', employeeName: '' }, { lost: true }); // atanmış kart
  await forged({ action: 'found', employeeId: '', employeeName: '' }); // kayıp olmayan kart
  await forged({ at: new Date('2020-01-01') });

  // Sahte ad, eski tarih veya aynı işlemde iki geçmiş kaydı reddedilir.
  const ended = (history, extra) => {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'employeeCards/employee-1'));
    batch.delete(doc(db, 'cardUids/A1B2C3D4'));
    cardEvent(batch, db, 'A1B2C3D4', 2, { action: 'returned', ...history });
    extra?.(batch);
    return batch.commit();
  };
  await assertFails(ended({ employeeName: 'Uydurma Ad' }));
  await assertFails(ended({ date: '2020-01-01' }));
  await assertFails(ended({}, batch => batch.set(doc(db, 'cardHistory/A1B2C3D4_3'), historyItem({ action: 'returned' }))));
  await assertSucceeds(ended({}));

  // Kayıp olan kart tekrar "kayıp" yazılamaz.
  await assertSucceeds(cardEvent(writeBatch(db), db, 'A1B2C3D4', 3, { employeeId: '', employeeName: '', action: 'lost' }, { lost: true }).commit());
  await assertFails(cardEvent(writeBatch(db), db, 'A1B2C3D4', 4, { employeeId: '', employeeName: '', action: 'lost' }, { lost: true }).commit());
});

test('a 0.2.15 client can still delete an employee that 0.3.0 added to the card list; the leftover cannot get a card', async () => {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'employees/employee-2'), employee({ id: 'employee-2', name: 'Çalışan 2' }));
    await setDoc(doc(db, 'entries/employee-2_2026-11-05'), entry({ id: 'employee-2_2026-11-05', employeeId: 'employee-2' }));
  });
  const deleteDb = env.authenticatedContext('delete-user').firestore();
  const legacy = writeBatch(deleteDb);
  legacy.delete(doc(deleteDb, 'employees/employee-2'));
  legacy.delete(doc(deleteDb, 'employeeDirectory/employee-2'));
  legacy.delete(doc(deleteDb, 'entries/employee-2_2026-11-05'));
  await assertSucceeds(legacy.commit());
  const cardsDb = env.authenticatedContext('cards-user').firestore();
  await assertFails(assignBatch(cardsDb, 'employee-2', 'A1B2C3D4').commit());
  await assertSucceeds(deleteDoc(doc(deleteDb, 'cardDirectory/employee-2')));
});


test('A: a legacy card assignment works online and can be upgraded once with a server assignedAt', async () => {
  const db = env.authenticatedContext('cards-user').firestore();
  const assign = mapping => {
    const batch = writeBatch(db);
    batch.set(doc(db, 'employeeCards/employee-1'), { employeeId: 'employee-1', cardUid: 'A1B2C3D4' });
    batch.set(doc(db, 'cardUids/A1B2C3D4'), mapping);
    return cardEvent(batch, db, 'A1B2C3D4', 1, { employeeId: 'employee-1', employeeName: NAMES['employee-1'], action: 'assigned' }).commit();
  };
  await assertSucceeds(assign({ employeeId: 'employee-1', cardUid: 'A1B2C3D4' }));
  const ref = doc(db, 'cardUids/A1B2C3D4');
  await assertFails(updateDoc(ref, { assignedAt: Timestamp.fromMillis(Date.now() - 86_400_000) }));
  await assertSucceeds(updateDoc(ref, { assignedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { assignedAt: serverTimestamp() }));
});
