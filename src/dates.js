export function formatDateTr(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return '';
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (parsed.getUTCFullYear() !== Number(year) || parsed.getUTCMonth() + 1 !== Number(month) || parsed.getUTCDate() !== Number(day)) return '';
  return `${day}.${month}.${year}`;
}

export function formatMonthTr(value) {
  const date = formatDateTr(`${value}-01`);
  return date ? date.slice(3) : '';
}
