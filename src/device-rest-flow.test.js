// Wi-Fi kart okuyucunun REST isteklerini (device-rest.js, firmware ile aynı biçim) emülatördeki gerçek kurallarla dener.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { deviceClockScan, turkeyParts } from './device-rest.js';

const projectId = 'demo-open-attendance-device';
let env;
const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const docPrefix = `projects/${projectId}/databases/(default)/documents`;
const baseUrl = `http://${host}/v1/${docPrefix}`;
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const tokenFor = (uid, email) => {
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: `https://securetoken.google.com/${projectId}`, aud: projectId, iat: now, exp: now + 3600, auth_time: now,
    sub: uid, user_id: uid, email, email_verified: false, firebase: { sign_in_provider: 'password', identities: {} },
  })}.`;
};
const device = tokenFor('device-user', 'kapi@example.com');
const nowEpoch = () => Math.floor(Date.now() / 1000);
const trEpoch = (date, time) => Math.floor(new Date(`${date}T${time}:00+03:00`).getTime() / 1000);
const daysAgo = days => turkeyParts(nowEpoch() - days * 86400).date;
const scan = (cardUid, scanEpoch, extra = {}) => deviceClockScan({ fetch, baseUrl, docPrefix, token: device, cardUid, scanEpoch, nowEpoch: nowEpoch(), ...extra });
const read = async path => {
  let value;
  await env.withSecurityRulesDisabled(async context => { value = (await getDoc(doc(context.firestore(), path))).data(); });
  return value;
};

before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'users/device-user'), { email: 'kapi@example.com', name: 'Kapı cihazı', admin: false, menus: ['terminal'] });
    await setDoc(doc(db, 'users/timesheet-user'), { email: 'time@example.com', name: 'Puantaj', admin: false, menus: ['timesheet'] });
    for (const [id, name, active, card] of [['employee-1', 'Ömer Çelik', true, 'A1B2C3D4'], ['employee-2', 'Ayrılan Kişi', false, 'B1B2C3D4']]) {
      await setDoc(doc(db, `employeeDirectory/${id}`), { id, name, company: 'Demo Şirket', startDate: '2026-01-01', endDate: '', active, overtimeRate: null });
      await setDoc(doc(db, `cardDirectory/${id}`), { id, name, company: 'Demo Şirket', active, endDate: '' });
      await setDoc(doc(db, `cardUids/${card}`), { employeeId: id, cardUid: card, assignedAt: Timestamp.fromMillis(Date.now() - 30 * 86400_000) });
      await setDoc(doc(db, `employeeCards/${id}`), { employeeId: id, cardUid: card });
    }
  });
});
after(async () => env?.cleanup());

test('device REST flow: offline day replayed in order (in, out, extend, repeat) is written with offline marks', async () => {
  const date = daysAgo(2);
  const id = `employee-1_${date}`;
  const first = await scan('A1B2C3D4', trEpoch(date, '08:01'));
  assert.equal(first.action, 'in');
  assert.equal(first.name, 'Ömer Çelik');
  const open = await read(`clockIns/${id}`);
  assert.equal(open.source, 'offline');
  assert.equal(open.start, '08:01');
  assert.ok(open.at && open.scanAt);
  assert.equal((await scan('A1B2C3D4', trEpoch(date, '08:10'))).action, 'repeat');
  assert.equal((await scan('A1B2C3D4', trEpoch(date, '17:02'))).action, 'out');
  const closed = await read(`entries/${id}`);
  assert.deepEqual({ ...closed, scanAt: undefined }, { id, employeeId: 'employee-1', date, status: 'present', start: '08:01', end: '17:02', rate: null, cardUid: 'A1B2C3D4', source: 'offline', scanAt: undefined });
  assert.equal(await read(`clockIns/${id}`), undefined);
  assert.equal((await scan('A1B2C3D4', trEpoch(date, '17:40'))).action, 'extend');
  assert.equal((await read(`entries/${id}`)).end, '17:40');
  // Aynı okutma güç kesintisi sonrası tekrar gönderilirse kayıt değişmez.
  assert.equal((await scan('A1B2C3D4', trEpoch(date, '17:40'))).action, 'repeat');
});

test('device REST flow: a live scan uses the strict online path without offline marks', async () => {
  const now = nowEpoch();
  const result = await scan('A1B2C3D4', now);
  assert.equal(result.action, 'in');
  const open = await read(`clockIns/employee-1_${turkeyParts(now).date}`);
  assert.equal(open.source, undefined);
  assert.equal(open.scanAt, undefined);
});

test('device REST flow: a concurrent identical scan is reread and resolved as repeat instead of being discarded', async () => {
  const now = nowEpoch();
  const date = turkeyParts(now).date;
  const id = `employee-1_${date}`;
  let injected = false;
  const result = await scan('A1B2C3D4', now, {
    beforeCommit: async () => {
      if (injected) return;
      injected = true;
      await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), `clockIns/${id}`), {
        id, employeeId: 'employee-1', date, cardUid: 'A1B2C3D4', start: turkeyParts(now).time,
      }));
    },
  });
  assert.equal(injected, true);
  assert.equal(result.action, 'repeat');
  assert.equal((await read(`clockIns/${id}`)).start, turkeyParts(now).time);
});

test('device REST flow: a concurrent manual correction is reread and preserved', async () => {
  const now = nowEpoch();
  const date = turkeyParts(now).date;
  const id = `employee-1_${date}`;
  let injected = false;
  const result = await scan('A1B2C3D4', now, {
    beforeCommit: async () => {
      if (injected) return;
      injected = true;
      await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), `entries/${id}`), {
        id, employeeId: 'employee-1', date, status: 'leave', rate: null,
      }));
    },
  });
  assert.equal(injected, true);
  assert.equal(result.action, 'blocked');
  assert.equal((await read(`entries/${id}`)).status, 'leave');
  assert.equal(await read(`clockIns/${id}`), undefined);
});

test('device REST flow: a card returned during commit retry is treated as moved, never unknown', async () => {
  const now = nowEpoch();
  let injected = false;
  const result = await scan('A1B2C3D4', now, {
    beforeCommit: async () => {
      if (injected) return;
      injected = true;
      await env.withSecurityRulesDisabled(context => deleteDoc(doc(context.firestore(), 'cardUids/A1B2C3D4')));
    },
  });
  assert.equal(injected, true);
  assert.equal(result.error, 'moved');
  assert.equal(await read(`clockIns/employee-1_${turkeyParts(now).date}`), undefined);
  assert.equal(await read(`clockIns/employee-2_${turkeyParts(now).date}`), undefined);
});

test('device REST flow: original owner survives queue-level retries and a later reassignment cannot consume the scan', async () => {
  const now = nowEpoch();
  const ownerState = {};
  let commitAttempts = 0;
  const conflictFetch = async (url, options) => {
    if (String(url).endsWith(':commit')) {
      commitAttempts++;
      return new Response(JSON.stringify({ error: { code: 400 } }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
    return fetch(url, options);
  };
  const retained = await deviceClockScan({ fetch: conflictFetch, baseUrl, docPrefix, token: device, cardUid: 'A1B2C3D4', scanEpoch: now, nowEpoch: now, ownerState });
  assert.equal(commitAttempts, 3);
  assert.equal(retained.error, 'retry');
  assert.equal(ownerState.employeeId, 'employee-1');
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await deleteDoc(doc(db, 'cardUids/A1B2C3D4'));
    await setDoc(doc(db, 'cardUids/A1B2C3D4'), { employeeId: 'employee-2', cardUid: 'A1B2C3D4', assignedAt: Timestamp.now() });
  });
  const replay = await deviceClockScan({ fetch, baseUrl, docPrefix, token: device, cardUid: 'A1B2C3D4', scanEpoch: now, nowEpoch: now, ownerState });
  assert.equal(replay.error, 'moved');
  assert.equal(await read(`clockIns/employee-1_${turkeyParts(now).date}`), undefined);
  assert.equal(await read(`clockIns/employee-2_${turkeyParts(now).date}`), undefined);
});

test('device REST flow: a persistent commit 400/404 becomes bad after bounded queue cycles; 409 contention keeps retrying', async () => {
  const now = nowEpoch();
  const failing = status => async (url, options) => String(url).endsWith(':commit')
    ? new Response(JSON.stringify({ error: { code: status } }), { status, headers: { 'content-type': 'application/json' } })
    : fetch(url, options);
  for (const status of [400, 404]) {
    const ownerState = {};
    const run = () => deviceClockScan({ fetch: failing(status), baseUrl, docPrefix, token: device, cardUid: 'A1B2C3D4', scanEpoch: now, nowEpoch: now, ownerState });
    assert.equal((await run()).error, 'retry');
    assert.equal((await run()).error, 'retry');
    assert.deepEqual(await run(), { error: 'bad', status, stage: 'commit' });
  }
  const contention = {};
  for (let i = 0; i < 5; i++) {
    const result = await deviceClockScan({ fetch: failing(409), baseUrl, docPrefix, token: device, cardUid: 'A1B2C3D4', scanEpoch: now, nowEpoch: now, ownerState: contention });
    assert.equal(result.error, 'retry');
  }
  assert.equal(await read(`clockIns/employee-1_${turkeyParts(now).date}`), undefined);
});

test('device REST flow: unknown card, employee who left, leave day, too old and rule denials', async () => {
  assert.equal((await scan('C1C2C3C4', nowEpoch())).action, 'unknown');
  assert.equal((await scan('B1B2C3D4', nowEpoch())).action, 'left');
  const leaveDay = daysAgo(3);
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), `entries/employee-1_${leaveDay}`), { id: `employee-1_${leaveDay}`, employeeId: 'employee-1', date: leaveDay, status: 'leave', rate: null }));
  const blocked = await scan('A1B2C3D4', trEpoch(leaveDay, '09:00'));
  assert.equal(blocked.action, 'blocked');
  assert.equal(blocked.reason, 'leave');
  assert.equal((await read(`entries/employee-1_${leaveDay}`)).status, 'leave');
  assert.deepEqual(await scan('A1B2C3D4', nowEpoch() - 8 * 86400), { error: 'old' });
  // Cihaz saati 10 dk ileri: kurallar reddeder, kayıt başarısız listesine gider.
  const ahead = nowEpoch() + 600;
  if (turkeyParts(ahead).date === turkeyParts(nowEpoch()).date) {
    const denied = await deviceClockScan({ fetch, baseUrl, docPrefix, token: device, cardUid: 'A1B2C3D4', scanEpoch: ahead, nowEpoch: ahead, forceOffline: true });
    assert.equal(denied.error, 'denied');
    assert.equal(denied.stage, 'commit');
  }
});

test('device REST flow A: a scan taken before the card was reassigned is not credited to the new holder (moved)', async () => {
  const scanDay = daysAgo(2);
  const assignedAt = new Date(`${daysAgo(1)}T12:00:00+03:00`);
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'cardUids/A1B2C3D4'), { employeeId: 'employee-1', cardUid: 'A1B2C3D4', assignedAt: Timestamp.fromDate(assignedAt) }));
  const moved = await scan('A1B2C3D4', trEpoch(scanDay, '09:00'));
  assert.equal(moved.error, 'moved');
  assert.equal(await read(`clockIns/employee-1_${scanDay}`), undefined);
  const after = await scan('A1B2C3D4', trEpoch(daysAgo(1), '13:00'));
  assert.equal(after.action, 'in');
});

test('device REST flow B: a late offline scan does not overwrite a day corrected by hand after the scan (edited)', async () => {
  const date = daysAgo(3);
  const id = `employee-1_${date}`;
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), `entries/${id}`), {
    id, employeeId: 'employee-1', date, status: 'present', start: '08:00', end: '17:00', rate: null, cardUid: 'A1B2C3D4', source: 'offline', editedAt: Timestamp.fromDate(new Date(`${date}T19:00:00+03:00`)),
  }));
  const late = await scan('A1B2C3D4', trEpoch(date, '18:00'));
  assert.equal(late.error, 'edited');
  assert.equal((await read(`entries/${id}`)).end, '17:00');
  assert.equal((await scan('A1B2C3D4', trEpoch(date, '19:30'))).action, 'extend');
  const after = await read(`entries/${id}`);
  assert.equal(after.end, '19:30');
  assert.ok(after.editedAt, 'elle düzeltme damgası korunur');
  // Kartsız elle girilmiş gün: çevrimdışı okutma kart ekleyemez.
  const manualDay = daysAgo(4);
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), `entries/employee-1_${manualDay}`), {
    id: `employee-1_${manualDay}`, employeeId: 'employee-1', date: manualDay, status: 'present', start: '08:00', end: '12:00', rate: null,
  }));
  assert.equal((await scan('A1B2C3D4', trEpoch(manualDay, '17:00'))).error, 'edited');
  assert.equal((await read(`entries/employee-1_${manualDay}`)).cardUid, undefined);
});

test('device REST flow B: a pre-0.4 card entry without source/editedAt fails closed', async () => {
  const date = daysAgo(3);
  const id = `employee-1_${date}`;
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), `entries/${id}`), {
    id, employeeId: 'employee-1', date, status: 'present', start: '08:00', end: '17:00', rate: null, cardUid: 'A1B2C3D4',
  }));
  assert.equal((await scan('A1B2C3D4', trEpoch(date, '18:00'))).error, 'edited');
  assert.equal((await read(`entries/${id}`)).end, '17:00');
});

test('device REST flow: an account without the terminal permission cannot even read the card owner', async () => {
  const other = await deviceClockScan({ fetch, baseUrl, docPrefix, token: tokenFor('timesheet-user', 'time@example.com'), cardUid: 'A1B2C3D4', scanEpoch: nowEpoch(), nowEpoch: nowEpoch() });
  assert.equal(other.error, 'readDenied');
});
