// Kart Okutma terminali için Firestore kuralları: yalnız bugünün kaydına, şu anki saatle giriş/çıkış yazılabilir.
import test, { after, before, beforeEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { turkeyNow } from './clock.js';

const projectId = 'demo-open-attendance-rules';
let env;
const at = minutesAgo => {
  const now = turkeyNow();
  const currentMinute = Number(now.time.slice(0, 2)) * 60 + Number(now.time.slice(3, 5));
  const minute = Math.max(0, Math.min(1439, currentMinute - minutesAgo));
  return { date: now.date, time: `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}` };
};
const outsideWindowTime = () => {
  const now = turkeyNow();
  const currentMinute = Number(now.time.slice(0, 2)) * 60 + Number(now.time.slice(3, 5));
  const minute = currentMinute <= 1429 ? currentMinute + 10 : currentMinute - 10;
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
};
const differentTime = value => {
  const minute = Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const changed = minute === 1439 ? 1438 : minute + 1;
  return `${String(Math.floor(changed / 60)).padStart(2, '0')}:${String(changed % 60).padStart(2, '0')}`;
};
const today = () => turkeyNow().date;
const yesterday = () => turkeyNow(new Date(Date.now() - 86_400_000)).date;
const clockIn = (overrides = {}) => {
  const date = overrides.date || today();
  const employeeId = overrides.employeeId || 'employee-1';
  return { id: `${employeeId}_${date}`, employeeId, date, cardUid: 'A1B2C3D4', start: at(0).time, at: serverTimestamp(), ...overrides };
};
const entry = (overrides = {}) => {
  const date = overrides.date || today();
  return { id: `employee-1_${date}`, employeeId: 'employee-1', date, status: 'present', start: at(60).time, end: at(0).time, rate: null, ...overrides };
};
const terminalEntry = (overrides = {}) => entry({ cardUid: 'A1B2C3D4', ...overrides });
// Puantaj yetkilisinin yazımı (0.4.0): editedAt sunucu saati olmalı.
const manual = (value = entry()) => ({ ...value, editedAt: serverTimestamp() });
const directoryEmployee = (overrides = {}) => ({
  id: 'employee-1', name: 'Çalışan 1', company: 'Demo Şirket', startDate: '2026-01-01', endDate: '', active: true, overtimeRate: 175, ...overrides,
});
const terminal = () => env.authenticatedContext('terminal-user').firestore();
const seed = fn => env.withSecurityRulesDisabled(context => fn(context.firestore()));
const boundaryDb = () => env.authenticatedContext('__clock-rule-test__').firestore();
const boundaryWrite = (id, date, time, instant) => setDoc(doc(boundaryDb(), `__clockRuleTests/${id}`), { date, time, now: Timestamp.fromDate(instant) });
const withBoundaryHarness = source => {
  const rules = source.replace(/\r\n/g, '\n');
  const closing = '\n  }\n}';
  const index = rules.lastIndexOf(closing);
  if (index < 0) throw new Error('Firestore rules test harness could not be inserted.');
  const harness = `
    // Test-only match: production rules are left unchanged.
    match /__clockRuleTests/{testId} {
      allow create: if request.auth.uid == '__clock-rule-test__'
        && request.resource.data.keys().hasOnly(['date', 'time', 'now'])
        && request.resource.data.keys().hasAll(['date', 'time', 'now'])
        && request.resource.data.now is timestamp
        && validDate(request.resource.data.date)
        && validTime(request.resource.data.time)
        && nearDateTimeTr(request.resource.data.date, request.resource.data.time, request.resource.data.now);
      allow read, update, delete: if false;
    }
`;
  return rules.slice(0, index) + harness + rules.slice(index);
};

before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: withBoundaryHarness(await readFile(new URL('../firestore.rules', import.meta.url), 'utf8')) },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed(async db => {
    await setDoc(doc(db, 'users/terminal-user'), { email: 'kapi@example.com', name: 'Kapı', admin: false, menus: ['terminal'] });
    await setDoc(doc(db, 'users/timesheet-user'), { email: 'time@example.com', name: 'Puantaj', admin: false, menus: ['timesheet'] });
    await setDoc(doc(db, 'users/cards-user'), { email: 'cards@example.com', name: 'Kart', admin: false, menus: ['cards'] });
    await setDoc(doc(db, 'users/terminal-cards-user'), { email: 'both@example.com', name: 'Kapı ve Kart', admin: false, menus: ['terminal', 'cards'] });
    await setDoc(doc(db, 'employeeDirectory/employee-1'), directoryEmployee());
    await setDoc(doc(db, 'employeeDirectory/employee-2'), directoryEmployee({ id: 'employee-2', name: 'Çalışan 2' }));
    await setDoc(doc(db, 'cardDirectory/employee-1'), { id: 'employee-1', name: 'Çalışan 1', company: 'Demo Şirket', active: true, endDate: '' });
    await setDoc(doc(db, 'cardUids/A1B2C3D4'), { employeeId: 'employee-1', cardUid: 'A1B2C3D4' });
    await setDoc(doc(db, 'cardUids/B1B2C3D4'), { employeeId: 'employee-2', cardUid: 'B1B2C3D4' });
    await setDoc(doc(db, 'employeeCards/employee-1'), { employeeId: 'employee-1', cardUid: 'A1B2C3D4' });
    await setDoc(doc(db, 'cardInventory/A1B2C3D4'), { cardUid: 'A1B2C3D4', label: '001', lost: false, events: 1 });
  });
});

