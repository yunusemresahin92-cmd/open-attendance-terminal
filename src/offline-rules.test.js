// Wi-Fi kart okuyucunun çevrimdışı okutmaları (0.4.0): yalnız scanAt ile işaretli, 7 gün / +3 dk penceresinde,
// tarihi ve saati tam okutma anı olan yazımlar kabul edilir. Diğer bütün terminal kuralları aynen geçerlidir.
import test, { after, before, beforeEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { turkeyNow } from './clock.js';

const projectId = 'demo-open-attendance-rules';
let env;
const DAY = 86_400_000;
const trDate = daysAgo => turkeyNow(new Date(Date.now() - daysAgo * DAY)).date;
const instant = (date, time, second = 0) => new Date(`${date}T${time}:${String(second).padStart(2, '0')}+03:00`);
const scanAtMs = ms => {
  const at = new Date(ms);
  return { ...turkeyNow(at), at };
};
const plusMinutes = (time, minutes) => {
  const value = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + minutes;
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
};
const terminal = () => env.authenticatedContext('terminal-user').firestore();
const seed = fn => env.withSecurityRulesDisabled(context => fn(context.firestore()));
const directoryEmployee = (overrides = {}) => ({
  id: 'employee-1', name: 'Çalışan 1', company: 'Demo Şirket', startDate: '2026-01-01', endDate: '', active: true, overtimeRate: 175, ...overrides,
});
// Çevrimdışı açık giriş: tarih/saat okutma anından.
const offlineClockIn = (date, time, overrides = {}) => ({
  id: `employee-1_${date}`, employeeId: 'employee-1', date, cardUid: 'A1B2C3D4', start: time, at: serverTimestamp(),
  source: 'offline', scanAt: Timestamp.fromDate(instant(date, time, 20)), ...overrides,
});
const entry = (date, overrides = {}) => ({
  id: `employee-1_${date}`, employeeId: 'employee-1', date, status: 'present', start: '08:00', end: '17:00', rate: null, cardUid: 'A1B2C3D4', ...overrides,
});
const offlineExit = (date, start, end, overrides = {}) => entry(date, {
  start, end, source: 'offline', scanAt: Timestamp.fromDate(instant(date, end, 5)), ...overrides,
});

before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } });
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed(async db => {
    await setDoc(doc(db, 'users/terminal-user'), { email: 'kapi@example.com', name: 'Kapı', admin: false, menus: ['terminal'] });
    await setDoc(doc(db, 'users/timesheet-user'), { email: 'time@example.com', name: 'Puantaj', admin: false, menus: ['timesheet'] });
    await setDoc(doc(db, 'users/terminal-cards-user'), { email: 'both@example.com', name: 'Kapı ve Kart', admin: false, menus: ['terminal', 'cards'] });
    await setDoc(doc(db, 'employeeDirectory/employee-1'), directoryEmployee());
    await setDoc(doc(db, 'employeeDirectory/employee-2'), directoryEmployee({ id: 'employee-2', name: 'Çalışan 2' }));
    await setDoc(doc(db, 'cardDirectory/employee-1'), { id: 'employee-1', name: 'Çalışan 1', company: 'Demo Şirket', active: true, endDate: '' });
    const assignedAt = Timestamp.fromMillis(Date.now() - 30 * DAY);
    await setDoc(doc(db, 'cardUids/A1B2C3D4'), { employeeId: 'employee-1', cardUid: 'A1B2C3D4', assignedAt });
    await setDoc(doc(db, 'cardUids/B1B2C3D4'), { employeeId: 'employee-2', cardUid: 'B1B2C3D4', assignedAt });
    await setDoc(doc(db, 'employeeCards/employee-1'), { employeeId: 'employee-1', cardUid: 'A1B2C3D4' });
    await setDoc(doc(db, 'cardInventory/A1B2C3D4'), { cardUid: 'A1B2C3D4', label: '001', lost: false, events: 1 });
  });
});

