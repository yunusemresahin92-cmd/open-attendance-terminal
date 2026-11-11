export const DEFAULT_SETTINGS = {
  workdays: [1, 2, 3, 4, 5, 6],
  startTime: '09:00', endTime: '18:00', breakMinutes: 60,
  dailyTargetMinutes: 480, salaryDays: 30, overtimeRate: 130, overtimeRoundMinutes: 15,
  deductionOrder: 'extra-first', allowBankDeduction: false, carryForward: false
};

export const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
export const asNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;
export const minutes = time => {
  if (!/^\d{2}:\d{2}$/.test(time || '')) return null;
  const [hour, minute] = time.split(':').map(Number);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
};
export const dateKey = (year, month, day) => String(year) + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
export const todayKey = () => {
  const now = new Date();
  return dateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
};
export const monthDays = month => {
  const [year, number] = month.split('-').map(Number);
  return Array.from({ length: new Date(year, number, 0).getDate() }, (_, index) => {
    const day = index + 1;
    const date = dateKey(year, number, day);
    return { date, day, weekday: new Date(year, number - 1, day).getDay() };
  });
};

export function validateRules(value) {
  if (!Array.isArray(value.workdays) || !value.workdays.length || value.workdays.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error('En az bir çalışma günü seçin.');
  const start = minutes(value.startTime), end = minutes(value.endTime);
  if (start === null || end === null || end <= start) throw new Error('Normal çıkış saati giriş saatinden sonra olmalı.');
  if (!Number.isInteger(Number(value.breakMinutes)) || Number(value.breakMinutes) < 0 || Number(value.breakMinutes) >= end - start) throw new Error('Yemek molası çalışma aralığından kısa olmalı.');
  if (!Number.isInteger(Number(value.dailyTargetMinutes)) || Number(value.dailyTargetMinutes) <= 0 || Number(value.dailyTargetMinutes) > end - start - Number(value.breakMinutes)) throw new Error('Günlük hedef, moladan sonraki normal çalışma süresini aşamaz.');
  if (!Number.isInteger(Number(value.salaryDays)) || Number(value.salaryDays) <= 0 || Number(value.salaryDays) > 31) throw new Error('Maaş günü sayısı 1–31 arasında olmalı.');
  if (!Number.isFinite(Number(value.overtimeRate)) || Number(value.overtimeRate) < 0 || Number(value.overtimeRate) > 1000000) throw new Error('Mesai ücreti 0–1.000.000 TL arasında olmalı.');
  if (![15, 30, 60].includes(Number(value.overtimeRoundMinutes))) throw new Error('Mesai yuvarlama 15, 30 veya 60 dakika olmalı.');
  if (!['extra-first', 'overtime-first'].includes(value.deductionOrder)) throw new Error('Geçersiz kesinti sırası.');
}

export function resolveSettings(config = {}, date = todayKey()) {
  const revisions = Array.isArray(config.history) ? config.history : [];
  const targetDate = date.length === 7 ? `${date}-31` : date;
  const effectiveDate = item => item?.effectiveDate || (item?.effectiveMonth ? `${item.effectiveMonth}-01` : '9999-12-31');
  const active = revisions.filter(item => effectiveDate(item) <= targetDate).sort((a, b) => effectiveDate(b).localeCompare(effectiveDate(a)))[0];
  const { history, ...base } = config;
  return { ...DEFAULT_SETTINGS, ...base, ...(active?.rules || {}) };
}

export function employeeSalaryForMonth(employee, month) {
  const salaryHistory = [...(employee.salaryHistory || [])].filter(item => item?.effectiveMonth).sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth));
  const applicable = salaryHistory.filter(item => item.effectiveMonth <= month).at(-1) ?? salaryHistory[0];
  return {
    salary: asNumber(applicable?.salary ?? employee.salary),
    bank: asNumber(applicable?.bank ?? employee.bank)
  };
}

