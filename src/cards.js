// RFID kart listesi (envanter) için saf yardımcılar. Firebase'e bağlı değildir, birim testleriyle doğrulanır.

export function normalizeCardUid(value) {
  const raw = String(value ?? '').trim();
  if (!/^[0-9a-fA-F\s:-]+$/.test(raw)) throw new Error('Kart UID yalnız onaltılık (0-9, A-F) karakterlerden oluşmalı.');
  const uid = raw.replace(/[\s:-]/g, '').toUpperCase();
  if (![8, 14, 20].includes(uid.length)) throw new Error('Kart UID 8, 14 veya 20 onaltılık karakter olmalı.');
  return uid;
}

export function normalizeCardLabel(value) {
  const label = String(value ?? '').trim();
  if (!label) throw new Error('Kart numarası boş olamaz.');
  if (label.length > 20) throw new Error('Kart numarası en fazla 20 karakter olabilir.');
  return label;
}

export function nextCardLabel(inventory) {
  const highest = inventory.reduce((max, item) => /^\d+$/.test(item.label || '') ? Math.max(max, Number(item.label)) : max, 0);
  return String(highest + 1).padStart(3, '0');
}

const compareLabels = (a, b) => String(a.label).localeCompare(String(b.label), 'tr-TR', { numeric: true });

export function cardStatus(card, mappings) {
  if (mappings.some(item => item.cardUid === card.cardUid)) return 'assigned';
  return card.lost ? 'lost' : 'available';
}

export function availableCards(inventory, mappings) {
  return inventory.filter(item => cardStatus(item, mappings) === 'available').sort(compareLabels);
}

export function sortInventory(inventory) { return [...inventory].sort(compareLabels); }

export function missingInventory(mappings, inventory) {
  const known = new Set(inventory.map(item => item.cardUid));
  return mappings.map(item => item.cardUid).filter(uid => !known.has(uid));
}

export function isEmployeeLeaving(employee, today) {
  return employee.active === false || Boolean(employee.endDate && employee.endDate <= today);
}

export function cardsNeedingReturn(employees, mappings, today) {
  const byEmployee = new Map(mappings.map(item => [item.employeeId, item.cardUid]));
  return employees.filter(item => byEmployee.has(item.id) && isEmployeeLeaving(item, today))
    .map(employee => ({ employee, cardUid: byEmployee.get(employee.id) }));
}

const millis = value => value?.toMillis ? value.toMillis() : Number.POSITIVE_INFINITY; // henüz sunucu saati gelmemiş kayıt en yenidir
export function sortCardHistory(items) { return [...items].sort((a, b) => millis(b.at) - millis(a.at)); }

export const CARD_STATUS_LABELS = { available: 'Boşta', assigned: 'Atanmış', lost: 'Kayıp' };
export const CARD_HISTORY_LABELS = { assigned: 'Verildi', returned: 'Teslim alındı', lost: 'Kayıp bildirildi', found: 'Bulundu' };