after(async () => env?.cleanup());

// 0.4.0: çevrimdışı okutmalar için son 7 günün tek kaydı okunabilir; daha eskisi okunamaz (offline-rules.test.js).
const nineDaysAgo = () => turkeyNow(new Date(Date.now() - 9 * 86_400_000)).date;
test('terminal reads only what one scan needs: the card owner, the name and a recent entry', async () => {
  await seed(async db => {
    await setDoc(doc(db, `entries/employee-1_${nineDaysAgo()}`), entry({ date: nineDaysAgo(), start: '08:00', end: '18:00' }));
  });
  const db = terminal();
  await assertSucceeds(getDoc(doc(db, 'cardUids/A1B2C3D4')));
  await assertSucceeds(getDoc(doc(db, 'cardDirectory/employee-1')));
  await assertSucceeds(getDoc(doc(db, `entries/employee-1_${today()}`)));
  await assertFails(getDoc(doc(db, `entries/employee-1_${nineDaysAgo()}`)));
  await assertFails(getDocs(collection(db, 'entries')));
  await assertFails(getDocs(collection(db, 'cardUids')));
  await assertFails(getDoc(doc(db, 'employees/employee-1')));
  await assertFails(getDoc(doc(db, 'employeeDirectory/employee-1')));
});

test('terminal opens today\'s clock-in with the current time for the card\'s own employee', async () => {
  await assertSucceeds(setDoc(doc(terminal(), `clockIns/employee-1_${today()}`), clockIn()));
});

test('Turkish midnight accepts only the request-time calendar date within three minutes', async () => {
  const midnightTr = new Date('2026-11-09T21:00:00.000Z'); // 10.11.2026 00:00 Türkiye
  await assertSucceeds(boundaryWrite('midnight', '2026-11-10', '00:00', midnightTr));
  await assertSucceeds(boundaryWrite('one-minute', '2026-11-10', '00:01', midnightTr));
  await assertSucceeds(boundaryWrite('three-minutes', '2026-11-10', '00:03', midnightTr));
  await assertFails(boundaryWrite('previous-day', '2026-11-09', '23:59', midnightTr));
  await assertFails(boundaryWrite('outside-window', '2026-11-10', '00:04', midnightTr));
});

test('terminal can get only a recent required clock-in and can never list clock-ins', async () => {
  await seed(async db => {
    await setDoc(doc(db, `clockIns/employee-1_${today()}`), clockIn());
    await setDoc(doc(db, `clockIns/employee-1_${nineDaysAgo()}`), clockIn({ date: nineDaysAgo(), start: '08:00' }));
  });
  const db = terminal();
  await assertSucceeds(getDoc(doc(db, `clockIns/employee-1_${today()}`)));
  await assertFails(getDoc(doc(db, `clockIns/employee-1_${nineDaysAgo()}`)));
  await assertFails(getDocs(collection(db, 'clockIns')));
});