after(async () => env?.cleanup());

test('terminal can get single entries and clock-ins of the last 7 days for replay, never older and never a list', async () => {
  const recent = trDate(6);
  const old = trDate(9);
  await seed(async db => {
    await setDoc(doc(db, `entries/employee-1_${recent}`), entry(recent));
    await setDoc(doc(db, `entries/employee-1_${old}`), entry(old));
    await setDoc(doc(db, `clockIns/employee-1_${recent}`), offlineClockIn(recent, '08:00', { at: Timestamp.now() }));
    await setDoc(doc(db, `clockIns/employee-1_${old}`), offlineClockIn(old, '08:00', { at: Timestamp.now() }));
  });
  const db = terminal();
  await assertSucceeds(getDoc(doc(db, `entries/employee-1_${recent}`)));
  await assertSucceeds(getDoc(doc(db, `clockIns/employee-1_${recent}`)));
  await assertFails(getDoc(doc(db, `entries/employee-1_${old}`)));
  await assertFails(getDoc(doc(db, `clockIns/employee-1_${old}`)));
  await assertFails(getDocs(collection(db, 'entries')));
  await assertFails(getDocs(collection(db, 'clockIns')));
});

test('an offline scan from two days ago opens a clock-in marked offline with the exact scan date and time', async () => {
  const date = trDate(2);
  await assertSucceeds(setDoc(doc(terminal(), `clockIns/employee-1_${date}`), offlineClockIn(date, '08:52')));
});

test('offline scan time window: at most 7 days old and at most 3 minutes in the future', async () => {
  const write = scan => setDoc(doc(terminal(), `clockIns/employee-1_${scan.date}`),
    offlineClockIn(scan.date, scan.time, { scanAt: Timestamp.fromDate(scan.at) }));
  await assertFails(write(scanAtMs(Date.now() - 7 * DAY - 5 * 60_000)));
  await assertSucceeds(write(scanAtMs(Date.now() - 7 * DAY + 5 * 60_000)));
  await env.clearFirestore();
  await seed(async db => {
    await setDoc(doc(db, 'users/terminal-user'), { email: 'kapi@example.com', name: 'Kapı', admin: false, menus: ['terminal'] });
    await setDoc(doc(db, 'employeeDirectory/employee-1'), directoryEmployee());
    await setDoc(doc(db, 'cardUids/A1B2C3D4'), { employeeId: 'employee-1', cardUid: 'A1B2C3D4', assignedAt: Timestamp.fromMillis(Date.now() - 30 * DAY) });
  });
  const future = scanAtMs(Date.now() + 10 * 60_000);
  if (future.date === turkeyNow().date) await assertFails(write(future));
  const soon = scanAtMs(Date.now() + 60_000);
  if (soon.date === turkeyNow().date) await assertSucceeds(write(soon));
});

test('offline record date and HH:MM must be exactly the Turkish date/time of scanAt', async () => {
  const date = trDate(2);
  const other = trDate(3);
  const db = terminal();
  // Tarih başka gün (saat aynı).
  await assertFails(setDoc(doc(db, `clockIns/employee-1_${other}`), offlineClockIn(other, '08:52', { scanAt: Timestamp.fromDate(instant(date, '08:52')) })));
  // Saat bir dakika farklı.
  await assertFails(setDoc(doc(db, `clockIns/employee-1_${date}`), offlineClockIn(date, '08:53', { scanAt: Timestamp.fromDate(instant(date, '08:52', 59)) })));
  // Türkiye gece yarısı: 23:59:30 önceki güne aittir.
  const midnight = instant(trDate(1), '00:00');
  const lateScan = Timestamp.fromDate(new Date(midnight.getTime() - 30_000));
  await assertFails(setDoc(doc(db, `clockIns/employee-1_${trDate(1)}`), offlineClockIn(trDate(1), '00:00', { scanAt: lateScan })));
  await assertSucceeds(setDoc(doc(db, `clockIns/employee-1_${date}`), offlineClockIn(date, '23:59', { scanAt: lateScan })));
});

