import { DEFAULT_SETTINGS } from './payroll.js';
import { isEmployeeLeaving, missingInventory, nextCardLabel, normalizeCardLabel, normalizeCardUid } from './cards.js';
import { decideClock, turkeyNow } from './clock.js';

export { normalizeCardUid };

export async function retryVerifiedCleanup({ queryRecords, deleteRecords, attempts = 3 }) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let records;
    try { records = await queryRecords(); }
    catch (cause) { lastError = cause; continue; }
    if (!records.length) return;
    try { await deleteRecords(records); }
    catch (cause) { lastError = cause; }
  }
  let remaining;
  try { remaining = await queryRecords(); }
  catch (cause) {
    throw Object.assign(new Error('Temizlik sonucu doğrulanamadı.'), { cause, verificationFailed: true });
  }
  if (remaining.length) throw Object.assign(new Error('Temizlik tamamlanamadı.'), { cause: lastError, remaining: remaining.length });
}

export async function runEmployeeRecordCleanup({ entries, clockIns }) {
  const [entryResult, clockInResult] = await Promise.allSettled([entries(), clockIns()]);
  if (entryResult.status === 'fulfilled' && clockInResult.status === 'fulfilled') return;
  const detail = [
    entryResult.status === 'rejected' && `puantaj${entryResult.reason?.remaining != null ? ` (${entryResult.reason.remaining} kayıt kaldı)` : ' (doğrulanamadı)'}`,
    clockInResult.status === 'rejected' && `açık giriş${clockInResult.reason?.remaining != null ? ` (${clockInResult.reason.remaining} kayıt kaldı)` : ' (doğrulanamadı)'}`,
  ].filter(Boolean).join(' ve ');
  throw new Error(`Personel silindi ancak ${detail} temizliği tamamlanamadı. İşlemi tekrar deneyin.`);
}

export const MENU_KEYS = ['dashboard', 'employees', 'timesheet', 'cards', 'terminal', 'reports', 'settings'];
export const PERMISSION_KEYS = [...MENU_KEYS, 'deleteEmployee'];
export const MENU_LABELS = { dashboard: 'Genel Bakış', employees: 'Personeller', timesheet: 'Günlük Saatler', cards: 'Kart Atama', terminal: 'Kart Okutma', reports: 'Maaş Raporu', settings: 'Ayarlar', deleteEmployee: 'Personel Silme' };

const REMEMBER_KEY = 'open-attendance-remembered-login';
const LEGACY_KEY = 'open-attendance-demo-v1';
const empty = () => ({ employees: [], entries: [], cards: [], inventory: [], clockIns: [], settings: { ...DEFAULT_SETTINGS } });
export function getLegacyData() {
  try {
    const value = JSON.parse(localStorage.getItem(LEGACY_KEY));
    return value && Array.isArray(value.employees) && Array.isArray(value.entries) ? value : null;
  } catch { return null; }
}
export function clearLegacyData() { localStorage.removeItem(LEGACY_KEY); }
export function getRememberedLogin() {
  try { return JSON.parse(localStorage.getItem(REMEMBER_KEY)); }
  catch { return null; }
}
export function saveRememberedLogin(email, projectId) { localStorage.setItem(REMEMBER_KEY, JSON.stringify({ email, projectId })); }
export function clearRememberedLogin() { localStorage.removeItem(REMEMBER_KEY); }
export const canSee = (profile, menu) => profile?.admin === true || profile?.menus?.includes(menu) === true;
export const canEditEntryRates = profile => canSee(profile, 'timesheet') && (canSee(profile, 'employees') || canSee(profile, 'settings'));
export function normalizePermissions(menus) {
  const permissions = [...new Set(menus.filter(item => PERMISSION_KEYS.includes(item)))];
  if (permissions.includes('deleteEmployee') && !permissions.includes('employees')) permissions.push('employees');
  return permissions;
}

