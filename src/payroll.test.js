import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateDay, calculateMonth, DEFAULT_SETTINGS, employeeSalaryForMonth, resolveSettings, validateRules } from './payroll.js';

const employee = { id: '1', name: 'Test', salary: 30000, bank: 28000, startDate: '2026-10-01' };

test('one hour lunch and work after the evening grace window', () => {
  assert.deepEqual(calculateDay({ status: 'present', start: '09:00', end: '19:00' }), {
    status: 'present', workedMinutes: 540, normalMinutes: 480, overtimeMinutes: 30, missingMinutes: 0
  });
});

test('shortfall uses extra entitlement then overtime and never reduces bank', () => {
  const entries = [
    { employeeId: '1', date: '2026-10-01', status: 'absent' },
    { employeeId: '1', date: '2026-10-02', status: 'absent' },
    { employeeId: '1', date: '2026-10-03', status: 'absent' },
    { employeeId: '1', date: '2026-10-05', status: 'present', start: '09:00', end: '23:00', rate: 130 }
  ];
  const result = calculateMonth(employee, entries, '2026-10', '2026-10-05');
  assert.equal(result.missingMinutes, 3 * 480);
  assert.equal(result.missingValue, 3000);
  assert.equal(result.baseExtra, 2000);
  assert.equal(result.overtimeGross, 585);
  assert.equal(result.extraDeduction, 2000);
  assert.equal(result.overtimeDeduction, 585);
  assert.equal(result.unpaidDeduction, 415);
  assert.equal(result.totalNet, 28000);
});

test('unentered days are visible but not automatically treated as absence', () => {
  const result = calculateMonth(employee, [], '2026-10', '2026-10-03');
  assert.equal(result.unenteredDays, 3);
  assert.equal(result.missingMinutes, 0);
});

test('a full-month report includes backfilled and pre-entered days', () => {
  const entries = [
    { employeeId: '1', date: '2026-10-01', status: 'present', start: '09:00', end: '18:00' },
    { employeeId: '1', date: '2026-10-30', status: 'present', start: '09:00', end: '18:20', rate: 130 }
  ];
  const report = calculateMonth(employee, entries, '2026-10', '2026-10-31');
  assert.equal(report.workedMinutes, 980);
  assert.equal(report.overtimeGross, 0);
  assert.deepEqual(report.days.filter(day => day.entry).map(day => day.date), ['2026-10-01', '2026-10-30']);
});

test('shortfall partially reduces overtime after extra entitlement reaches zero', () => {
  const entries = [
    { employeeId: '1', date: '2026-10-01', status: 'absent' },
    { employeeId: '1', date: '2026-10-02', status: 'absent' },
    { employeeId: '1', date: '2026-10-03', status: 'present', start: '09:00', end: '17:00', rate: 130 },
    { employeeId: '1', date: '2026-10-05', status: 'present', start: '09:00', end: '23:00', rate: 130 }
  ];
  const result = calculateMonth(employee, entries, '2026-10', '2026-10-05');
  assert.equal(result.missingValue, 2125);
  assert.equal(result.extraNet, 0);
  assert.equal(result.overtimeNet, 460);
});

test('salary history keeps earlier months on their applicable amount', () => {
  const revised = { ...employee, salary: 36000, bank: 30000, salaryHistory: [
    { effectiveMonth: '2026-10', salary: 30000, bank: 28000 },
    { effectiveMonth: '2026-11', salary: 36000, bank: 30000 }
  ] };
  assert.equal(calculateMonth(revised, [], '2026-10', '2026-10-31').baseExtra, 2000);
  assert.equal(calculateMonth(revised, [], '2026-11', '2026-11-30').baseExtra, 6000);
});

test('employee list salary follows the salary history month after rollover', () => {
  const revised = { ...employee, salary: 30000, bank: 28000, salaryHistory: [
    { effectiveMonth: '2026-10', salary: 30000, bank: 28000 },
    { effectiveMonth: '2026-11', salary: 36000, bank: 30000 }
  ] };
  assert.deepEqual(employeeSalaryForMonth(revised, '2026-10'), { salary: 30000, bank: 28000 });
  assert.deepEqual(employeeSalaryForMonth(revised, '2026-11'), { salary: 36000, bank: 30000 });
});

test('mid-month hire earns ten thirtieths and fills the bank amount first', () => {
  const hired = { ...employee, salary: 48000, bank: 28000, startDate: '2026-10-21' };
  const report = calculateMonth(hired, [], '2026-10', '2026-10-31');
  assert.equal(report.payableDays, 10);
  assert.equal(report.earnedSalary, 16000);
  assert.equal(report.bank, 16000);
  assert.equal(report.baseExtra, 0);
  assert.equal(report.totalNet, 16000);
});

