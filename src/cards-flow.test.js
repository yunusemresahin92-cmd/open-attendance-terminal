// Uçtan uca: data.js'teki gerçek kart akışlarını Firestore + Auth emülatöründe, gerçek kurallarla çalıştırır.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { firebaseSession } from './data.js';

// Kural testleri kendi projelerini her adımda temizlediği için uçtan uca test ayrı bir deneme projesi kullanır.
const projectId = 'demo-open-attendance-e2e';
const [host, firestorePort] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const emulator = { host, firestorePort: Number(firestorePort), authPort: Number(authHost.split(':')[1]) };
const config = { apiKey: 'demo-key', authDomain: `${projectId}.firebaseapp.com`, projectId, appId: 'demo-app' };
const base = `http://${host}:${firestorePort}/v1/projects/${projectId}/databases/(default)/documents`;

const toValue = value => {
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toValue) } };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toValue(item)])) } };
  return { stringValue: String(value) };
};
async function seed(path, data) {
  const response = await fetch(`${base}/${path}`, {
    method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([key, item]) => [key, toValue(item)])) }),
  });
  assert.equal(response.ok, true, await response.text());
}
const employee = (id, name) => ({
  id, name, company: 'Demo Şirket', startDate: '2026-01-01', endDate: '', active: true, salary: 30000, bank: 28000, overtimeRate: null,
  salaryHistory: [{ effectiveMonth: '2026-01', salary: 30000, bank: 28000 }],
});

let session, store, state = null, stop;
const errors = [];
const onError = cause => errors.push(cause);
const waitFor = async (predicate, label) => {
  for (let i = 0; i < 100; i++) { if (state && predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 50)); }
  assert.fail(`Beklenen durum oluşmadı: ${label}`);
};
const holderOf = uid => state.cards.find(item => item.cardUid === uid)?.employeeId;
const inventoryOf = uid => state.inventory.find(item => item.cardUid === uid);