export function subscriptionCollections(profile) {
  const allow = key => canSee(profile, key);
  const employeeCollection = allow('dashboard') || allow('employees') || allow('reports')
    ? 'employees'
    : allow('timesheet') || allow('settings')
      ? 'employeeDirectory'
      : allow('cards') ? 'cardDirectory' : null;
  return {
    employeeCollection,
    entries: allow('dashboard') || allow('timesheet') || allow('reports') || allow('deleteEmployee'),
    // Kart okutup çıkışı henüz okutmamış (açık girişi olan) personel.
    clockIns: allow('timesheet') || allow('dashboard'),
    cards: allow('cards'),
    settings: allow('dashboard') || allow('employees') || allow('timesheet') || allow('reports') || allow('settings'),
    syncCardDirectory: allow('employees') && allow('cards'),
  };
}

// Kart Atama'nın gördüğü kısa kayıt; kurallar personel dizini ile birebir aynı olmasını ister.
export const cardDirectoryRecord = employee => ({
  id: employee.id, name: employee.name, company: employee.company || '', active: employee.active !== false, endDate: employee.endDate || '',
});
const validCardDirectoryRecord = item => typeof item.id === 'string' && item.id.length > 0
  && typeof item.name === 'string' && item.name.length > 0 && item.name.length <= 200
  && typeof item.company === 'string' && item.company.length <= 120;