test('offline markers cannot be forged or mixed with the online path', async () => {
  const date = trDate(2);
  const ref = doc(terminal(), `clockIns/employee-1_${date}`);
  const base = offlineClockIn(date, '08:52');
  const { source: _source, ...withoutSource } = base;
  await assertFails(setDoc(ref, withoutSource));
  await assertFails(setDoc(ref, { ...base, source: 'pc' }));
  await assertFails(setDoc(ref, { ...base, scanAt: `${date}T08:52:00+03:00` }));
  const { scanAt: _scanAt, ...withoutScanAt } = base;
  await assertFails(setDoc(ref, withoutScanAt));
  await assertFails(setDoc(ref, { ...base, at: Timestamp.fromDate(instant(date, '08:52')) }));
  await assertFails(setDoc(ref, { ...base, extra: true }));
  // Çevrimiçi yol (bugün, şu an) scanAt taşıyamaz; işaret yalnız çevrimdışı yoldan gelir.
  const now = turkeyNow();
  const todayRef = doc(terminal(), `clockIns/employee-1_${now.date}`);
  const online = { id: `employee-1_${now.date}`, employeeId: 'employee-1', date: now.date, cardUid: 'A1B2C3D4', start: now.time, at: serverTimestamp() };
  await assertFails(setDoc(todayRef, { ...online, scanAt: Timestamp.fromDate(new Date(Date.now() - 2 * DAY)) }));
  await assertSucceeds(setDoc(todayRef, online));
});

test('offline replays still enforce card ownership, employment and terminal permission', async () => {
  const date = trDate(2);
  // Başkasının kartı.
  await assertFails(setDoc(doc(terminal(), `clockIns/employee-1_${date}`), offlineClockIn(date, '08:52', { cardUid: 'B1B2C3D4' })));
  // Puantaj kullanıcısı terminal değildir.
  await assertFails(setDoc(doc(env.authenticatedContext('timesheet-user').firestore(), `clockIns/employee-1_${date}`), offlineClockIn(date, '08:52')));
  // Oturum açmamış cihaz.
  await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), `clockIns/employee-1_${date}`), offlineClockIn(date, '08:52')));
  // Aynı işlemde kart geri alınırsa (getAfter) okutma yazılmaz.
  const db = env.authenticatedContext('terminal-cards-user').firestore();
  const batch = writeBatch(db);
  batch.delete(doc(db, 'employeeCards/employee-1'));
  batch.delete(doc(db, 'cardUids/A1B2C3D4'));
  batch.update(doc(db, 'cardInventory/A1B2C3D4'), { events: 2 });
  batch.set(doc(db, 'cardHistory/A1B2C3D4_2'), { cardUid: 'A1B2C3D4', employeeId: 'employee-1', employeeName: 'Çalışan 1', action: 'returned', date: turkeyNow().date, at: serverTimestamp() });
  batch.set(doc(db, `clockIns/employee-1_${date}`), offlineClockIn(date, '08:52'));
  await assertFails(batch.commit());
  // İşten ayrılan personel.
  await seed(seedDb => setDoc(doc(seedDb, 'employeeDirectory/employee-1'), directoryEmployee({ active: false })));
  await assertFails(setDoc(doc(terminal(), `clockIns/employee-1_${date}`), offlineClockIn(date, '08:52')));
});

test('offline clock-in is refused when the day already has a timesheet entry', async () => {
  const date = trDate(2);
  await seed(db => setDoc(doc(db, `entries/employee-1_${date}`), { id: `employee-1_${date}`, employeeId: 'employee-1', date, status: 'leave', rate: null }));
  await assertFails(setDoc(doc(terminal(), `clockIns/employee-1_${date}`), offlineClockIn(date, '08:52')));
  await seed(db => setDoc(doc(db, `entries/employee-1_${date}`), entry(date)));
  await assertFails(setDoc(doc(terminal(), `clockIns/employee-1_${date}`), offlineClockIn(date, '08:52')));
});

