// Uçtan uca: data.js'teki gerçek Kart Okutma akışını Firestore + Auth emülatöründe, gerçek kurallarla çalıştırır.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { firebaseSession } from './data.js';
import { turkeyNow } from './clock.js';

const projectId = 'demo-open-attendance-clock';
const [host, firestorePort] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const emulator = { host, firestorePort: Number(firestorePort), authPort: Number(authHost.split(':')[1]) };
const config = { apiKey: 'demo-key', authDomain: `${projectId}.firebaseapp.com`, projectId, appId: 'demo-app' };
const base = `http://${host}:${firestorePort}/v1/projects/${projectId}/databases/(default)/documents`;
const owner = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

const toValue = value => {
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toValue(item)])) } };
  return { stringValue: String(value) };
};
const fromValue = value => {
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return value.timestampValue;
  return value;
};
async function seed(path, data) {
  const response = await fetch(`${base}/${path}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([key, item]) => [key, toValue(item)])) }) });
  assert.equal(response.ok, true, await response.text());
}
async function read(path) {
  const response = await fetch(`${base}/${path}`, { headers: owner });
  if (response.status === 404) return null;
  const body = await response.json();
  return Object.fromEntries(Object.entries(body.fields || {}).map(([key, item]) => [key, fromValue(item)]));
}
const employee = (id, name, overrides = {}) => ({
  id, name, company: 'Demo Şirket', startDate: '2026-01-01', endDate: '', active: true, salary: 30000, bank: 28000, overtimeRate: null,
  salaryHistory: [{ effectiveMonth: '2026-01', salary: 30000, bank: 28000 }], ...overrides,
});

let session, terminal;
const today = () => turkeyNow().date;
const sameDayMinutesAgo = minutes => {
  const now = turkeyNow();
  const currentMinute = Number(now.time.slice(0, 2)) * 60 + Number(now.time.slice(3, 5));
  if (currentMinute < minutes) return null;
  const minute = currentMinute - minutes;
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
};

before(async () => {
  await fetch(base, { method: 'DELETE', headers: owner });
  await fetch(`http://${authHost}/emulator/v1/projects/${projectId}/accounts`, { method: 'DELETE' });
  // Yönetici personeli ve kartları hazırlar.
  session = await firebaseSession(config, { emulator });
  await session.register('saat-admin@example.com', 'test-password-1', false);
  await seed(`users/${session.currentUser().uid}`, { email: 'saat-admin@example.com', name: 'Admin', admin: true, menus: [] });
  const admin = session.store({ uid: session.currentUser().uid, admin: true, menus: [] });
  await admin.saveEmployee(employee('e1', 'Ayşe Çelik'));
  await admin.saveEmployee(employee('e2', 'Ali Ayrılan', { endDate: '2026-02-01' }));
  for (const [uid, label] of [['A1B2C3D4', '001'], ['B1B2C3D4', '002'], ['C1C2C3D4', '003']]) await admin.addInventoryCard(uid, label);
  await admin.assignCard('e1', '', 'A1B2C3D4');
  // İşten ayrılan personelde kalmış kart (eski kayıt): kurallar atlanarak eklenir.
  await seed('cardUids/B1B2C3D4', { employeeId: 'e2', cardUid: 'B1B2C3D4' });
  await session.signOut();
  // Kapıdaki bilgisayar: yalnız Kart Okutma yetkisi.
  session = await firebaseSession(config, { emulator });
  await session.register('saat-kapi@example.com', 'test-password-2', false);
  const uid = session.currentUser().uid;
  await seed(`users/${uid}`, { email: 'saat-kapi@example.com', name: 'Kapı', admin: false, menus: ['terminal'] });
  terminal = session.store({ uid, admin: false, menus: ['terminal'] });
});
after(async () => { await session?.signOut(); });

test('first scan opens the day, an immediate second scan is ignored', async () => {
  const first = await terminal.clockCard('a1 b2 c3 d4');
  assert.equal(first.action, 'in');
  assert.equal(first.name, 'Ayşe Çelik');
  const open = await read(`clockIns/e1_${today()}`);
  assert.match(open.start, /^\d\d:\d\d$/);
  assert.equal((await terminal.clockCard('A1B2C3D4')).action, 'repeat');
  assert.equal(await read(`entries/e1_${today()}`), null);
});