export function calculateDay(entry, scheduled = true, settings = DEFAULT_SETTINGS) {
  const target = asNumber(settings.dailyTargetMinutes) || DEFAULT_SETTINGS.dailyTargetMinutes;
  if (!entry) return { status: 'unentered', workedMinutes: 0, normalMinutes: 0, overtimeMinutes: 0, missingMinutes: 0 };
  if (!scheduled) {
    // Çalışma günü olmayan gün (ör. Pazar): yalnızca çalışma girilir ve çalışılan sürenin tamamı mesai sayılır.
    if (entry.status !== 'present') return { status: entry.status, workedMinutes: 0, normalMinutes: 0, overtimeMinutes: 0, missingMinutes: 0 };
    const offStart = minutes(entry.start);
    const offEnd = minutes(entry.end);
    if (offStart === null || offEnd === null || offEnd <= offStart) throw new Error('Çıkış saati giriş saatinden sonra olmalı.');
    const offWorked = offEnd - offStart;
    const offRound = asNumber(settings.overtimeRoundMinutes) || DEFAULT_SETTINGS.overtimeRoundMinutes;
    return { status: 'present', workedMinutes: offWorked, normalMinutes: 0, overtimeMinutes: Math.ceil(offWorked / offRound) * offRound, missingMinutes: 0 };
  }
  if (entry.status === 'leave') return { status: 'leave', workedMinutes: 0, normalMinutes: target, overtimeMinutes: 0, missingMinutes: 0 };
  if (entry.status === 'absent') return { status: 'absent', workedMinutes: 0, normalMinutes: 0, overtimeMinutes: 0, missingMinutes: scheduled ? target : 0 };
  const start = minutes(entry.start);
  const end = minutes(entry.end);
  if (start === null || end === null || end <= start) throw new Error('Çıkış saati giriş saatinden sonra olmalı.');
  const normalStart = minutes(settings.startTime) ?? minutes(DEFAULT_SETTINGS.startTime);
  const normalEnd = minutes(settings.endTime) ?? minutes(DEFAULT_SETTINGS.endTime);
  // Kart basma toleransı: 17:59 normal çıkış kabul edilir; sabah/akşam ilk 30 dakika mesai değildir.
  const effectiveEnd = end === normalEnd - 1 ? normalEnd : end;
  const configuredBreak = asNumber(settings.breakMinutes ?? DEFAULT_SETTINGS.breakMinutes);
  const breakStart = normalStart + Math.floor((normalEnd - normalStart - configuredBreak) / 2);
  const breakEnd = breakStart + configuredBreak;
  const breakMinutes = Math.max(0, Math.min(effectiveEnd, breakEnd) - Math.max(start, breakStart));
  const workedMinutes = Math.max(0, effectiveEnd - start - breakMinutes);
  const overtimeGraceMinutes = 30;
  const earlyOvertime = Math.max(0, normalStart - overtimeGraceMinutes - start);
  const lateOvertime = Math.max(0, end - normalEnd - overtimeGraceMinutes);
  const rawOvertime = Math.min(workedMinutes, earlyOvertime + lateOvertime);
  const roundMinutes = asNumber(settings.overtimeRoundMinutes) || DEFAULT_SETTINGS.overtimeRoundMinutes;
  const overtimeMinutes = Math.ceil(rawOvertime / roundMinutes) * roundMinutes;
  const normalMinutes = Math.min(target, Math.max(0, workedMinutes - rawOvertime));
  return {
    status: 'present', workedMinutes, normalMinutes, overtimeMinutes,
    missingMinutes: scheduled ? Math.max(0, target - normalMinutes) : 0
  };
}