test('partial-month entitlement above bank amount becomes extra pay', () => {
  const hired = { ...employee, salary: 48000, bank: 28000, startDate: '2026-10-11' };
  const report = calculateMonth(hired, [], '2026-10', '2026-10-31');
  assert.equal(report.payableDays, 20);
  assert.equal(report.earnedSalary, 32000);
  assert.equal(report.bank, 28000);
  assert.equal(report.baseExtra, 4000);
  assert.equal(report.totalNet, 32000);
});

test('a full month and the last day of a 31-day month respect the 30-day basis', () => {
  const full = calculateMonth({ ...employee, salary: 48000, bank: 28000 }, [], '2026-10', '2026-10-31');
  const lastDay = calculateMonth({ ...employee, salary: 48000, bank: 28000, startDate: '2026-10-31' }, [], '2026-10', '2026-10-31');
  assert.equal(full.payableDays, 30);
  assert.equal(full.earnedSalary, 48000);
  assert.equal(full.baseExtra, 20000);
  assert.equal(lastDay.payableDays, 1);
  assert.equal(lastDay.earnedSalary, 1600);
});

test('mid-month exit uses payable days and assigns earned pay to bank before extra', () => {
  const agreed = { ...employee, salary: 48000, bank: 28000 };
  const tenDays = calculateMonth({ ...agreed, endDate: '2026-10-10' }, [], '2026-10', '2026-10-31');
  const twentyDays = calculateMonth({ ...agreed, endDate: '2026-10-20' }, [], '2026-10', '2026-10-31');
  assert.deepEqual([tenDays.payableDays, tenDays.earnedSalary, tenDays.bank, tenDays.baseExtra], [10, 16000, 16000, 0]);
  assert.deepEqual([twentyDays.payableDays, twentyDays.earnedSalary, twentyDays.bank, twentyDays.baseExtra], [20, 32000, 28000, 4000]);
});

test('scheduled-day overtime starts only outside the thirty-minute morning and evening grace windows', () => {
  for (const [start, end, expected] of [
    ['08:30', '18:30', 0], ['08:29', '18:30', 15], ['07:00', '18:30', 90],
    ['09:00', '18:30', 0], ['09:00', '18:31', 15], ['09:00', '18:45', 15], ['09:00', '18:46', 30]
  ]) {
    const day = calculateDay({ status: 'present', start, end });
    assert.equal(day.overtimeMinutes, expected, `${start}–${end}`);
  }
});

test('short shifts entirely outside normal hours do not lose overtime to the lunch break', () => {
  assert.deepEqual(calculateDay({ status: 'present', start: '07:00', end: '08:30' }), {
    status: 'present', workedMinutes: 90, normalMinutes: 0, overtimeMinutes: 90, missingMinutes: 480,
  });
  assert.equal(calculateDay({ status: 'present', start: '07:00', end: '08:00' }).overtimeMinutes, 60);
  assert.equal(calculateDay({ status: 'present', start: '18:00', end: '19:00' }).overtimeMinutes, 30);
});

test('short shifts touching normal-hour boundaries do not lose time to the centered lunch break', () => {
  const morning = calculateDay({ status: 'present', start: '08:30', end: '09:30' });
  assert.deepEqual([morning.workedMinutes, morning.normalMinutes, morning.overtimeMinutes], [60, 60, 0]);
  const early = calculateDay({ status: 'present', start: '07:00', end: '09:01' });
  assert.deepEqual([early.workedMinutes, early.normalMinutes, early.overtimeMinutes], [121, 31, 90]);
  const evening = calculateDay({ status: 'present', start: '17:59', end: '19:00' });
  assert.deepEqual([evening.workedMinutes, evening.normalMinutes, evening.overtimeMinutes], [61, 31, 30]);
});

test('17:59 through 18:30 neither creates overtime nor a one-minute deduction', () => {
  for (const end of ['17:59', '18:00', '18:03', '18:30']) {
    const day = calculateDay({ status: 'present', start: '09:00', end });
    assert.equal(day.overtimeMinutes, 0, end);
    assert.equal(day.missingMinutes, 0, end);
  }
});

