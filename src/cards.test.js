import test from 'node:test';
import assert from 'node:assert/strict';
import { availableCards, cardStatus, cardsNeedingReturn, isEmployeeLeaving, missingInventory, nextCardLabel, normalizeCardLabel, normalizeCardUid, sortCardHistory } from './cards.js';

test('RFID card UIDs are canonical uppercase hexadecimal values of 4, 7 or 10 bytes', () => {
  assert.equal(normalizeCardUid('a1 b2:c3-d4'), 'A1B2C3D4');
  assert.equal(normalizeCardUid('04A1B2C3D4E5F6'), '04A1B2C3D4E5F6');
  assert.throws(() => normalizeCardUid('A1B2C3'), /8, 14 veya 20/);
  assert.throws(() => normalizeCardUid('Z1B2C3D4'), /onaltılık/);
});

test('card labels are trimmed, required and limited to 20 characters', () => {
  assert.equal(normalizeCardLabel('  017 '), '017');
  assert.throws(() => normalizeCardLabel('   '), /Kart numarası/);
  assert.throws(() => normalizeCardLabel('x'.repeat(21)), /20/);
});

test('next card label continues the highest numeric label with three digits', () => {
  assert.equal(nextCardLabel([]), '001');
  assert.equal(nextCardLabel([{ label: '001' }, { label: '017' }, { label: 'Yedek' }]), '018');
  assert.equal(nextCardLabel([{ label: '999' }]), '1000');
});

test('card status is derived from the live mapping and the lost flag', () => {
  const mappings = [{ employeeId: 'e1', cardUid: 'AAAAAAAA' }];
  assert.equal(cardStatus({ cardUid: 'AAAAAAAA', lost: false }, mappings), 'assigned');
  assert.equal(cardStatus({ cardUid: 'BBBBBBBB', lost: false }, mappings), 'available');
  assert.equal(cardStatus({ cardUid: 'CCCCCCCC', lost: true }, mappings), 'lost');
});

test('only unassigned and not-lost cards are offered for assignment, ordered by label', () => {
  const inventory = [
    { cardUid: 'CCCCCCCC', label: '010', lost: false },
    { cardUid: 'AAAAAAAA', label: '001', lost: false },
    { cardUid: 'BBBBBBBB', label: '002', lost: true },
    { cardUid: 'DDDDDDDD', label: '003', lost: false },
  ];
  const mappings = [{ employeeId: 'e1', cardUid: 'DDDDDDDD' }];
  assert.deepEqual(availableCards(inventory, mappings).map(item => item.label), ['001', '010']);
});

test('existing mappings without an inventory record are reported for migration', () => {
  const mappings = [{ employeeId: 'e1', cardUid: 'AAAAAAAA' }, { employeeId: 'e2', cardUid: 'BBBBBBBB' }];
  assert.deepEqual(missingInventory(mappings, [{ cardUid: 'AAAAAAAA' }]), ['BBBBBBBB']);
});

test('employees who are inactive or past their end date are leaving', () => {
  assert.equal(isEmployeeLeaving({ active: false }, '2026-11-06'), true);
  assert.equal(isEmployeeLeaving({ active: true, endDate: '2026-11-06' }, '2026-11-06'), true);
  assert.equal(isEmployeeLeaving({ active: true, endDate: '2026-11-30' }, '2026-11-06'), false);
  assert.equal(isEmployeeLeaving({ active: true, endDate: '' }, '2026-11-06'), false);
});

test('leaving employees who still hold a card are listed for card return', () => {
  const employees = [
    { id: 'e1', name: 'Ali', active: false },
    { id: 'e2', name: 'Veli', active: true, endDate: '' },
    { id: 'e3', name: 'Ayşe', active: true, endDate: '2026-11-01' },
  ];
  const mappings = [{ employeeId: 'e1', cardUid: 'AAAAAAAA' }, { employeeId: 'e2', cardUid: 'BBBBBBBB' }];
  assert.deepEqual(cardsNeedingReturn(employees, mappings, '2026-11-06').map(item => item.employee.id), ['e1']);
});

test('card history is shown newest first using the server timestamp', () => {
  const items = [
    { action: 'assigned', at: { toMillis: () => 1000 } },
    { action: 'returned', at: { toMillis: () => 3000 } },
    { action: 'lost', at: null },
  ];
  assert.deepEqual(sortCardHistory(items).map(item => item.action), ['lost', 'returned', 'assigned']);
});