function calculatePeriod(employee, byDate, month, cutoff, settingsConfig, carryIn) {
  const periodEnd = monthDays(month).at(-1).date;
  const settlementDate = cutoff < periodEnd ? cutoff : periodEnd;
  const settings = resolveSettings(settingsConfig, settlementDate);
  // Maaş geçmişi: ayın geçerli kaydı; ilk kayıttan önceki aylar için en eski kayıt (güncel maaş değil) kullanılır.
  const { salary, bank: agreedBank } = employeeSalaryForMonth(employee, month);
  const salaryDays = asNumber(settings.salaryDays) || DEFAULT_SETTINGS.salaryDays;
  const startDay = employee.startDate?.startsWith(`${month}-`) ? Math.min(Number(employee.startDate.slice(-2)), salaryDays) : 1;
  const endDay = employee.endDate?.startsWith(`${month}-`)
    ? employee.endDate === periodEnd ? salaryDays : Math.min(Number(employee.endDate.slice(-2)), salaryDays)
    : salaryDays;
  const payableDays = employee.startDate > periodEnd || (employee.endDate && employee.endDate < `${month}-01`)
    ? 0 : Math.max(0, endDay - startDay + 1);
  const earnedSalary = money(salary * payableDays / salaryDays);
  const bank = money(Math.min(agreedBank, earnedSalary));
  const baseExtra = money(Math.max(0, earnedSalary - bank));
  const hourlySalary = salary / salaryDays / (asNumber(settings.dailyTargetMinutes) / 60);
  let workedMinutes = 0, normalMinutes = 0, overtimeMinutes = 0, missingMinutes = 0;
  let overtimeGross = 0, missingValue = 0, unenteredDays = 0, expectedDays = 0, pendingRateDays = 0;
  const days = [];
  for (const day of monthDays(month)) {
    const daySettings = resolveSettings(settingsConfig, day.date);
    if (day.date < (employee.startDate || '0000-00-00') || (employee.endDate && day.date > employee.endDate) || day.date > cutoff) continue;
    const entry = byDate.get(day.date);
    if (!daySettings.workdays.includes(day.weekday)) {
      if (entry?.status !== 'present') continue;
      const offResult = calculateDay(entry, false, daySettings);
      const ratePending = entry.rate === null || entry.rate === undefined || entry.rate === '' || !Number.isFinite(Number(entry.rate));
      workedMinutes += offResult.workedMinutes;
      overtimeMinutes += offResult.overtimeMinutes;
      if (ratePending) pendingRateDays++;
      else overtimeGross += (offResult.overtimeMinutes / 60) * Number(entry.rate);
      days.push({ date: day.date, entry, ...offResult, offDay: true, ratePending, rate: ratePending ? null : Number(entry.rate) });
      continue;
    }
    expectedDays++;
    const result = calculateDay(entry, true, daySettings);
    if (!entry) unenteredDays++;
    workedMinutes += result.workedMinutes;
    normalMinutes += result.normalMinutes;
    overtimeMinutes += result.overtimeMinutes;
    missingMinutes += result.missingMinutes;
    const ratePending = result.overtimeMinutes > 0
      && (entry?.rate === null || entry?.rate === undefined || entry?.rate === '' || !Number.isFinite(Number(entry?.rate)));
    const rate = ratePending ? null : asNumber(entry?.rate);
    if (ratePending) pendingRateDays++;
    else overtimeGross += (result.overtimeMinutes / 60) * rate;
    missingValue += (result.missingMinutes / 60) * salary / asNumber(daySettings.salaryDays) / (asNumber(daySettings.dailyTargetMinutes) / 60);
    days.push({ date: day.date, entry, ...result, offDay: false, ratePending, rate });
  }
  overtimeGross = money(overtimeGross);
  missingValue = money(missingValue);
  let remaining = money(missingValue + carryIn);
  const deductions = { extra: 0, overtime: 0, bank: 0 };
  const order = settings.deductionOrder === 'overtime-first' ? ['overtime', 'extra'] : ['extra', 'overtime'];
  if (settings.allowBankDeduction) order.push('bank');
  const available = { extra: baseExtra, overtime: overtimeGross, bank };
  for (const key of order) {
    deductions[key] = money(Math.min(remaining, available[key]));
    remaining = money(Math.max(0, remaining - deductions[key]));
  }
  const extraNet = money(baseExtra - deductions.extra);
  const overtimeNet = money(overtimeGross - deductions.overtime);
  const bankNet = money(bank - deductions.bank);
  return {
    employeeId: employee.id, name: employee.name, company: employee.company || '', salary, earnedSalary, payableDays, bank, bankNet, bankDeduction: deductions.bank,
    baseExtra, hourlySalary: money(hourlySalary), workedMinutes, normalMinutes, overtimeMinutes, missingMinutes, expectedDays, unenteredDays, pendingRateDays,
    overtimeGross, missingValue, carryIn, carryOut: settings.carryForward ? remaining : 0,
    extraDeduction: deductions.extra, overtimeDeduction: deductions.overtime, unpaidDeduction: remaining, extraNet, overtimeNet,
    totalNet: money(bankNet + extraNet + overtimeNet), days
  };
}

export function calculateMonth(employee, entries, month, cutoff = todayKey(), settingsConfig = DEFAULT_SETTINGS) {
  const byDate = new Map(entries.filter(entry => entry.employeeId === employee.id).map(entry => [entry.date, entry]));
  const canCarry = settingsConfig.carryForward || (Array.isArray(settingsConfig.history) && settingsConfig.history.some(item => item.rules?.carryForward));
  if (!canCarry) return calculatePeriod(employee, byDate, month, cutoff, settingsConfig, 0);
  const startMonth = employee.startDate?.slice(0, 7) <= month ? employee.startDate.slice(0, 7) : month;
  let [year, number] = (startMonth || month).split('-').map(Number);
  let carryIn = 0;
  while (year * 12 + number <= Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7))) {
    const period = String(year) + '-' + String(number).padStart(2, '0');
    const result = calculatePeriod(employee, byDate, period, period === month ? cutoff : monthDays(period).at(-1).date, settingsConfig, carryIn);
    if (period === month) return result;
    carryIn = result.carryOut;
    number++;
    if (number > 12) { number = 1; year++; }
  }
}

export const hours = value => money(value / 60);