before(async () => {
  await fetch(`${base}`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
  await fetch(`http://${authHost}/emulator/v1/projects/${projectId}/accounts`, { method: 'DELETE' });
  session = await firebaseSession(config, { emulator });
  await session.register('admin@example.com', 'test-password-1', false);
  const uid = session.currentUser().uid;
  await seed(`users/${uid}`, { email: 'admin@example.com', name: 'Admin', admin: true, menus: [] });
  const profile = { uid, admin: true, menus: [] };
  store = session.store(profile);
  stop = store.subscribe(value => { state = value; }, onError);
  await store.saveEmployee(employee('e1', 'Ali'));
  await store.saveEmployee(employee('e2', 'Veli'));
  await waitFor(value => value.employees.length === 2, 'personeller yüklendi');
});
// Arka planda süren eşitleme/göç işlemleri oturum kapanmadan bitsin; abonelik hatası testi bozar.
after(async () => {
  stop?.();
  await new Promise(resolve => setTimeout(resolve, 2000));
  const seen = errors.map(item => item.message);
  await session?.signOut();
  assert.deepEqual(seen, []);
});

test('cards are registered once and assigned only from the list', async () => {
  assert.deepEqual(await store.addInventoryCard('a1 b2 c3 d4', '001'), { cardUid: 'A1B2C3D4', label: '001' });
  await assert.rejects(store.addInventoryCard('A1B2C3D4', '005'), /zaten kayıtlı \(Kart 001\)/);
  await store.addInventoryCard('B1B2C3D4', '002');
  await assert.rejects(store.assignCard('e1', 'Ali', 'C1C2C3D4'), /Kart Listesi'nde kayıtlı değil/);
  await store.assignCard('e1', 'Ali', 'A1B2C3D4');
  await assert.rejects(store.assignCard('e2', 'Veli', 'A1B2C3D4'), /başka bir personele/);
  await waitFor(() => holderOf('A1B2C3D4') === 'e1', 'A kartı Ali\'de');
});

test('changing a card frees the old one and records both events', async () => {
  await store.assignCard('e1', 'Ali', 'B1B2C3D4');
  await waitFor(() => holderOf('B1B2C3D4') === 'e1' && !holderOf('A1B2C3D4'), 'Ali\'nin kartı B oldu');
  const history = (await store.cardHistory('A1B2C3D4')).map(item => `${item.action}:${item.employeeName}`).sort();
  assert.deepEqual(history, ['assigned:Ali', 'returned:Ali']);
});

test('a card taken back as lost cannot be assigned until it is found', async () => {
  await store.removeCard('e1', 'Ali', true);
  await waitFor(() => !holderOf('B1B2C3D4') && inventoryOf('B1B2C3D4')?.lost === true, 'B kayıp');
  await assert.rejects(store.assignCard('e2', 'Veli', 'B1B2C3D4'), /kayıp/);
  await store.setInventoryLost('B1B2C3D4', false);
  await store.assignCard('e2', 'Veli', 'B1B2C3D4');
  await waitFor(() => holderOf('B1B2C3D4') === 'e2', 'B Veli\'de');
  await store.setInventoryLost('B1B2C3D4', true, 'Veli');
  await waitFor(() => !holderOf('B1B2C3D4') && inventoryOf('B1B2C3D4')?.lost === true, 'Veli\'deki kart kayıp işaretlenince atama kalktı');
  const history = await store.cardHistory('B1B2C3D4');
  assert.deepEqual(history.map(item => item.action).sort(), ['assigned', 'assigned', 'found', 'lost', 'lost']);
  // Her olay kartın sıradaki işlem numarasıyla kaydedilir.
  assert.deepEqual(history.map(item => item.id).sort(), ['B1B2C3D4_1', 'B1B2C3D4_2', 'B1B2C3D4_3', 'B1B2C3D4_4', 'B1B2C3D4_5']);
  assert.equal(history.find(item => item.id === 'B1B2C3D4_5').employeeName, 'Veli');
});

test('used cards keep their history; only unused cards can be deleted', async () => {
  await assert.rejects(store.deleteInventoryCard('A1B2C3D4'), /daha önce kullanılmış/);
  await store.addInventoryCard('C1C2C3D4', '003');
  await store.renameInventoryCard('C1C2C3D4', 'Yedek');
  await waitFor(() => inventoryOf('C1C2C3D4')?.label === 'Yedek', 'numara değişti');
  await store.deleteInventoryCard('C1C2C3D4');
  await waitFor(() => !inventoryOf('C1C2C3D4'), 'kullanılmamış kart silindi');
});

test('a wrongly entered unused card can be corrected; a used card keeps its UID', async () => {
  await store.addInventoryCard('F1F2F3F4', '020');
  await store.updateInventoryCard('F1F2F3F4', 'f1 f2 f3 f5', '021');
  await waitFor(() => !inventoryOf('F1F2F3F4') && inventoryOf('F1F2F3F5')?.label === '021', 'kart UID ve numarası düzeltildi');
  await assert.rejects(store.updateInventoryCard('F1F2F3F5', 'A1B2C3D4', '021'), /zaten kayıtlı/);
  await store.updateInventoryCard('F1F2F3F5', 'F1F2F3F5', '022');
  await waitFor(() => inventoryOf('F1F2F3F5')?.label === '022', 'yalnız numara değişti');
  await assert.rejects(store.updateInventoryCard('A1B2C3D4', 'A1B2C3D9', '001'), /kullanılmış kartın UID/);
  await store.deleteInventoryCard('F1F2F3F5');
});

test('the name in the history comes from the employee list, not from the screen', async () => {
  await store.addInventoryCard('E1E2E3E4', '010');
  await store.assignCard('e1', 'Sahte Ad', 'E1E2E3E4');
  await store.removeCard('e1', 'Sahte Ad', false);
  const names = (await store.cardHistory('E1E2E3E4')).map(item => item.employeeName);
  assert.deepEqual(names, ['Ali', 'Ali']);
});

test('employees who have left cannot be given a card', async () => {
  await store.saveEmployee({ ...employee('e9', 'Ayrılan'), endDate: '2026-01-31' });
  await assert.rejects(store.assignCard('e9', 'Ayrılan', 'E1E2E3E4'), /İşten ayrılan personele/);
  await store.deleteEmployee('e9');
});

test('a returned card can be given to a new employee while old history stays with the leaver', async () => {
  await store.assignCard('e1', 'Ali', 'A1B2C3D4');
  await store.removeCard('e1', 'Ali', false);
  await store.assignCard('e2', 'Veli', 'A1B2C3D4');
  await waitFor(() => holderOf('A1B2C3D4') === 'e2', 'A kartı Veli\'ye geçti');
  const names = (await store.cardHistory('A1B2C3D4')).filter(item => item.action === 'assigned').map(item => item.employeeName).sort();
  assert.deepEqual(names, ['Ali', 'Ali', 'Veli']);
});

test('deleting an employee frees the card and logs the return', async () => {
  await store.deleteEmployee('e2');
  await waitFor(() => !holderOf('A1B2C3D4') && inventoryOf('A1B2C3D4')?.lost === false, 'silinen personelin kartı boşta');
  const last = (await store.cardHistory('A1B2C3D4')).filter(item => item.action === 'returned' && item.employeeName === 'Veli');
  assert.equal(last.length, 1);
});

test('cards assigned before the card list existed are added to it automatically', async () => {
  await store.saveEmployee(employee('e3', 'Ayşe'));
  await seed('employeeCards/e3', { employeeId: 'e3', cardUid: 'D1D2D3D4' });
  await seed('cardUids/D1D2D3D4', { employeeId: 'e3', cardUid: 'D1D2D3D4' });
  stop();
  state = null;
  stop = store.subscribe(value => { state = value; }, onError);
  await waitFor(() => inventoryOf('D1D2D3D4')?.label === '011' && holderOf('D1D2D3D4') === 'e3', 'eski kart listeye eklendi');
  assert.equal(inventoryOf('D1D2D3D4').events, 0);
});

test('card list entries left behind by an old app version are cleaned up', async () => {
  await seed('cardDirectory/old1', { id: 'old1', name: 'Eski Personel', company: '', active: true, endDate: '' });
  stop();
  state = null;
  stop = store.subscribe(value => { state = value; }, onError);
  for (let i = 0; i < 100; i++) {
    const response = await fetch(`${base}/cardDirectory/old1`, { headers: { Authorization: 'Bearer owner' } });
    if (response.status === 404) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail('eski kayıt temizlenmedi');
});
