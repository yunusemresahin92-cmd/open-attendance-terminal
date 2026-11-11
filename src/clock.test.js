import test from 'node:test';
import assert from 'node:assert/strict';
import { REPEAT_MINUTES, turkeyNow, decideClock, readerText, encodeReaderMessage, decodeReaderMessage, readerMessageFor } from './clock.js';

const now = time => ({ date: '2026-11-10', time });

test('Türkiye saati bilgisayarın saat diliminden bağımsız hesaplanır', () => {
  assert.deepEqual(turkeyNow(new Date('2026-11-10T05:52:30Z')), { date: '2026-11-10', time: '08:52' });
  assert.deepEqual(turkeyNow(new Date('2026-11-10T21:05:00Z')), { date: '2026-11-11', time: '00:05' });
});

test('ilk okutma giriş, 15 dakika sonraki okutma çıkıştır', () => {
  assert.equal(REPEAT_MINUTES, 15);
  assert.deepEqual(decideClock({ now: now('08:52') }), { action: 'in', start: '08:52' });
  assert.deepEqual(decideClock({ clockIn: { start: '08:52' }, now: now('18:05') }), { action: 'out', start: '08:52', end: '18:05' });
});

test('15 dakika içindeki ikinci okutma kaydedilmez', () => {
  assert.equal(decideClock({ clockIn: { start: '08:52' }, now: now('08:52') }).action, 'repeat');
  assert.equal(decideClock({ clockIn: { start: '08:52' }, now: now('09:06') }).action, 'repeat');
  assert.equal(decideClock({ clockIn: { start: '08:52' }, now: now('09:07') }).action, 'out');
  const entry = { status: 'present', start: '08:52', end: '18:05' };
  assert.deepEqual(decideClock({ entry, now: now('18:10') }), { action: 'repeat', last: 'out', start: '08:52', end: '18:05' });
});

test('15 dakika sınırı tam olarak çıkışa izin verir', () => {
  assert.equal(decideClock({ clockIn: { start: '08:52' }, now: now('09:06') }).action, 'repeat');
  assert.equal(decideClock({ clockIn: { start: '08:52' }, now: now('09:07') }).action, 'out');
});

test('Türkiye günü gece yarısında değişir; üç dakikalık iki tarafın tarihi korunur', () => {
  assert.deepEqual(turkeyNow(new Date('2026-11-10T20:58:00Z')), { date: '2026-11-10', time: '23:58' });
  assert.deepEqual(turkeyNow(new Date('2026-11-10T21:01:00Z')), { date: '2026-11-11', time: '00:01' });
  assert.deepEqual(turkeyNow(new Date('2026-11-10T21:04:00Z')), { date: '2026-11-11', time: '00:04' });
});

test('çıkıştan sonra tekrar okutulursa çıkış saati ileri alınır (ilk giriş – son çıkış)', () => {
  const entry = { status: 'present', start: '08:52', end: '18:05' };
  assert.deepEqual(decideClock({ entry, now: now('19:30') }), { action: 'extend', start: '08:52', end: '19:30' });
});

test('izinli, devamsız veya elle girilmiş gün terminalden değiştirilmez', () => {
  assert.deepEqual(decideClock({ entry: { status: 'leave' }, now: now('09:00') }), { action: 'blocked', reason: 'leave' });
  assert.deepEqual(decideClock({ entry: { status: 'absent' }, now: now('09:00') }), { action: 'blocked', reason: 'absent' });
  assert.equal(decideClock({ entry: { status: 'present', start: '09:00', end: '18:00' }, now: now('08:55') }).reason, 'manual');
});

test('okuyucu metni Türkçe büyük harfe çevrilir, desteklenmeyen karakterler atılır', () => {
  assert.equal(readerText('Ayşe ılgın çiğdem öz'), 'AYŞE ILGIN ÇİĞDEM ÖZ');
  assert.equal(readerText('İsmail  <b>Şahin</b>\n'), 'İSMAİL BŞAHİN/B');
  assert.equal(readerText('Hâlâ Kâmil'), 'HALA KAMİL');
  assert.equal(readerText('x'.repeat(80)).length, 40);
});

test('okuyucu mesajı eski cihazın dinlediği O/E harflerini içermez ve geri çözülür', () => {
  const message = encodeReaderMessage('in', ['GİRİŞ', 'Ömer Ertuğrul Öztürk', '08:52  İYİ ÇALIŞMALAR']);
  assert.match(message, /^\{[0-9a-f]+\}\n$/);
  assert.equal(/[OE]/.test(message), false);
  assert.deepEqual(decodeReaderMessage(message), { kind: 'in', lines: ['GİRİŞ', 'ÖMER ERTUĞRUL ÖZTÜRK', '08:52 İYİ ÇALIŞMALAR'] });
  assert.throws(() => encodeReaderMessage('beep', []));
});

test('okutma sonucu ekran satırlarına çevrilir', () => {
  assert.deepEqual(readerMessageFor({ action: 'in', name: 'Ahmet Yılmaz', start: '08:52' }), { kind: 'in', lines: ['GİRİŞ', 'Ahmet Yılmaz', '08:52  İYİ ÇALIŞMALAR'] });
  assert.equal(readerMessageFor({ action: 'extend', name: 'A', end: '19:30' }).kind, 'out');
  assert.equal(readerMessageFor({ action: 'repeat', name: 'A', last: 'in', start: '08:52' }).lines[2], 'GİRİŞ 08:52');
  assert.equal(readerMessageFor({ action: 'blocked', name: 'A', reason: 'leave' }).lines[2], 'BUGÜN İZİNLİ');
  assert.deepEqual(readerMessageFor({ action: 'error', title: 'TANIMSIZ KART', detail: 'KART 007' }), { kind: 'err', lines: ['TANIMSIZ KART', 'KART 007'] });
});