test('forged clock-ins are rejected', async () => {
  const db = terminal();
  const ref = doc(db, `clockIns/employee-1_${today()}`);
  await assertFails(setDoc(ref, clockIn({ start: outsideWindowTime() })));
  await assertFails(setDoc(doc(db, `clockIns/employee-2_${today()}`), clockIn({ employeeId: 'employee-2' })));
  await assertFails(setDoc(doc(db, `clockIns/employee-1_${yesterday()}`), clockIn({ date: yesterday() })));
  await assertFails(setDoc(ref, { ...clockIn(), extra: true }));
  await assertFails(setDoc(ref, { ...clockIn(), at: new Date() }));
  await assertFails(setDoc(ref, clockIn({ cardUid: 'B1B2C3D4' })));
  await assertFails(setDoc(doc(env.authenticatedContext('timesheet-user').firestore(), `clockIns/employee-1_${today()}`), clockIn()));
  await assertFails(setDoc(doc(env.authenticatedContext('cards-user').firestore(), `clockIns/employee-1_${today()}`), clockIn()));
});

test('no clock-in for an employee who has left or who already has today\'s entry', async () => {
  await seed(db => setDoc(doc(db, 'employeeDirectory/employee-1'), directoryEmployee({ active: false })));
  await assertFails(setDoc(doc(terminal(), `clockIns/employee-1_${today()}`), clockIn()));
  await seed(async db => {
    await setDoc(doc(db, 'employeeDirectory/employee-1'), directoryEmployee());
    await setDoc(doc(db, `entries/employee-1_${today()}`), entry());
  });
  await assertFails(setDoc(doc(terminal(), `clockIns/employee-1_${today()}`), clockIn()));
});

test('clock-out writes the entry from the open clock-in and closes it in the same write', async () => {
  const start = at(60).time;
  await seed(db => setDoc(doc(db, `clockIns/employee-1_${today()}`), clockIn({ start })));
  const db = terminal();
  const id = `employee-1_${today()}`;
  const write = (value, closeClockIn = true) => {
    const batch = writeBatch(db);
    batch.set(doc(db, `entries/${id}`), value);
    if (closeClockIn) batch.delete(doc(db, `clockIns/${id}`));
    return batch.commit();
  };
  await assertFails(write(terminalEntry({ start }), false));
  await assertFails(write(terminalEntry({ start: differentTime(start) })));
  await assertFails(write(terminalEntry({ start, rate: 175 })));
  await assertFails(write(terminalEntry({ start, end: outsideWindowTime() })));
  await assertFails(write(terminalEntry({ start, status: 'leave' })));
  await assertFails(write(entry({ start })));
  await assertFails(write(terminalEntry({ start, cardUid: 'B1B2C3D4' })));
  await assertSucceeds(write(terminalEntry({ start })));
});

test('terminal clock-out requires at least fifteen same-day minutes', async t => {
  const fourteen = at(14).time;
  const fifteen = at(15).time;
  if (fourteen === fifteen) return t.skip('Türkiye gününün ilk 15 dakikasında aynı gün sınırı kurulamıyor.');
  const db = terminal();
  const id = `employee-1_${today()}`;
  const write = async start => {
    await seed(seedDb => setDoc(doc(seedDb, `clockIns/${id}`), clockIn({ start })));
    const batch = writeBatch(db);
    batch.set(doc(db, `entries/${id}`), terminalEntry({ start }));
    batch.delete(doc(db, `clockIns/${id}`));
    return batch.commit();
  };
  await assertFails(write(fourteen));
  await assertSucceeds(write(fifteen));
});

test('without an open clock-in the terminal cannot invent a working day', async () => {
  const db = terminal();
  const batch = writeBatch(db);
  batch.set(doc(db, `entries/employee-1_${today()}`), entry());
  batch.delete(doc(db, `clockIns/employee-1_${today()}`));
  await assertFails(batch.commit());
});