test('admin rule change starts in selected month and preserves earlier month', () => {
  const config = { ...DEFAULT_SETTINGS, history: [{ effectiveMonth: '2026-11', rules: { ...DEFAULT_SETTINGS, startTime: '10:00', endTime: '19:00', overtimeRate: 200 } }] };
  assert.equal(resolveSettings(config, '2026-10').endTime, '18:00');
  assert.equal(resolveSettings(config, '2026-11').endTime, '19:00');
  const october = calculateMonth(employee, [{ employeeId: '1', date: '2026-10-01', status: 'present', start: '09:00', end: '18:50', rate: 130 }], '2026-10', '2026-10-01', config);
  assert.equal(october.overtimeGross, 65);
  const november = calculateMonth(employee, [{ employeeId: '1', date: '2026-11-02', status: 'present', start: '10:00', end: '19:50', rate: 200 }], '2026-11', '2026-11-02', config);
  assert.equal(november.overtimeGross, 100);
});

test('rule changes apply from the selected day within the same month', () => {
  const config = { ...DEFAULT_SETTINGS, history: [{ effectiveDate: '2026-10-15', rules: { ...DEFAULT_SETTINGS, overtimeRate: 200, overtimeRoundMinutes: 30 } }] };
  assert.equal(resolveSettings(config, '2026-10-14').overtimeRate, 130);
  assert.equal(resolveSettings(config, '2026-10-15').overtimeRate, 200);
  const entries = [
    { employeeId: '1', date: '2026-10-14', status: 'present', start: '09:00', end: '18:50', rate: 130 },
    { employeeId: '1', date: '2026-10-15', status: 'present', start: '09:00', end: '18:50', rate: 200 }
  ];
  const report = calculateMonth(employee, entries, '2026-10', '2026-10-15', config);
  assert.equal(report.overtimeMinutes, 60);
  assert.equal(report.overtimeGross, 165);
});

test('exit date is the final payable working day', () => {
  const former = { ...employee, endDate: '2026-10-02' };
  const entries = [
    { employeeId: '1', date: '2026-10-02', status: 'absent' },
    { employeeId: '1', date: '2026-10-03', status: 'absent' }
  ];
  const report = calculateMonth(former, entries, '2026-10', '2026-10-05');
  assert.equal(report.expectedDays, 2);
  assert.equal(report.missingMinutes, 480);
  assert.equal(report.days.at(-1).date, '2026-10-02');
});

test('admin may change deduction order and allow bank deduction', () => {
  const entries = [
    { employeeId: '1', date: '2026-10-01', status: 'absent' },
    { employeeId: '1', date: '2026-10-02', status: 'absent' },
    { employeeId: '1', date: '2026-10-03', status: 'absent' },
    { employeeId: '1', date: '2026-10-05', status: 'present', start: '09:00', end: '23:00', rate: 130 }
  ];
  const result = calculateMonth(employee, entries, '2026-10', '2026-10-05', { ...DEFAULT_SETTINGS, deductionOrder: 'overtime-first', allowBankDeduction: true });
  assert.equal(result.overtimeDeduction, 585);
  assert.equal(result.extraDeduction, 2000);
  assert.equal(result.bankDeduction, 415);
  assert.equal(result.bankNet, 27585);
  assert.equal(result.totalNet, 27585);
});

test('unpaid deduction carries only when that month enables carry-forward', () => {
  const entries = [
    { employeeId: '1', date: '2026-10-01', status: 'absent' },
    { employeeId: '1', date: '2026-10-02', status: 'absent' },
    { employeeId: '1', date: '2026-10-03', status: 'absent' }
  ];
  const withCarry = { ...DEFAULT_SETTINGS, carryForward: true };
  const october = calculateMonth(employee, entries, '2026-10', '2026-10-31', withCarry);
  const november = calculateMonth(employee, entries, '2026-11', '2026-11-30', withCarry);
  assert.equal(october.carryOut, 1000);
  assert.equal(november.carryIn, 1000);
  assert.equal(november.extraDeduction, 1000);
  assert.equal(november.totalNet, 29000);
  assert.equal(calculateMonth(employee, entries, '2026-11', '2026-11-30').carryIn, 0);
});

test('custom work schedule, lunch and target drive normal and overtime minutes', () => {
  const rules = { ...DEFAULT_SETTINGS, workdays: [1, 2, 3, 4, 5], startTime: '10:00', endTime: '19:00', breakMinutes: 30, dailyTargetMinutes: 510 };
  assert.doesNotThrow(() => validateRules(rules));
  const day = calculateDay({ status: 'present', start: '10:00', end: '19:50' }, true, rules);
  assert.equal(day.workedMinutes, 560);
  assert.equal(day.normalMinutes, 510);
  assert.equal(day.overtimeMinutes, 30);
  assert.equal(day.missingMinutes, 0);
  const sunday = calculateMonth(employee, [{ employeeId: '1', date: '2026-10-04', status: 'absent' }], '2026-10', '2026-10-04', rules);
  assert.equal(sunday.expectedDays, 2);
  assert.equal(sunday.missingMinutes, 0);
});