test('offline clock-out closes the open clock-in with the 15-minute rule on scan times', async () => {
  const date = trDate(2);
  const id = `employee-1_${date}`;
  await seed(db => setDoc(doc(db, `clockIns/${id}`), offlineClockIn(date, '08:00', { at: Timestamp.now() })));
  const db = terminal();
  const write = (value, close = true) => {
    const batch = writeBatch(db);
    batch.set(doc(db, `entries/${id}`), value);
    if (close) batch.delete(doc(db, `clockIns/${id}`));
    return batch.commit();
  };
  await assertFails(write(offlineExit(date, '08:00', '08:14')));
  await assertFails(write(offlineExit(date, '08:00', '17:00'), false));
  await assertFails(write(offlineExit(date, '08:00', '17:00', { rate: 175 })));
  await assertFails(write(offlineExit(date, '08:00', '17:00', { cardUid: 'B1B2C3D4' })));
  await assertFails(write(offlineExit(date, '08:01', '17:00')));
  await assertFails(write(offlineExit(date, '08:00', '17:00', { scanAt: Timestamp.fromDate(instant(date, '17:01')) })));
  await assertFails(write(offlineExit(date, '08:00', '17:00', { scanAt: Timestamp.fromDate(new Date(Date.now() - 8 * DAY)) })));
  await assertSucceeds(write(offlineExit(date, '08:00', '08:15')));
});

test('online clock-out may keep the offline mark only when the open clock-in was offline', async t => {
  const now = turkeyNow();
  const startMinutes = Number(now.time.slice(0, 2)) * 60 + Number(now.time.slice(3, 5)) - 30;
  if (startMinutes < 0) return t.skip('Türkiye gününün ilk yarım saatinde aynı gün senaryosu kurulamıyor.');
  const start = plusMinutes('00:00', startMinutes);
  const id = `employee-1_${now.date}`;
  const db = terminal();
  const close = value => {
    const batch = writeBatch(db);
    batch.set(doc(db, `entries/${id}`), value);
    batch.delete(doc(db, `clockIns/${id}`));
    return batch.commit();
  };
  // Çevrimiçi giriş: çıkışta sahte 'offline' işareti olmaz.
  await seed(seedDb => setDoc(doc(seedDb, `clockIns/${id}`), { id, employeeId: 'employee-1', date: now.date, cardUid: 'A1B2C3D4', start, at: Timestamp.now() }));
  await assertFails(close(entry(now.date, { start, end: turkeyNow().time, source: 'offline' })));
  // Çevrimdışı giriş: çevrimiçi çıkış işareti taşıyabilir, ama scanAt olmadan.
  await seed(seedDb => setDoc(doc(seedDb, `clockIns/${id}`), offlineClockIn(now.date, start, { at: Timestamp.now(), scanAt: Timestamp.fromDate(instant(now.date, start)) })));
  await assertFails(close(entry(now.date, { start, end: turkeyNow().time, source: 'pc' })));
  await assertFails(close(entry(now.date, { start, end: turkeyNow().time, source: 'offline', scanAt: Timestamp.fromDate(new Date(Date.now() - DAY)) })));
  await assertSucceeds(close(entry(now.date, { start, end: turkeyNow().time, source: 'offline' })));
});