export function cardDirectoryChanges(employees, existing) {
  const current = new Map(existing.map(item => [item.id, item]));
  return employees.map(cardDirectoryRecord).filter(item => {
    if (!validCardDirectoryRecord(item)) return false;
    const old = current.get(item.id);
    return !old || old.name !== item.name || (old.company || '') !== item.company || (old.active !== false) !== item.active
      || (old.endDate ?? null) !== item.endDate;
  });
}

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
// Kurallar kart olayının tarihini Türkiye saatine göre denetler.
const turkeyDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const MANUAL_ENTRY_KEYS = ['id', 'employeeId', 'date', 'status', 'start', 'end', 'rate', 'cardUid'];
// Puantaj yetkilisinin yazdığı günlük kayıt: yalnız kuralların izin verdiği alanlar ve editedAt damgası.
export function manualEntryRecord(value, editedAt) {
  const record = Object.fromEntries(MANUAL_ENTRY_KEYS.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
  return { ...record, editedAt };
}

export function initialEntryRate({ existingEntry, offDay, canEditRates, employeeRate, defaultRate }) {
  if (existingEntry) return existingEntry.rate ?? null;
  if (offDay || !canEditRates) return null;
  return employeeRate ?? defaultRate;
}

// emulator yalnız testlerde kullanılır: { host, firestorePort, authPort }.
export async function firebaseSession(config, { emulator } = {}) {
  const { initializeApp, getApps, deleteApp } = await import('firebase/app');
  const { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence, browserSessionPersistence, inMemoryPersistence, connectAuthEmulator } = await import('firebase/auth');
  const { getFirestore, connectFirestoreEmulator, collection, doc, getDoc, getDocs, query, where, limit, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch, runTransaction, serverTimestamp } = await import('firebase/firestore');
  for (const old of getApps()) await deleteApp(old);
  const app = initializeApp(config);
  const auth = getAuth(app);
  const db = getFirestore(app);
  if (emulator) {
    connectAuthEmulator(auth, `http://${emulator.host}:${emulator.authPort}`, { disableWarnings: true });
    connectFirestoreEmulator(db, emulator.host, emulator.firestorePort);
  }
  const persistence = remember => emulator ? inMemoryPersistence : remember ? browserLocalPersistence : browserSessionPersistence;
  const waitForUser = () => new Promise(resolve => {
    let unsubscribe = () => {};
    unsubscribe = onAuthStateChanged(auth, user => { unsubscribe(); resolve(user); }, () => { unsubscribe(); resolve(null); });
  });
  const profileRef = uid => doc(db, 'users', uid);
  // Bir kart olayını kaydeder: işlem sayacını bir artırır ve o numaralı geçmiş kaydını yazar.
  // inventory, aynı işlemde okunmuş güncel Kart Listesi kaydıdır; ad, Kart Atama dizinindeki addır.
  const logCardEvent = (transaction, inventory, employeeId, employeeName, action, changes = {}) => {
    const { cardUid } = inventory.data();
    const events = (inventory.data().events || 0) + 1;
    transaction.update(inventory.ref, { ...changes, events });
    transaction.set(doc(db, 'cardHistory', `${cardUid}_${events}`), {
      cardUid, employeeId, employeeName: employeeId ? employeeName : '', action, date: turkeyDate(), at: serverTimestamp(),
    });
  };
  // Kurallar ret verirse (ör. personel başka bir cihazda işten çıkarıldıysa) anlaşılır mesaj gösterilir.
  const friendlyCardError = promise => promise.catch(cause => {
    if (cause?.code === 'permission-denied') throw new Error('Kart verilemedi: personel işten ayrılmış ya da kaydı değişmiş olabilir. Sayfayı yenileyip tekrar deneyin.');
    throw cause;
  });
  const holderName = async (transaction, employeeId) => {
    const person = await transaction.get(doc(db, 'cardDirectory', employeeId));
    if (!person.exists()) throw new Error('Personel Kart Atama listesinde bulunamadı. Sayfayı yenileyip tekrar deneyin.');
    return person.data();
  };
  return {
    projectId: config.projectId,
    currentUser: () => auth.currentUser,
    waitForUser,
    async signIn(email, password, remember) {
      await setPersistence(auth, persistence(remember));
      return signInWithEmailAndPassword(auth, email, password);
    },
    async register(email, password, remember) {
      await setPersistence(auth, persistence(remember));
      return createUserWithEmailAndPassword(auth, email, password);
    },
    signOut: () => signOut(auth),
    async ensureProfile() {
      const user = auth.currentUser;
      if (!user) throw new Error('Oturum açılmadı.');
      const reference = profileRef(user.uid);
      const existing = await getDoc(reference);
      if (!existing.exists()) await setDoc(reference, { email: user.email || '', name: user.email?.split('@')[0] || '', admin: false, menus: [] });
    },
    watchProfile(listener, onError) {
      const user = auth.currentUser;
      if (!user) throw new Error('Oturum açılmadı.');
      return onSnapshot(profileRef(user.uid), snap => listener(snap.exists() ? { uid: user.uid, ...snap.data() } : null), onError);
    },
    watchUsers(listener, onError) { return onSnapshot(collection(db, 'users'), snap => listener(snap.docs.map(item => ({ uid: item.id, ...item.data() }))), onError); },
    setUserMenus: (uid, menus) => updateDoc(profileRef(uid), { menus: normalizePermissions(menus) }),
    store(profile) {
      if (!auth.currentUser) throw new Error('Oturum açılmadı.');
      const allow = key => canSee(profile, key);
      const subscriptions = subscriptionCollections(profile);
      return {
        mode: 'firebase',
        subscribe(listener, onError) {
          const state = empty();
          const stops = [];
          let cardDirectorySynced = false;
          const publish = () => listener({ ...state });
          // Eski personeller için yalnız eksik/farklı kayıtları, güncel personel kaydını transaction içinde okuyarak yazar.
          const syncCardDirectory = async () => {
            const [employeesSnap, directorySnap] = await Promise.all([getDocs(collection(db, 'employees')), getDocs(collection(db, 'cardDirectory'))]);
            const changes = cardDirectoryChanges(employeesSnap.docs.map(item => ({ ...item.data(), id: item.id })), directorySnap.docs.map(item => item.data()));
            // Eski sürümün sildiği personelden kalan Kart Atama kayıtları temizlenir.
            if (allow('deleteEmployee')) {
              const present = new Set(employeesSnap.docs.map(item => item.id));
              for (const item of directorySnap.docs.filter(entry => !present.has(entry.id))) {
                // Temizlik en iyi çabadır: başka bir işlemle çakışırsa sonraki açılışta yeniden denenir, ekrana hata çıkarmaz.
                await runTransaction(db, async transaction => {
                  const [fresh, card] = [await transaction.get(doc(db, 'employeeDirectory', item.id)), await transaction.get(doc(db, 'employeeCards', item.id))];
                  if (!fresh.exists() && !card.exists()) transaction.delete(item.ref);
                }).catch(() => {});
              }
            }
            for (const item of changes) {
              await runTransaction(db, async transaction => {
                const fresh = await transaction.get(doc(db, 'employees', item.id));
                const directory = await transaction.get(doc(db, 'employeeDirectory', item.id));
                if (!fresh.exists() || !directory.exists()) return;
                const [record] = cardDirectoryChanges([{ ...directory.data(), id: item.id }], []);
                if (record) transaction.set(doc(db, 'cardDirectory', item.id), record);
              });
            }
          };
          if (subscriptions.employeeCollection) {
            stops.push(onSnapshot(collection(db, subscriptions.employeeCollection), snap => {
              state.employees = snap.docs.map(item => item.data());
              if (!cardDirectorySynced && subscriptions.syncCardDirectory) {
                cardDirectorySynced = true;
                syncCardDirectory().catch(cause => { cardDirectorySynced = false; onError(cause); });
              }
              publish();
            }, onError));
          }
          if (subscriptions.entries) {
            stops.push(onSnapshot(collection(db, 'entries'), snap => { state.entries = snap.docs.map(item => item.data()); publish(); }, onError));
          }
          if (subscriptions.clockIns) {
            stops.push(onSnapshot(collection(db, 'clockIns'), snap => { state.clockIns = snap.docs.map(item => item.data()); publish(); }, onError));
          }
          if (subscriptions.cards) {
            // Kart Listesi'nden önce atanmış kartlar listeye "Atanmış" olarak bir kez eklenir.
            let inventoryMigrated = false;
            let cardsLoaded = false, inventoryLoaded = false;
            const migrateInventory = async () => {
              const [mappingSnap, inventorySnap] = await Promise.all([getDocs(collection(db, 'employeeCards')), getDocs(collection(db, 'cardInventory'))]);
              const known = inventorySnap.docs.map(item => item.data());
              for (const cardUid of missingInventory(mappingSnap.docs.map(item => item.data()), known)) {
                const record = await runTransaction(db, async transaction => {
                  const reference = doc(db, 'cardInventory', cardUid);
                  if ((await transaction.get(reference)).exists()) return null;
                  const value = { cardUid, label: nextCardLabel(known), lost: false, events: 0 };
                  transaction.set(reference, value);
                  return value;
                });
                // Transaction yeniden denenirse numara atlanmasın diye yalnız başarılı kayıttan sonra eklenir.
                if (record) known.push(record);
              }
            };
            const maybeMigrate = () => {
              if (inventoryMigrated || !cardsLoaded || !inventoryLoaded || !missingInventory(state.cards, state.inventory).length) return;
              inventoryMigrated = true;
              migrateInventory().catch(cause => { inventoryMigrated = false; onError(cause); });
            };
            stops.push(onSnapshot(collection(db, 'employeeCards'), snap => { state.cards = snap.docs.map(item => item.data()); cardsLoaded = true; maybeMigrate(); publish(); }, onError));
            stops.push(onSnapshot(collection(db, 'cardInventory'), snap => { state.inventory = snap.docs.map(item => item.data()); inventoryLoaded = true; maybeMigrate(); publish(); }, onError));
          }
          // Yetkisi olmayan (onay bekleyen) hesap şirket ayarlarını okumaz.
          if (subscriptions.settings) stops.push(onSnapshot(doc(db, 'config', 'settings'), snap => { state.settings = { ...DEFAULT_SETTINGS, ...(snap.data() || {}) }; publish(); }, onError));
          publish();
          return () => stops.forEach(stop => stop());
        },
        async saveEmployee(value) {
          const batch = writeBatch(db);
          batch.set(doc(db, 'employees', value.id), value);
          batch.set(doc(db, 'employeeDirectory', value.id), {
            id: value.id, name: value.name, company: value.company || '', startDate: value.startDate, endDate: value.endDate || '',
            active: value.active !== false, overtimeRate: value.overtimeRate ?? null
          });
          batch.set(doc(db, 'cardDirectory', value.id), cardDirectoryRecord(value));
          await batch.commit();
        },
        async deleteEmployee(id) {
          if (!allow('employees') || !allow('deleteEmployee')) throw new Error('Personel silme yetkiniz yok.');
          await runTransaction(db, async transaction => {
            const cardReference = doc(db, 'employeeCards', id);
            const card = await transaction.get(cardReference);
            const cardUid = card.exists() ? card.data().cardUid : '';
            let inventory = null, person = null;
            if (cardUid) {
              inventory = await transaction.get(doc(db, 'cardInventory', cardUid));
              person = await transaction.get(doc(db, 'cardDirectory', id));
              transaction.delete(cardReference);
              transaction.delete(doc(db, 'cardUids', cardUid));
              // Kart boşa çıkar ve geçmişe "teslim alındı" yazılır.
              if (inventory.exists()) logCardEvent(transaction, inventory, id, person.data()?.name || '', 'returned');
            }
            transaction.delete(doc(db, 'employees', id));
            transaction.delete(doc(db, 'employeeDirectory', id));
            transaction.delete(doc(db, 'cardDirectory', id));
          });
          // Personel önce silinir; ardından iki bağımlı koleksiyon da birbirinden bağımsız olarak
          // sınırlı sayıda sorgula-sil-sorgula döngüsüyle temizlenir ve sonuç doğrulanır.
          const cleanup = collectionName => retryVerifiedCleanup({
            queryRecords: async () => (await getDocs(query(collection(db, collectionName), where('employeeId', '==', id)))).docs,
            deleteRecords: async records => {
              for (let index = 0; index < records.length; index += 450) {
                const batch = writeBatch(db);
                records.slice(index, index + 450).forEach(item => batch.delete(item.ref));
                await batch.commit();
              }
            },
          });
          await runEmployeeRecordCleanup({ entries: () => cleanup('entries'), clockIns: () => cleanup('clockIns') });
        },
        // Ad ve işten ayrılma durumu ekrandan değil, işlem içinde okunan Kart Atama dizininden alınır.
        assignCard: (employeeId, _employeeName, value) => friendlyCardError(runTransaction(db, async transaction => {
          if (!allow('cards')) throw new Error('Kart atama yetkiniz yok.');
          const cardUid = normalizeCardUid(value);
          const employeeReference = doc(db, 'employeeCards', employeeId);
          const current = await transaction.get(employeeReference);
          const claimedReference = doc(db, 'cardUids', cardUid);
          const claimed = await transaction.get(claimedReference);
          const inventory = await transaction.get(doc(db, 'cardInventory', cardUid));
          const person = await holderName(transaction, employeeId);
          if (!inventory.exists()) throw new Error('Bu kart Kart Listesi\'nde kayıtlı değil. Önce kartı listeye ekleyin.');
          if (inventory.data().lost) throw new Error('Bu kart kayıp olarak işaretli. Önce "Bulundu" olarak işaretleyin.');
          const oldUid = current.data()?.cardUid;
          if (oldUid === cardUid && claimed.data()?.employeeId === employeeId) {
            // 0.3.x eşleşmesini aynı kart/personel korunarak v0.4 çevrimdışı güvenlik damgasına yükselt.
            if (!claimed.data()?.assignedAt) transaction.update(claimedReference, { assignedAt: serverTimestamp() });
            return;
          }
          if (claimed.exists()) throw new Error('Bu kart başka bir personele atanmış. Önce mevcut atamayı kaldırın.');
          if (isEmployeeLeaving(person, turkeyDate())) throw new Error('İşten ayrılan personele kart verilemez.');
          let oldInventory = null;
          if (oldUid) {
            await transaction.get(doc(db, 'cardUids', oldUid));
            oldInventory = await transaction.get(doc(db, 'cardInventory', oldUid));
            transaction.delete(doc(db, 'cardUids', oldUid));
          }
          transaction.set(employeeReference, { employeeId, cardUid });
          // assignedAt: çevrimdışı okutmalar yalnız bu andan sonrası için yeni sahibine yazılır (kurallar denetler).
          transaction.set(claimedReference, { employeeId, cardUid, assignedAt: serverTimestamp() });
          if (oldInventory?.exists()) logCardEvent(transaction, oldInventory, employeeId, person.name, 'returned');
          logCardEvent(transaction, inventory, employeeId, person.name, 'assigned');
        })),
        // lost=true: kart personelden alınır ve kayıp işaretlenir; false: kart teslim alındı, boşa çıkar.
        removeCard: (employeeId, _employeeName, lost = false) => runTransaction(db, async transaction => {
          if (!allow('cards')) throw new Error('Kart atama yetkiniz yok.');
          const employeeReference = doc(db, 'employeeCards', employeeId);
          const current = await transaction.get(employeeReference);
          if (!current.exists()) return;
          const cardUid = current.data().cardUid;
          const uidReference = doc(db, 'cardUids', cardUid);
          await transaction.get(uidReference);
          const inventory = await transaction.get(doc(db, 'cardInventory', cardUid));
          const person = await holderName(transaction, employeeId);
          transaction.delete(employeeReference);
          transaction.delete(uidReference);
          if (!inventory.exists()) return;
          logCardEvent(transaction, inventory, employeeId, person.name, lost ? 'lost' : 'returned', lost ? { lost: true } : {});
        }),
        addInventoryCard: (value, labelValue) => runTransaction(db, async transaction => {
          if (!allow('cards')) throw new Error('Kart atama yetkiniz yok.');
          const cardUid = normalizeCardUid(value);
          const label = normalizeCardLabel(labelValue);
          const reference = doc(db, 'cardInventory', cardUid);
          const existing = await transaction.get(reference);
          if (existing.exists()) throw Object.assign(new Error(`Bu kart zaten kayıtlı (Kart ${existing.data().label}).`), { code: 'duplicate-card', label: existing.data().label });
          transaction.set(reference, { cardUid, label, lost: false, events: 0 });
          return { cardUid, label };
        }),
        // Yanlış girilen kartı düzeltir. Numara her zaman değişebilir; UID yalnız hiç kullanılmamış ve atanmamış kartta değişir
        // (geçmiş kayıtları kartın UID'sine bağlıdır).
        updateInventoryCard: (oldUid, uidValue, labelValue) => runTransaction(db, async transaction => {
          if (!allow('cards')) throw new Error('Kart atama yetkiniz yok.');
          const cardUid = normalizeCardUid(uidValue);
          const label = normalizeCardLabel(labelValue);
          const oldReference = doc(db, 'cardInventory', oldUid);
          const current = await transaction.get(oldReference);
          if (!current.exists()) throw new Error('Kart listede bulunamadı.');
          if (cardUid === oldUid) { transaction.update(oldReference, { label }); return; }
          const target = await transaction.get(doc(db, 'cardInventory', cardUid));
          const mapping = await transaction.get(doc(db, 'cardUids', oldUid));
          if ((current.data().events || 0) > 0 || mapping.exists()) throw new Error('Bu kart kullanılmış; kullanılmış kartın UID\'si değiştirilemez. Yalnız numarası değiştirilebilir.');
          if (target.exists()) throw new Error(`Bu UID zaten kayıtlı (Kart ${target.data().label}).`);
          transaction.delete(oldReference);
          transaction.set(doc(db, 'cardInventory', cardUid), { cardUid, label, lost: false, events: 0 });
        }),
        renameInventoryCard: (cardUid, labelValue) => runTransaction(db, async transaction => {
          if (!allow('cards')) throw new Error('Kart atama yetkiniz yok.');
          const label = normalizeCardLabel(labelValue);
          const reference = doc(db, 'cardInventory', cardUid);
          const current = await transaction.get(reference);
          if (!current.exists()) throw new Error('Kart listede bulunamadı.');
          transaction.update(reference, { label });
        }),
        // Kart kimdeyse onun atamasını da kaldırır.
        setInventoryLost: (cardUid, lost) => runTransaction(db, async transaction => {
          if (!allow('cards')) throw new Error('Kart atama yetkiniz yok.');
          const inventory = await transaction.get(doc(db, 'cardInventory', cardUid));
          if (!inventory.exists()) throw new Error('Kart listede bulunamadı.');
          const uidReference = doc(db, 'cardUids', cardUid);
          const mapping = await transaction.get(uidReference);
          if (Boolean(inventory.data().lost) === lost) return;
          let holder = '', name = '';
          if (lost && mapping.exists()) {
            holder = mapping.data().employeeId;
            const employeeReference = doc(db, 'employeeCards', holder);
            await transaction.get(employeeReference);
            name = (await holderName(transaction, holder)).name;
            transaction.delete(employeeReference);
            transaction.delete(uidReference);
          }
          logCardEvent(transaction, inventory, holder, name, lost ? 'lost' : 'found', { lost });
        }),
        // Geçmişi olan (en az bir kez kullanılmış) kart silinemez; kurallar da sayacı denetler.
        deleteInventoryCard: cardUid => runTransaction(db, async transaction => {
          if (!allow('cards')) throw new Error('Kart atama yetkiniz yok.');
          const reference = doc(db, 'cardInventory', cardUid);
          const inventory = await transaction.get(reference);
          const mapping = await transaction.get(doc(db, 'cardUids', cardUid));
          if (!inventory.exists()) return;
          if (mapping.exists()) throw new Error('Atanmış kart silinemez. Önce atamayı kaldırın.');
          if ((inventory.data().events || 0) > 0) throw new Error('Bu kart daha önce kullanılmış; geçmişi korumak için silinemez. Kaybolduysa "Kayıp" olarak işaretleyin.');
          transaction.delete(reference);
        }),
        async cardHistory(cardUid) {
          if (!allow('cards')) throw new Error('Kart atama yetkiniz yok.');
          const snap = await getDocs(query(collection(db, 'cardHistory'), where('cardUid', '==', cardUid)));
          return snap.docs.map(item => ({ id: item.id, ...item.data() }));
        },
        // Günlük kayıt ve varsa aynı kimlikli açık giriş tek işlemde birlikte kapanır.
        // İkinci parametre eski istemci çağrılarıyla uyumluluk için kabul edilir.
        // Elle kayıt editedAt ile damgalanır; okutmadan önceki çevrimdışı kayıtlar bu düzeltmenin üstüne yazılamaz.
        // Çevrimdışı işaretleri (source/scanAt) elle kayıtta kalkar.
        async saveEntry(value, _options = {}) {
          const batch = writeBatch(db);
          batch.set(doc(db, 'entries', value.id), manualEntryRecord(value, serverTimestamp()));
          batch.delete(doc(db, 'clockIns', value.id));
          await batch.commit();
        },
        deleteClockIn: id => deleteDoc(doc(db, 'clockIns', id)),
        // Kart Okutma: ilk okutma giriş, sonraki okutma çıkış. Saat Türkiye saatidir; kurallar sunucu saatiyle denetler.
        clockCard: value => runTransaction(db, async transaction => {
          if (!allow('terminal')) throw new Error('Kart okutma yetkiniz yok.');
          const cardUid = normalizeCardUid(value);
          const mapping = await transaction.get(doc(db, 'cardUids', cardUid));
          if (!mapping.exists()) return { action: 'unknown', cardUid };
          const employeeId = mapping.data().employeeId;
          const person = await transaction.get(doc(db, 'cardDirectory', employeeId));
          const name = person.data()?.name || '';
          const now = turkeyNow();
          if (!person.exists() || isEmployeeLeaving(person.data(), now.date)) return { action: 'left', cardUid, employeeId, name };
          const id = `${employeeId}_${now.date}`;
          const entryReference = doc(db, 'entries', id);
          const clockReference = doc(db, 'clockIns', id);
          const entry = await transaction.get(entryReference);
          const clockIn = await transaction.get(clockReference);
          const decision = decideClock({ entry: entry.exists() ? entry.data() : null, clockIn: clockIn.exists() ? clockIn.data() : null, now });
          if (decision.action === 'in') transaction.set(clockReference, { id, employeeId, date: now.date, cardUid, start: now.time, at: serverTimestamp() });
          if (decision.action === 'out') {
            // Wi-Fi okuyucunun çevrimdışı açtığı girişin işareti (0.4.0) günlük kayda taşınır.
            const offline = clockIn.data()?.source === 'offline' ? { source: 'offline' } : {};
            transaction.set(entryReference, { id, employeeId, date: now.date, status: 'present', start: decision.start, end: decision.end, rate: null, cardUid, ...offline });
            transaction.delete(clockReference);
          }
          if (decision.action === 'extend') transaction.update(entryReference, { end: decision.end, cardUid });
          return { ...decision, cardUid, employeeId, name, date: now.date };
        }).catch(cause => {
          if (cause?.code === 'permission-denied') throw new Error('Okutma kaydedilemedi. Bu bilgisayarın tarih ve saati doğru mu kontrol edin.');
          throw cause;
        }),
        deleteEntry: id => deleteDoc(doc(db, 'entries', id)),
        saveSettingsRevision: (effectiveDate, rules) => runTransaction(db, async transaction => {
          if (!allow('settings')) throw new Error('Ayarları değiştirme yetkiniz yok.');
          const reference = doc(db, 'config', 'settings');
          const current = (await transaction.get(reference)).data() || {};
          const dateOf = item => item.effectiveDate || `${item.effectiveMonth}-01`;
          const previous = (Array.isArray(current.history) ? current.history : []).filter(item => dateOf(item) !== effectiveDate);
          if (previous.length >= 10) throw new Error('En fazla 10 hesaplama kuralı revizyonu tutulabilir. Yeni kayıt için eski bir revizyonu kaldırın.');
          const history = [...previous, { effectiveDate, rules }]
            .sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
          transaction.set(reference, { ...current, history });
        }),
        saveCompany: (oldName, name) => runTransaction(db, async transaction => {
          if (!allow('settings')) throw new Error('Şirketleri düzenleme yetkiniz yok.');
          const cleanName = String(name).trim();
          if (!cleanName || cleanName.length > 120) throw new Error('Şirket adı 1–120 karakter olmalı.');
          const reference = doc(db, 'config', 'settings');
          const current = (await transaction.get(reference)).data() || {};
          const companies = Array.isArray(current.companies) ? [...current.companies] : [];
          if (oldName && !companies.includes(oldName)) throw new Error('Şirket listesi değişti. Yeniden deneyin.');
          if (companies.some(item => item !== oldName && item.toLocaleLowerCase('tr-TR') === cleanName.toLocaleLowerCase('tr-TR'))) throw new Error('Bu şirket zaten kayıtlı.');
          if (oldName) companies[companies.indexOf(oldName)] = cleanName;
          else {
            if (companies.length >= 5) throw new Error('En fazla 5 şirket kaydedilebilir. Yeni şirket için kullanılmayan bir şirketi silin.');
            companies.push(cleanName);
          }
          transaction.set(reference, { ...current, companies });
        }),
        deleteCompany: name => runTransaction(db, async transaction => {
          if (!allow('settings')) throw new Error('Şirketleri düzenleme yetkiniz yok.');
          const reference = doc(db, 'config', 'settings');
          const current = (await transaction.get(reference)).data() || {};
          const companies = Array.isArray(current.companies) ? current.companies : [];
          if (!companies.includes(name)) throw new Error('Şirket listesi değişti. Yeniden deneyin.');
          transaction.set(reference, { ...current, companies: companies.filter(item => item !== name) });
        })
      };
    }
  };
}