test('a later scan only moves today\'s exit time forward', async () => {
  await seed(async db => {
    await setDoc(doc(db, `entries/employee-1_${today()}`), terminalEntry({ start: at(120).time, end: at(30).time }));
    await setDoc(doc(db, `entries/employee-1_${yesterday()}`), entry({ date: yesterday(), start: '08:00', end: '09:00' }));
  });
  const ref = doc(terminal(), `entries/employee-1_${today()}`);
  await assertFails(updateDoc(ref, { end: at(0).time, start: differentTime(at(120).time) }));
  await assertFails(updateDoc(ref, { end: at(0).time, rate: 100 }));
  await assertFails(updateDoc(ref, { end: at(40).time }));
  await assertFails(updateDoc(ref, { status: 'leave' }));
  await assertFails(updateDoc(ref, { end: at(0).time, cardUid: 'B1B2C3D4' }));
  await assertFails(updateDoc(doc(terminal(), `entries/employee-1_${yesterday()}`), { end: at(0).time }));
  await assertSucceeds(updateDoc(ref, { end: at(0).time }));
});

test('terminal exit extension requires at least fifteen minutes', async t => {
  const fourteen = at(14).time;
  const fifteen = at(15).time;
  if (fourteen === fifteen) return t.skip('Türkiye gününün ilk 15 dakikasında aynı gün sınırı kurulamıyor.');
  const ref = doc(terminal(), `entries/employee-1_${today()}`);
  await seed(db => setDoc(doc(db, `entries/employee-1_${today()}`), terminalEntry({ start: at(60).time, end: fourteen })));
  await assertFails(updateDoc(ref, { end: at(0).time }));
  await seed(db => setDoc(doc(db, `entries/employee-1_${today()}`), terminalEntry({ start: at(60).time, end: fifteen })));
  await assertSucceeds(updateDoc(ref, { end: at(0).time }));
});

test('returning a card cannot create or extend terminal records in the same atomic write', async t => {
  const start = at(60).time;
  const oldEnd = at(15).time;
  if (start === at(0).time || oldEnd === at(0).time) return t.skip('Türkiye gününün ilk saatinde aynı gün senaryosu kurulamıyor.');
  const db = env.authenticatedContext('terminal-cards-user').firestore();
  const id = `employee-1_${today()}`;
  const addReturn = batch => {
    batch.delete(doc(db, 'employeeCards/employee-1'));
    batch.delete(doc(db, 'cardUids/A1B2C3D4'));
    batch.update(doc(db, 'cardInventory/A1B2C3D4'), { events: 2 });
    batch.set(doc(db, 'cardHistory/A1B2C3D4_2'), {
      cardUid: 'A1B2C3D4', employeeId: 'employee-1', employeeName: 'Çalışan 1', action: 'returned', date: today(), at: serverTimestamp(),
    });
    return batch;
  };

  const clockBatch = addReturn(writeBatch(db));
  clockBatch.set(doc(db, `clockIns/${id}`), clockIn({ start: at(0).time }));
  await assertFails(clockBatch.commit());

  await seed(seedDb => setDoc(doc(seedDb, `clockIns/${id}`), clockIn({ start })));
  const createBatch = addReturn(writeBatch(db));
  createBatch.set(doc(db, `entries/${id}`), terminalEntry({ start }));
  createBatch.delete(doc(db, `clockIns/${id}`));
  await assertFails(createBatch.commit());

  await seed(async seedDb => {
    await deleteDoc(doc(seedDb, `clockIns/${id}`));
    await setDoc(doc(seedDb, `entries/${id}`), terminalEntry({ start: at(60).time, end: oldEnd }));
  });
  const extendBatch = addReturn(writeBatch(db));
  extendBatch.update(doc(db, `entries/${id}`), { end: at(0).time });
  await assertFails(extendBatch.commit());

  await assertSucceeds(updateDoc(doc(db, `entries/${id}`), { end: at(0).time }));
});

test('a legacy entry can be bound once to the scanned employee card, then the terminal cannot change it', async () => {
  const ref = doc(terminal(), `entries/employee-1_${today()}`);
  await seed(db => setDoc(doc(db, `entries/employee-1_${today()}`), entry({ start: at(120).time, end: at(30).time })));
  await assertFails(updateDoc(ref, { end: at(0).time }));
  await assertFails(updateDoc(ref, { end: at(0).time, cardUid: 'B1B2C3D4' }));
  await assertSucceeds(updateDoc(ref, { end: at(0).time, cardUid: 'A1B2C3D4' }));
});