test('offline exit extension moves a recent day forward by at least 15 minutes and never backwards', async () => {
  const date = trDate(3);
  const ref = doc(terminal(), `entries/employee-1_${date}`);
  await seed(db => setDoc(doc(db, `entries/employee-1_${date}`), entry(date, { start: '08:00', end: '17:00', source: 'offline' })));
  const extend = (end, extra = {}) => updateDoc(ref, { end, source: 'offline', scanAt: Timestamp.fromDate(instant(date, end, 10)), ...extra });
  await assertFails(extend('17:14'));
  await assertFails(extend('16:30'));
  await assertFails(extend('18:00', { rate: 100 }));
  await assertFails(extend('18:00', { start: '07:00' }));
  await assertFails(extend('18:00', { cardUid: 'B1B2C3D4' }));
  await assertFails(updateDoc(ref, { end: '18:00', source: 'offline' }));
  await assertFails(updateDoc(ref, { end: '18:00' }));
  await assertSucceeds(extend('17:15'));
});

test('offline replays never overwrite leave, absence or a manual day with a later end time', async () => {
  const date = trDate(2);
  const ref = doc(terminal(), `entries/employee-1_${date}`);
  for (const status of ['leave', 'absent']) {
    await seed(db => setDoc(doc(db, `entries/employee-1_${date}`), { id: `employee-1_${date}`, employeeId: 'employee-1', date, status, rate: null }));
    await assertFails(updateDoc(ref, { status: 'present', start: '08:00', end: '17:00', cardUid: 'A1B2C3D4', source: 'offline', scanAt: Timestamp.fromDate(instant(date, '17:00')) }));
    await assertFails(updateDoc(ref, { end: '17:00', cardUid: 'A1B2C3D4', source: 'offline', scanAt: Timestamp.fromDate(instant(date, '17:00')) }));
  }
  // Elle girilmiş 08:00–18:00 gününe öğlen okutması sonradan gelirse çıkış geri alınmaz.
  await seed(db => setDoc(doc(db, `entries/employee-1_${date}`), { id: `employee-1_${date}`, employeeId: 'employee-1', date, status: 'present', start: '08:00', end: '18:00', rate: 150 }));
  await assertFails(updateDoc(ref, { end: '12:00', cardUid: 'A1B2C3D4', source: 'offline', scanAt: Timestamp.fromDate(instant(date, '12:00')) }));
});

test('online scans cannot add, change or drop the offline markers of an existing entry', async t => {
  const now = turkeyNow();
  const minutes = Number(now.time.slice(0, 2)) * 60 + Number(now.time.slice(3, 5));
  if (minutes < 60) return t.skip('Türkiye gününün ilk saatinde aynı gün senaryosu kurulamıyor.');
  const oldEnd = plusMinutes('00:00', minutes - 30);
  const id = `employee-1_${now.date}`;
  const ref = doc(terminal(), `entries/${id}`);
  const scanAt = Timestamp.fromDate(instant(now.date, oldEnd));
  await seed(db => setDoc(doc(db, `entries/${id}`), entry(now.date, { start: plusMinutes('00:00', minutes - 60), end: oldEnd, source: 'offline', scanAt })));
  await assertFails(updateDoc(ref, { end: now.time, source: 'pc' }));
  const { deleteField } = await import('firebase/firestore');
  await assertFails(updateDoc(ref, { end: now.time, source: deleteField() }));
  await assertFails(updateDoc(ref, { end: now.time, scanAt: Timestamp.fromDate(instant(now.date, oldEnd, 30)) }));
  await assertSucceeds(updateDoc(ref, { end: turkeyNow().time, cardUid: 'A1B2C3D4' }));
});


// ---- 0.4.0 inceleme düzeltmeleri ----
const HOUR = 3_600_000;
const offlineAt = (ms, overrides = {}) => {
  const scan = scanAtMs(ms);
  return offlineClockIn(scan.date, scan.time, { scanAt: Timestamp.fromDate(scan.at), ...overrides });
};