test('scanning out writes the day with the clock-in time and a pending rate', async t => {
  // Giriş bir saat önce okutulmuş gibi açık girişin saati geri alınır.
  const earlier = sameDayMinutesAgo(60);
  if (!earlier) return t.skip('Türkiye gününün ilk saatinde aynı güne ait bir saat önceki okutma yoktur.');
  await seed(`clockIns/e1_${today()}`, { id: `e1_${today()}`, employeeId: 'e1', date: today(), cardUid: 'A1B2C3D4', start: earlier, at: new Date() });
  const result = await terminal.clockCard('A1B2C3D4');
  assert.equal(result.action, 'out');
  const entry = await read(`entries/e1_${today()}`);
  assert.deepEqual({ status: entry.status, start: entry.start, end: entry.end, rate: entry.rate, cardUid: entry.cardUid }, { status: 'present', start: earlier, end: result.end, rate: null, cardUid: 'A1B2C3D4' });
  assert.equal(await read(`clockIns/e1_${today()}`), null);
  assert.equal((await terminal.clockCard('A1B2C3D4')).action, 'repeat');
});

test('closing a clock-in opened offline by the Wi-Fi reader keeps the offline mark on the day', async t => {
  const earlier = sameDayMinutesAgo(60);
  if (!earlier) return t.skip('Türkiye gününün ilk saatinde aynı güne ait bir saat önceki okutma yoktur.');
  await fetch(`${base}/entries/e1_${today()}`, { method: 'DELETE', headers: owner });
  const scanAt = new Date(`${today()}T${earlier}:10+03:00`);
  await seed(`clockIns/e1_${today()}`, { id: `e1_${today()}`, employeeId: 'e1', date: today(), cardUid: 'A1B2C3D4', start: earlier, at: new Date(), source: 'offline', scanAt });
  const result = await terminal.clockCard('A1B2C3D4');
  assert.equal(result.action, 'out');
  const entry = await read(`entries/e1_${today()}`);
  assert.equal(entry.source, 'offline');
  assert.equal(entry.scanAt, undefined);
  assert.equal(entry.start, earlier);
  assert.equal(await read(`clockIns/e1_${today()}`), null);
});

test('unknown cards and employees who have left are not recorded', async () => {
  assert.deepEqual(await terminal.clockCard('C1C2C3D4'), { action: 'unknown', cardUid: 'C1C2C3D4' });
  assert.equal((await terminal.clockCard('B1B2C3D4')).action, 'left');
  assert.equal(await read(`clockIns/e2_${today()}`), null);
  await assert.rejects(terminal.clockCard('ZZZ'), /onaltılık/);
});

test('the terminal account cannot use payroll or card management screens', async () => {
  await assert.rejects(terminal.addInventoryCard('D1D2D3D4', '009'), /yetkiniz yok/);
  await assert.rejects(terminal.saveEntry({ id: 'e1_2026-01-05', employeeId: 'e1', date: '2026-01-05', status: 'present', start: '08:00', end: '18:00', rate: null }), /permission|PERMISSION/i);
});

test('timesheet save closes the matching open clock-in without a caller option', async () => {
  await session.signOut();
  session = await firebaseSession(config, { emulator });
  await session.signIn('saat-admin@example.com', 'test-password-1', false);
  const admin = session.store({ uid: session.currentUser().uid, admin: true, menus: [] });
  const day = '2026-11-02';
  await seed(`clockIns/e1_${day}`, { id: `e1_${day}`, employeeId: 'e1', date: day, cardUid: 'A1B2C3D4', start: '08:47', at: new Date() });
  await admin.saveEntry({ id: `e1_${day}`, employeeId: 'e1', date: day, status: 'present', start: '08:47', end: '18:00', rate: null });
  assert.equal((await read(`entries/e1_${day}`)).end, '18:00');
  assert.equal(await read(`clockIns/e1_${day}`), null);
});

test('deleting an employee with no entries still removes the open clock-in', async () => {
  const admin = session.store({ uid: session.currentUser().uid, admin: true, menus: [] });
  await admin.saveEmployee(employee('e3', 'Açık Girişli'));
  const day = '2026-11-03';
  await seed(`clockIns/e3_${day}`, { id: `e3_${day}`, employeeId: 'e3', date: day, cardUid: 'C1C2C3D4', start: '08:47', at: new Date() });
  await admin.deleteEmployee('e3');
  assert.equal(await read(`clockIns/e3_${day}`), null);
});
