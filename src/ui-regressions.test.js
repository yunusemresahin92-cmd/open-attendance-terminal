import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('./main.jsx', import.meta.url), 'utf8');
const dataSource = await readFile(new URL('./data.js', import.meta.url), 'utf8');
const firmwareSource = await readFile(new URL('../firmware/kart-okuyucu/kart-okuyucu.ino', import.meta.url), 'utf8');
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const firebaseDeployHelper = await readFile(new URL('../scripts/firebase-cli.mjs', import.meta.url), 'utf8');

test('normal workday overtime with a null rate uses the pending cell state', () => {
  assert.match(source, /calc\?\.overtimeMinutes > 0[\s\S]{0,200}shownEntry\.rate/);
});

test('blank entry rates do not claim a mutable tariff fallback', () => {
  assert.doesNotMatch(source, /Boşsa tarife:/);
  assert.match(source, /placeholder=\{offDay \? 'Ör\. 200' : 'Yetkili kişi onaylayacak'\}/);
});

test('reports describe all pending rates as overtime entries rather than holiday work', () => {
  assert.match(source, /\{row\.pendingRateDays\} mesai kaydı ücreti bekliyor/);
  assert.doesNotMatch(source, /Tatil günü çalışmalarından/);
});

test('salary history editor explains and enforces the 20-record limit', () => {
  assert.match(source, /rows\.length >= 20/);
  assert.match(source, /En fazla 20 maaş kaydı/);
});

test('Firebase deploy commands require an explicit caller-owned project and Node requirement', () => {
  assert.equal(packageJson.scripts['firebase:deploy'], 'node scripts/firebase-cli.mjs hosting');
  assert.equal(packageJson.scripts['firebase:rules'], 'node scripts/firebase-cli.mjs rules');
  assert.match(firebaseDeployHelper, /process\.env\.FIREBASE_PROJECT_ID/);

  assert.equal(packageJson.engines.node, '>=24.12.0');
});

test('client explains Firestore limits before settings writes fail', () => {
  assert.match(dataSource, /En fazla 10 hesaplama kuralı revizyonu/);
  assert.match(dataSource, /En fazla 5 şirket/);
});

test('card assignment has its own protected navigation and management screen', () => {
  assert.match(source, /canSee\(profile, 'cards'\)/);
  assert.match(source, /<CardAssignmentsPage/);
  assert.match(source, /store\.assignCard/);
  assert.match(source, /store\.removeCard/);
});

test('daily attendance can be exported separately from the monthly payroll report', () => {
  assert.match(source, /exportDailyXlsx/);
  assert.match(source, /Personel-Gunluk-Giris-Cikis-/);
  assert.match(source, /Günlük Excel/);
});

test('screen dates and spreadsheet date columns use Turkish numeric formatting', () => {
  assert.match(source, /formatDateTr\(today\)/);
  assert.match(source, /formatDateTr\(item\.startDate\)/);
  assert.match(source, /formatDateTr\(day\.date\)/);
  assert.match(source, /formatDateTr\(row\.date\)/);
  assert.match(source, /Personel-Gunluk-Giris-Cikis-\$\{formatDateTr\(selectedDay\)\}/);
});

