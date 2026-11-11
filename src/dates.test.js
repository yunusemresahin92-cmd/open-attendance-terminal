import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDateTr, formatMonthTr } from './dates.js';

test('system dates use zero-padded Turkish day-month-year format', () => {
  assert.equal(formatDateTr('2026-11-06'), '06.11.2026');
  assert.equal(formatDateTr('2026-01-02'), '02.01.2026');
});

test('monthly report periods use month-year without inventing a day', () => {
  assert.equal(formatMonthTr('2026-11'), '11.2026');
});

test('empty and malformed persisted dates are not displayed as fake dates', () => {
  assert.equal(formatDateTr(''), '');
  assert.equal(formatDateTr('2026-13-40'), '');
  assert.equal(formatMonthTr('not-a-month'), '');
});
