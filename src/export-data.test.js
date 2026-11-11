import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyAttendanceRows, safeSpreadsheetText } from './export-data.js';
import { DEFAULT_SETTINGS } from './payroll.js';

test('daily attendance export includes active-on-date employees and calculated entry details', () => {
  const employees = [
    { id: '1', name: 'Ali', company: 'Demo Şirket', startDate: '2026-01-01', endDate: '' },
    { id: '2', name: 'Ayşe', company: 'Demo Servis', startDate: '2026-01-01', endDate: '' },
    { id: '3', name: 'Eski', company: 'Demo Şirket', startDate: '2025-01-01', endDate: '2026-10-31' },
  ];
  const entries = [{ id: '1_2026-11-05', employeeId: '1', date: '2026-11-05', status: 'present', start: '07:00', end: '18:03', rate: 130 }];
  const rows = dailyAttendanceRows(employees, entries, '2026-11-05', DEFAULT_SETTINGS);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    employee: 'Ali', company: 'Demo Şirket', date: '2026-11-05', status: 'Çalıştı', start: '07:00', end: '18:03',
    workedMinutes: 603, normalMinutes: 480, overtimeMinutes: 90, missingMinutes: 0,
  });
  assert.equal(rows[1].employee, 'Ayşe');
  assert.equal(rows[1].status, 'Kayıt yok');
  assert.equal(rows[1].start, '');
});

test('daily attendance export preserves absence and leave statuses without invented times', () => {
  const employees = [{ id: '1', name: 'Ali', company: '', startDate: '2026-01-01', endDate: '' }];
  for (const status of ['absent', 'leave']) {
    const [row] = dailyAttendanceRows(employees, [{ id: `1_${status}`, employeeId: '1', date: '2026-11-05', status }], '2026-11-05', DEFAULT_SETTINGS);
    assert.equal(row.status, status === 'absent' ? 'Devamsız' : 'Ücretli izin');
    assert.equal(row.start, '');
    assert.equal(row.end, '');
  }
});

test('daily attendance export rejects an empty or malformed selected date', () => {
  assert.throws(() => dailyAttendanceRows([], [], '', DEFAULT_SETTINGS), /geçerli bir tarih/i);
  assert.throws(() => dailyAttendanceRows([], [], '2026-02-31', DEFAULT_SETTINGS), /geçerli bir tarih/i);
});

test('spreadsheet text neutralizes formulas even after whitespace or control characters', () => {
  for (const value of ['=1+1', '+SUM(A1:A2)', '-2+3', '@cmd', ' =1+1', '\t=1+1', '\r\n@cmd']) {
    assert.equal(safeSpreadsheetText(value).startsWith("'"), true, value);
  }
  assert.equal(safeSpreadsheetText('Demo Şirket'), 'Demo Şirket');
});