test('monthly periods use numeric month-year formatting throughout the UI and report heading', () => {
  assert.doesNotMatch(source, /monthLabel\(/);
  assert.match(source, /formatMonthTr\(month\)/);
  assert.match(source, /formatMonthTr\(value\)/);
});

test('clearing the daily export date cannot put the app into an invalid month state', () => {
  assert.match(source, /aria-label="Günlük Excel tarihi"[^>]*onChange=\{event => \{ if \(!formatDateTr\(event\.target\.value\)\) return;/);
});

test('cards are given from the free-card list and never to employees who have left', () => {
  assert.match(source, /availableCards\(inventory, cards\)/);
  assert.match(source, /!isEmployeeLeaving\(item, today\) \|\| assignments\.has\(item\.id\)/);
  assert.match(source, /disabled=\{!value \|\| leaving\}/);
});

test('saving an employee who has left offers the card return dialog', () => {
  assert.match(source, /await store\.saveEmployee\(value\); setEmployeeModal\(null\); offerCardReturn\(value\);/);
  assert.match(source, /canSee\(profile, 'cards'\) && isEmployeeLeaving\(employee, today\)/);
});

test('the sandbox only switches to the local emulator when built in sandbox mode', () => {
  assert.match(source, /const SANDBOX = import\.meta\.env\?\.VITE_SANDBOX === '1';/);
  assert.match(source, /firebaseSession\(config, SANDBOX \? \{ emulator: SANDBOX_EMULATOR \} : undefined\)/);
});

test('used cards show no delete button and reader errors never stop later scans', () => {
  assert.match(source, /status !== 'assigned' && !\(item\.events > 0\) &&/);
  assert.match(source, /\.catch\(cause => log\('error', cause\?\.message \|\| 'Kart okutması işlenemedi\.'\)\)/);
  assert.match(source, /const beepError = async \(\) => \{ try \{ await reader\.current\?\.beepError\(\); \} catch/);
});

test('the app never uses native browser dialogs; confirmations use the app modal', () => {
  assert.doesNotMatch(source, /window\.(confirm|prompt|alert)\(/);
  assert.doesNotMatch(source, /[^.\w](confirm|alert)\(/);
  assert.match(source, /function ConfirmHost\(\)/);
  assert.match(source, /<ConfirmHost \/>/);
});

test('cards are edited in an app modal and only unused, unassigned cards may change UID', () => {
  assert.match(source, /function CardEditModal\(/);
  assert.match(source, /const uidLocked = item\.events > 0 \|\| assigned;/);
});

test('card clock-in has its own permission, screen and never writes payroll fields from the screen', () => {
  assert.match(dataSource, /'cards', 'terminal', 'reports'/);
  assert.match(dataSource, /terminal: 'Kart Okutma'/);
  assert.match(source, /tab === 'terminal' && canSee\(profile, 'terminal'\) && <TerminalPage/);
  assert.match(source, /storeRef\.current\.clockCard\(cardUid\)/);
  // Okutma sırası tek kuyrukta işlenir ve bir hata sonraki okutmaları durdurmaz.
  assert.match(source, /queue\.current = queue\.current\.then\(async \(\) => \{[\s\S]*?\}\)\.catch\(\(\) => \{\}\);/);
  assert.match(dataSource, /transaction\.set\(entryReference, \{[^}]*rate: null, cardUid(, \.\.\.offline)? \}\)/);
  assert.match(dataSource, /transaction\.update\(entryReference, \{ end: decision\.end, cardUid \}\)/);
});

test('an open clock-in is shown in the timesheet and closed when the day is completed by hand', () => {
  assert.match(source, /clockInNote\(clockIn, today\)/);
  assert.match(source, /shownEntry\?\.cardUid \? \{ cardUid: shownEntry\.cardUid \} : \{\}/);
  assert.match(source, /await store\.saveEntry\(value\); setEntryModal/);
  assert.match(dataSource, /batch\.set\(doc\(db, 'entries', value\.id\), manualEntryRecord\(value, serverTimestamp\(\)\)\);[\s\S]{0,120}batch\.delete\(doc\(db, 'clockIns', value\.id\)\)/);
});

test('terminal USB auto reconnect handles disconnect before a rapid replug event is consumed', () => {
  assert.match(source, /navigator\.serial\.addEventListener\?\.\('disconnect', onDisconnect\)/);
  assert.match(source, /createReaderReconnectCoordinator/);
  assert.match(source, /const port = event\.port \|\| event\.target; if \(alive && isReaderPort\(port\)\) coordinator\.portConnected\(port\)/);
  assert.match(source, /coordinator\.portDisconnected\(event\.port \|\| event\.target\)/);
});

test('firmware swallows legacy O\/E only after a display message was actually received', () => {
  assert.match(firmwareSource, /bool messageReceived = false;/);
  assert.match(firmwareSource, /messageReceived = true;[\s\S]{0,120}lastMsgAt = millis\(\);/);
  assert.match(firmwareSource, /messageReceived && \(c == 'O' \|\| c == 'E'\)/);
});
