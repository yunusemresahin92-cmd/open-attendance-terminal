// Deneme Ortamı için emülatöre örnek veri yükler. Canlı Firebase'e bağlanmaz.
const project = 'demo-open-attendance';
const firestore = `http://127.0.0.1:8180/v1/projects/${project}/databases/(default)/documents`;
const auth = 'http://127.0.0.1:9199';
export const SANDBOX_LOGIN = { email: 'demo@example.local', password: 'deneme123' };

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function ready() {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${auth}/`)).status < 500 && (await fetch(`http://127.0.0.1:8180/`)).ok) return; } catch { /* henüz açılmadı */ }
    await wait(1000);
  }
  throw new Error('Emülatör açılmadı.');
}
const toValue = value => {
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'object' && value.timestampValue) return value;
  if (typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toValue(item)])) } };
  return { stringValue: String(value) };
};
async function put(path, data) {
  const response = await fetch(`${firestore}/${path}`, {
    method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([key, item]) => [key, toValue(item)])) }),
  });
  if (!response.ok) throw new Error(`${path}: ${await response.text()}`);
}

await ready();
const existing = await fetch(`${firestore}/users`, { headers: { Authorization: 'Bearer owner' } }).then(r => r.json());
if (existing.documents?.length) { console.log('Deneme verisi zaten yüklü.'); process.exit(0); }
const signUp = await fetch(`${auth}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...SANDBOX_LOGIN, returnSecureToken: true }),
}).then(r => r.json());
if (!signUp.localId) throw new Error(`Deneme hesabı açılamadı: ${JSON.stringify(signUp)}`);
await put(`users/${signUp.localId}`, { email: SANDBOX_LOGIN.email, name: 'Deneme Yöneticisi', admin: true, menus: [] });
await put('config/settings', { companies: ['Demo Şirket'] });
const people = [['p1', 'Ahmet Yılmaz', ''], ['p2', 'Mehmet Demir', ''], ['p3', 'Ayşe Kaya', ''], ['p4', 'Fatma Çelik', '2026-11-01']];
for (const [id, name, endDate] of people) {
  const common = { id, name, company: 'Demo Şirket', startDate: '2026-01-01', endDate, active: true };
  await put(`employees/${id}`, { ...common, salary: 30000, bank: 28000, overtimeRate: null, salaryHistory: [{ effectiveMonth: '2026-01', salary: 30000, bank: 28000 }] });
  await put(`employeeDirectory/${id}`, { ...common, overtimeRate: null });
  await put(`cardDirectory/${id}`, { id, name, company: 'Demo Şirket', active: true, endDate });
}
const cards = [['04A1B2C3', '001'], ['04A1B2C4', '002'], ['04A1B2C5', '003'], ['04A1B2C6', '004'], ['04A1B2C7', '005']];
for (const [cardUid, label] of cards) await put(`cardInventory/${cardUid}`, { cardUid, label, lost: false, events: cardUid === '04A1B2C7' ? 1 : 0 });
// İşten ayrılan Fatma'da hâlâ kart var: iade uyarısını göstermek için.
await put('employeeCards/p4', { employeeId: 'p4', cardUid: '04A1B2C7' });
await put('cardUids/04A1B2C7', { employeeId: 'p4', cardUid: '04A1B2C7' });
await put('cardHistory/04A1B2C7_1', { cardUid: '04A1B2C7', employeeId: 'p4', employeeName: 'Fatma Çelik', action: 'assigned', date: '2026-01-02', at: { timestampValue: '2026-01-02T06:00:00Z' } });
// Kart Okutma denemesi için Ahmet ve Mehmet'e kart verilmiş; Mehmet dün çıkışını okutmamış.
for (const [id, name, cardUid] of [['p1', 'Ahmet Yılmaz', '04A1B2C3'], ['p2', 'Mehmet Demir', '04A1B2C4']]) {
  await put(`cardInventory/${cardUid}`, { cardUid, label: cardUid === '04A1B2C3' ? '001' : '002', lost: false, events: 1 });
  await put(`employeeCards/${id}`, { employeeId: id, cardUid });
  await put(`cardUids/${cardUid}`, { employeeId: id, cardUid });
  await put(`cardHistory/${cardUid}_1`, { cardUid, employeeId: id, employeeName: name, action: 'assigned', date: '2026-01-02', at: { timestampValue: '2026-01-02T06:00:00Z' } });
}
const yesterday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date(Date.now() - 86_400_000));
await put(`clockIns/p2_${yesterday}`, { id: `p2_${yesterday}`, employeeId: 'p2', date: yesterday, cardUid: '04A1B2C4', start: '08:47', at: { timestampValue: new Date(Date.now() - 86_400_000).toISOString() } });
console.log(`Deneme verisi yüklendi. Giriş: ${SANDBOX_LOGIN.email} / ${SANDBOX_LOGIN.password}`);