test('A: card reassigned after the scan — offline replay for the new holder is refused (scanAt < assignedAt)', async () => {
  const scanDay = trDate(2);
  const assignDay = trDate(1);
  const assignedAt = instant(assignDay, '12:00');
  const remap = () => seed(db => setDoc(doc(db, 'cardUids/A1B2C3D4'), { employeeId: 'employee-1', cardUid: 'A1B2C3D4', assignedAt: Timestamp.fromDate(assignedAt) }));
  // Kart okutma sırasında başkasındaydı; okutmadan sonra employee-1'e verildi.
  await remap();
  const db = terminal();
  await assertFails(setDoc(doc(db, `clockIns/employee-1_${scanDay}`), offlineClockIn(scanDay, '10:00')));
  // Çıkış (günlük kayıt) da aynı kurala bağlı.
  await seed(seedDb => setDoc(doc(seedDb, `clockIns/employee-1_${scanDay}`), offlineClockIn(scanDay, '08:00', { at: Timestamp.now() })));
  const exitBatch = writeBatch(db);
  exitBatch.set(doc(db, `entries/employee-1_${scanDay}`), offlineExit(scanDay, '08:00', '17:00'));
  exitBatch.delete(doc(db, `clockIns/employee-1_${scanDay}`));
  await assertFails(exitBatch.commit());
  // Atamadan sonraki okutma yazılır; tam atama anı (scanAt == assignedAt) da kabul edilir.
  await assertSucceeds(setDoc(doc(db, `clockIns/employee-1_${assignDay}`), offlineClockIn(assignDay, '14:00')));
  await seed(seedDb => deleteDoc(doc(seedDb, `clockIns/employee-1_${assignDay}`)));
  await assertFails(setDoc(doc(db, `clockIns/employee-1_${assignDay}`), offlineClockIn(assignDay, '11:59', { scanAt: Timestamp.fromDate(new Date(assignedAt.getTime() - 1000)) })));
  await assertSucceeds(setDoc(doc(db, `clockIns/employee-1_${assignDay}`), offlineClockIn(assignDay, '12:00', { scanAt: Timestamp.fromDate(assignedAt) })));
});

