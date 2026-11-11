import { calculateDay, resolveSettings } from './payroll.js';
import { formatDateTr } from './dates.js';

const STATUS_LABELS = { present: 'Çalıştı', absent: 'Devamsız', leave: 'Ücretli izin' };

export const safeSpreadsheetText = value => /^[\t\r\n ]*[=+\-@]/.test(String(value)) ? `'${value}` : String(value);

export function dailyAttendanceRows(employees, entries, date, settings) {
  if (!formatDateTr(date)) throw new Error('Günlük rapor için geçerli bir tarih seçin.');
  const rules = resolveSettings(settings, date);
  const weekday = new Date(`${date}T12:00:00`).getDay();
  const scheduledDay = rules.workdays.includes(weekday);
  const entriesByEmployee = new Map(entries.filter(item => item.date === date).map(item => [item.employeeId, item]));
  return employees
    .filter(item => item.startDate <= date && (!item.endDate || item.endDate >= date))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
    .map(employee => {
      const entry = entriesByEmployee.get(employee.id);
      let calculated = { workedMinutes: 0, normalMinutes: 0, overtimeMinutes: 0, missingMinutes: 0 };
      if (entry) calculated = calculateDay(entry, scheduledDay, rules);
      return {
        employee: employee.name,
        company: employee.company || '',
        date,
        status: entry ? STATUS_LABELS[entry.status] || entry.status : scheduledDay ? 'Kayıt yok' : 'Tatil',
        start: entry?.status === 'present' ? entry.start : '',
        end: entry?.status === 'present' ? entry.end : '',
        workedMinutes: calculated.workedMinutes,
        normalMinutes: calculated.normalMinutes,
        overtimeMinutes: calculated.overtimeMinutes,
        missingMinutes: calculated.missingMinutes,
      };
    });
}