test('the exit time is never moved backwards, even within the allowed clock difference', async () => {
  await seed(db => setDoc(doc(db, `entries/employee-1_${today()}`), terminalEntry({ start: at(120).time, end: at(-2).time })));
  await assertFails(updateDoc(doc(terminal(), `entries/employee-1_${today()}`), { end: at(0).time }));
});

test('leave and absence days are never changed from the terminal', async () => {
  await seed(db => setDoc(doc(db, `entries/employee-1_${today()}`), { id: `employee-1_${today()}`, employeeId: 'employee-1', date: today(), status: 'leave', rate: null }));
  await assertFails(updateDoc(doc(terminal(), `entries/employee-1_${today()}`), { status: 'present', start: at(60).time, end: at(0).time }));
});

test('open clock-ins are closed with the matching timesheet entry, never edited, and not deleted on their own', async () => {
  await seed(db => setDoc(doc(db, `clockIns/employee-1_${today()}`), clockIn({ start: at(60).time })));
  const ref = `clockIns/employee-1_${today()}`;
  await assertFails(updateDoc(doc(terminal(), ref), { start: at(0).time }));
  await assertFails(deleteDoc(doc(terminal(), ref)));
  await assertFails(deleteDoc(doc(env.authenticatedContext('cards-user').firestore(), ref)));
  await assertSucceeds(getDocs(collection(env.authenticatedContext('timesheet-user').firestore(), 'clockIns')));
  const timesheet = env.authenticatedContext('timesheet-user').firestore();
  await assertFails(deleteDoc(doc(timesheet, ref)));
  const batch = writeBatch(timesheet);
  batch.set(doc(timesheet, `entries/employee-1_${today()}`), manual(entry({ start: at(60).time })));
  batch.delete(doc(timesheet, ref));
  await assertSucceeds(batch.commit());
});

test('timesheet entry create and update must atomically close a pre-existing matching clock-in', async () => {
  const timesheet = env.authenticatedContext('timesheet-user').firestore();
  const id = `employee-1_${today()}`;
  const entryRef = doc(timesheet, `entries/${id}`);
  const clockRef = doc(timesheet, `clockIns/${id}`);

  await seed(db => setDoc(doc(db, `clockIns/${id}`), clockIn({ start: at(60).time })));
  await assertFails(setDoc(entryRef, manual(entry({ start: at(60).time }))));
  const createBatch = writeBatch(timesheet);
  createBatch.set(entryRef, manual(entry({ start: at(60).time })));
  createBatch.delete(clockRef);
  await assertSucceeds(createBatch.commit());

  await seed(db => setDoc(doc(db, `clockIns/${id}`), clockIn({ start: at(60).time })));
  await assertFails(updateDoc(entryRef, { end: at(-1).time, editedAt: serverTimestamp() }));
  const updateBatch = writeBatch(timesheet);
  updateBatch.update(entryRef, { end: at(-1).time, editedAt: serverTimestamp() });
  updateBatch.delete(clockRef);
  await assertSucceeds(updateBatch.commit());
});

test('0.3.x timesheet writes remain compatible; v0.4 stamps editedAt and forged stamps are refused', async () => {
  const timesheet = env.authenticatedContext('timesheet-user').firestore();
  const ref = doc(timesheet, `entries/employee-1_${today()}`);
  await assertSucceeds(setDoc(ref, entry()));
  await assertSucceeds(updateDoc(ref, { end: at(-1).time }));
  await assertFails(setDoc(ref, { ...entry(), editedAt: Timestamp.fromDate(new Date(Date.now() - 60_000)) }));
  await assertSucceeds(setDoc(ref, manual()));
  // Eski istemcinin tam belge setDoc yazımı mevcut v0.4 damgasını silemez.
  await assertFails(setDoc(ref, entry()));
  await assertFails(updateDoc(ref, { end: at(-1).time }));
  await assertSucceeds(updateDoc(ref, { end: at(-1).time, editedAt: serverTimestamp() }));
});