test('A: legacy mappings without assignedAt work online but fail closed offline until upgraded', async () => {
  await seed(db => setDoc(doc(db, 'cardUids/A1B2C3D4'), { employeeId: 'employee-1', cardUid: 'A1B2C3D4' }));
  const legacy = offlineAt(Date.now() - 48 * HOUR);
  await assertFails(setDoc(doc(terminal(), `clockIns/${legacy.id}`), legacy));
  const now = turkeyNow();
  await assertSucceeds(setDoc(doc(terminal(), `clockIns/employee-1_${now.date}`), { id: `employee-1_${now.date}`, employeeId: 'employee-1', date: now.date, cardUid: 'A1B2C3D4', start: now.time, at: serverTimestamp() }));
  // Terminal damgayı ekleyemez; Kart Atama yetkisi aynı eşleşmeyi sunucu zamanı ile bir kez yükseltebilir.
  await assertFails(updateDoc(doc(env.authenticatedContext('terminal-cards-user').firestore(), 'cardUids/A1B2C3D4'), { assignedAt: Timestamp.fromMillis(0) }));
  await seed(db => setDoc(doc(db, 'users/cards-user'), { email: 'cards@example.com', name: 'Kart', admin: false, menus: ['cards'] }));
  const ref = doc(env.authenticatedContext('cards-user').firestore(), 'cardUids/A1B2C3D4');
  await assertFails(updateDoc(ref, { assignedAt: Timestamp.fromMillis(0) }));
  await assertSucceeds(updateDoc(ref, { assignedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { assignedAt: serverTimestamp() }));
});

test('A: offline scans dated before the employee start date are refused', async () => {
  await seed(db => setDoc(doc(db, 'employeeDirectory/employee-1'), directoryEmployee({ startDate: trDate(1) })));
  const early = offlineClockIn(trDate(2), '09:00');
  await assertFails(setDoc(doc(terminal(), `clockIns/${early.id}`), early));
  const onStart = offlineClockIn(trDate(1), '00:05');
  await assertSucceeds(setDoc(doc(terminal(), `clockIns/${onStart.id}`), onStart));
});

test('B: a late offline replay cannot overwrite a manual correction made after the scan', async () => {
  const date = trDate(3);
  const ref = doc(terminal(), `entries/employee-1_${date}`);
  const editedAt = Timestamp.fromDate(instant(date, '19:00'));
  await seed(db => setDoc(doc(db, `entries/employee-1_${date}`), entry(date, { start: '08:00', end: '17:00', source: 'offline', editedAt })));
  const extend = (end, second = 0) => updateDoc(ref, { end, cardUid: 'A1B2C3D4', source: 'offline', scanAt: Timestamp.fromDate(instant(date, end, second)) });
  await assertFails(extend('18:00'));
  await assertFails(extend('19:00'));   // tam düzeltme anı: düzeltme kazanır
  // Terminal damgayı silemez ya da değiştiremez.
  const { deleteField } = await import('firebase/firestore');
  await assertFails(updateDoc(ref, { end: '19:30', cardUid: 'A1B2C3D4', source: 'offline', scanAt: Timestamp.fromDate(instant(date, '19:30')), editedAt: deleteField() }));
  await assertFails(updateDoc(ref, { end: '19:30', cardUid: 'A1B2C3D4', source: 'offline', scanAt: Timestamp.fromDate(instant(date, '19:30')), editedAt: Timestamp.fromDate(instant(date, '07:00')) }));
  // Düzeltmeden sonra okutulan kart ileri alabilir; damga korunur.
  await assertSucceeds(extend('19:30', 5));
});

test('B: a pre-0.4 card entry without source/editedAt is never extended by a late offline replay', async () => {
  const date = trDate(3);
  const ref = doc(terminal(), `entries/employee-1_${date}`);
  await seed(db => setDoc(doc(db, `entries/employee-1_${date}`), entry(date, { start: '08:00', end: '17:00' })));
  await assertFails(updateDoc(ref, { end: '18:00', source: 'offline', scanAt: Timestamp.fromDate(instant(date, '18:00')) }));
});

test('B: an offline replay cannot add a card to a manual day that had none', async () => {
  const date = trDate(2);
  const ref = doc(terminal(), `entries/employee-1_${date}`);
  // Elle girilmiş gün: kart yok, damga yok (eski kayıt) ya da var.
  for (const extra of [{}, { editedAt: Timestamp.fromDate(instant(date, '06:00')) }]) {
    await seed(db => setDoc(doc(db, `entries/employee-1_${date}`), { id: `employee-1_${date}`, employeeId: 'employee-1', date, status: 'present', start: '08:00', end: '12:00', rate: null, ...extra }));
    await assertFails(updateDoc(ref, { end: '17:00', cardUid: 'A1B2C3D4', source: 'offline', scanAt: Timestamp.fromDate(instant(date, '17:00')) }));
  }
});

test('B: online scans keep the manual stamp untouched', async t => {
  const now = turkeyNow();
  const minutes = Number(now.time.slice(0, 2)) * 60 + Number(now.time.slice(3, 5));
  if (minutes < 60) return t.skip('Türkiye gününün ilk saatinde aynı gün senaryosu kurulamıyor.');
  const id = `employee-1_${now.date}`;
  const editedAt = Timestamp.fromMillis(Date.now() - 40 * 60_000);
  await seed(db => setDoc(doc(db, `entries/${id}`), entry(now.date, { start: plusMinutes('00:00', minutes - 60), end: plusMinutes('00:00', minutes - 30), cardUid: 'A1B2C3D4', editedAt })));
  const ref = doc(terminal(), `entries/${id}`);
  await assertFails(updateDoc(ref, { end: turkeyNow().time, editedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref, { end: turkeyNow().time, cardUid: 'A1B2C3D4' }));
});