test('salary before the first history record uses the earliest record, not the current salary', () => {
  const person = { id: 's', name: 'Maaş', startDate: '2026-01-01', salary: 35000, bank: 0,
    salaryHistory: [{ effectiveMonth: '2026-01', salary: 30000, bank: 0 }, { effectiveMonth: '2026-11', salary: 35000, bank: 0 }] };
  assert.equal(calculateMonth(person, [], '2026-10', '2026-10-31').salary, 30000);
  assert.equal(calculateMonth(person, [], '2026-11', '2026-11-30').salary, 35000);
  const createdLater = { ...person, salaryHistory: [{ effectiveMonth: '2026-11', salary: 35000, bank: 0 }], salary: 40000 };
  assert.equal(calculateMonth(createdLater, [], '2026-10', '2026-10-31').salary, 35000);
});

test('work on a non-workday counts entirely as overtime at the rate entered for that day', () => {
  const person = { id: 'p', name: 'Pazar', startDate: '2026-01-01', salary: 30000, bank: 0 };
  const sunday = { employeeId: 'p', date: '2026-02-01', status: 'present', start: '09:00', end: '18:00', rate: 200 };
  const day = calculateDay(sunday, false);
  assert.deepEqual(day, { status: 'present', workedMinutes: 540, normalMinutes: 0, overtimeMinutes: 540, missingMinutes: 0 });
  const result = calculateMonth(person, [sunday], '2026-02', '2026-02-01');
  assert.equal(result.overtimeMinutes, 540);
  assert.equal(result.overtimeGross, 1800);
  assert.equal(result.missingMinutes, 0);
  assert.equal(result.expectedDays, 0);
  assert.equal(result.pendingRateDays, 0);
});

test('a short non-workday shift keeps every entered minute as overtime', () => {
  const day = calculateDay({ status: 'present', start: '09:00', end: '09:30' }, false);
  assert.deepEqual(day, { status: 'present', workedMinutes: 30, normalMinutes: 0, overtimeMinutes: 30, missingMinutes: 0 });
});

test('normal-workday overtime without a stored rate stays pending instead of following mutable tariffs', () => {
  const person = { id: 'p', name: 'Tarife', startDate: '2026-01-01', salary: 30000, bank: 0, overtimeRate: 100 };
  const entry = { employeeId: 'p', date: '2026-02-02', status: 'present', start: '09:00', end: '19:00', rate: null };
  const first = calculateMonth(person, [entry], '2026-02', '2026-02-02');
  const changed = calculateMonth({ ...person, overtimeRate: 200 }, [entry], '2026-02', '2026-02-02', { ...DEFAULT_SETTINGS, overtimeRate: 300 });
  assert.equal(first.overtimeMinutes, 30);
  assert.equal(first.overtimeGross, 0);
  assert.equal(first.pendingRateDays, 1);
  assert.equal(first.days[0].ratePending, true);
  assert.equal(changed.overtimeGross, 0);
  assert.equal(changed.pendingRateDays, 1);
});

test('non-workday work without a rate is reported as pending and pays nothing yet', () => {
  const person = { id: 'p', name: 'Pazar', startDate: '2026-01-01', salary: 30000, bank: 0, overtimeRate: 150 };
  const result = calculateMonth(person, [{ employeeId: 'p', date: '2026-02-01', status: 'present', start: '09:00', end: '13:00', rate: null }], '2026-02', '2026-02-01');
  assert.equal(result.overtimeMinutes, 240);
  assert.equal(result.overtimeGross, 0);
  assert.equal(result.pendingRateDays, 1);
  assert.equal(result.days[0].ratePending, true);
});

test('settings validation rejects non-finite and unreasonably large overtime rates', () => {
  assert.throws(() => validateRules({ ...DEFAULT_SETTINGS, overtimeRate: Infinity }));
  assert.throws(() => validateRules({ ...DEFAULT_SETTINGS, overtimeRate: 1000001 }));
  assert.doesNotThrow(() => validateRules({ ...DEFAULT_SETTINGS, overtimeRate: 1000000 }));
});
