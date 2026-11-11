import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Users, CalendarDays, ChartNoAxesCombined, Settings, Plus, Download, ChevronLeft, ChevronRight, Clock3, ShieldCheck, Pencil, Trash2, X, Check, Cloud, AlertCircle, Search, Shield, LogOut, Share, Smartphone, CreditCard, Usb, Unplug, History, ScanLine, Wifi, WifiOff, Send, RefreshCw } from 'lucide-react';
import { calculateDay, calculateMonth, employeeSalaryForMonth, monthDays, todayKey, hours, DEFAULT_SETTINGS, resolveSettings, validateRules, money } from './payroll.js';
import { firebaseSession, getLegacyData, clearLegacyData, getRememberedLogin, saveRememberedLogin, clearRememberedLogin, canSee, canEditEntryRates, initialEntryRate, MENU_KEYS, PERMISSION_KEYS, MENU_LABELS } from './data.js';
import { dailyAttendanceRows, safeSpreadsheetText } from './export-data.js';
import { formatDateTr, formatMonthTr } from './dates.js';
import { availableCards, cardStatus, cardsNeedingReturn, isEmployeeLeaving, nextCardLabel, sortCardHistory, sortInventory, CARD_HISTORY_LABELS, CARD_STATUS_LABELS } from './cards.js';
import { connectCardReader, isReaderPort, rememberedReaderPort, serialSupported } from './card-reader.js';
import { createReaderReconnectCoordinator } from './reader-reconnect.js';
import { deviceAccountProblem, deviceConfigFields, deviceFailText, deviceTimeFields, validateDeviceConfig, DEVICE_CFG_ERRORS, DEVICE_NET_LABELS, DEVICE_WIFI_LABELS, SETUP_AP_NAME } from './device-config.js';
import { readerMessageFor, turkeyNow, REPEAT_MINUTES } from './clock.js';
import { embeddedFirebaseConfig } from './firebase-config.js';
import appLogo from './assets/app-logo.png';
import companyLogo from './assets/brand-logo.png';
import './styles.css';
import './company.css';
import './mobile.css';

const currency = value => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(Number(value) || 0);
const number = value => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 2 }).format(Number(value) || 0);
const dayLabel = index => ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'][index];
const makeId = () => crypto.randomUUID();
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'geliştirme';

// Uygulama tasarımında onay penceresi. Tarayıcının kendi confirm/prompt pencereleri kullanılmaz.
let openConfirm = null;
function askConfirm(options) {
  return new Promise(resolve => { if (openConfirm) openConfirm({ ...options, resolve }); else resolve(false); });
}
function ConfirmHost() {
  const [request, setRequest] = useState(null);
  useEffect(() => { openConfirm = setRequest; return () => { openConfirm = null; }; }, []);
  useEffect(() => {
    if (!request) return undefined;
    const onKey = event => { if (event.key === 'Escape') close(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (!request) return null;
  function close(answer) { request.resolve(answer); setRequest(null); }
  return <div className="modal-backdrop confirm-backdrop" onMouseDown={() => close(false)}><div className="modal confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={event => event.stopPropagation()}>
    <div className="modal-head"><div><span className="eyebrow">{request.eyebrow || 'ONAY'}</span><h2 id="confirm-title">{request.title}</h2></div><button className="icon-button" aria-label="Kapat" onClick={() => close(false)}><X size={19} /></button></div>
    <div className="confirm-body">
      {request.message && <p>{request.message}</p>}
      {request.items?.length > 0 && <ul>{request.items.map(item => <li key={item}>{item}</li>)}</ul>}
      {request.note && <p className="help-text">{request.note}</p>}
      <div className="modal-actions"><button type="button" className="secondary" onClick={() => close(false)}>Vazgeç</button><button type="button" autoFocus className={`primary${request.danger ? ' danger-button' : ''}`} onClick={() => close(true)}>{request.danger ? <Trash2 size={16} /> : <Check size={16} />} {request.confirmText || 'Onayla'}</button></div>
    </div>
  </div></div>;
}
// Deneme Ortamı (npm run deneme): canlı Firebase yerine bu bilgisayardaki emülatöre bağlanır, gerçek verilere dokunmaz.
const SANDBOX = import.meta.env?.VITE_SANDBOX === '1';
const SANDBOX_CONFIG = { apiKey: 'demo-key', authDomain: 'demo-open-attendance.firebaseapp.com', projectId: 'demo-open-attendance', appId: 'demo-app' };
const SANDBOX_EMULATOR = { host: '127.0.0.1', firestorePort: 8180, authPort: 9199 };
// Yalnız bu bilgisayardaki emülatörde açılan örnek hesap (scripts/sandbox-seed.mjs); canlı sistemde yoktur.
const SANDBOX_LOGIN = { email: 'demo@example.local', password: 'deneme123' };
const MOBILE_QUERY = '(max-width: 760px)';
function useIsMobile() {
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const update = () => setMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return mobile;
}
const shiftDate = (date, delta) => { const value = new Date(`${date}T12:00:00`); value.setDate(value.getDate() + delta); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`; };
const TAB_LABELS = { dashboard: 'Genel Bakış', employees: 'Personeller', timesheet: 'Günlük Saatler', cards: 'Kart Atama', terminal: 'Kart Okutma', reports: 'Maaş Raporu', settings: 'Ayarlar', admin: 'Admin', waiting: 'Yetki Bekleniyor' };

function App() {
  const [store, setStore] = useState(null);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [users, setUsers] = useState([]);
  const profileStop = useRef(null);
  const [mode, setMode] = useState('loading');
  const [data, setData] = useState({ employees: [], entries: [], cards: [], settings: DEFAULT_SETTINGS });
  const [tab, setTab] = useState('dashboard');
  const [cardReturn, setCardReturn] = useState(null);
  const [month, setMonth] = useState(todayKey().slice(0, 7));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [employeeModal, setEmployeeModal] = useState(null);
  const [entryModal, setEntryModal] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedReport, setSelectedReport] = useState(null);
  const [today, setToday] = useState(todayKey());
  const [selectedDay, setSelectedDay] = useState(todayKey());
  const isMobile = useIsMobile();

  useEffect(() => {
    const timer = setInterval(() => setToday(todayKey()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (SANDBOX) connect(SANDBOX_CONFIG);
    else if (embeddedFirebaseConfig) connect(embeddedFirebaseConfig);
    else { setError('Firebase yapılandırması kurulum dosyasında bulunamadı.'); setMode('configuration-error'); }
  }, []);

  useEffect(() => {
    if (!session || !profile?.admin || mode !== 'firebase') { setUsers([]); return; }
    return session.watchUsers(setUsers, cause => setError(cause.message || 'Kullanıcılar okunamadı.'));
  }, [session, profile?.admin, mode]);

  useEffect(() => {
    if (!store) return;
    const stop = store.subscribe(setData, err => setError(err.message || 'Firebase verileri okunamadı.'));
    return stop;
  }, [store]);

  async function connect(config) {
    setError(''); setMode('loading');
    try {
      const next = await firebaseSession(config, SANDBOX ? { emulator: SANDBOX_EMULATOR } : undefined);
      setSession(next);
      const user = await next.waitForUser();
      const remembered = getRememberedLogin();
      if (user && remembered?.email === user.email && remembered?.projectId === config.projectId) setMode('resume');
      else {
        if (user) await next.signOut();
        setMode('login');
      }
    } catch (cause) { setMode('configuration-error'); setError(`Firebase bağlantısı kurulamadı: ${cause.message}`); }
  }

  async function activate(next) {
    await next.ensureProfile();
    profileStop.current?.();
    profileStop.current = next.watchProfile(value => {
      setProfile(value);
      setStore(next.store(value));
      setTab(current => value?.admin || canSee(value, current) ? current : MENU_KEYS.find(key => canSee(value, key)) || 'waiting');
      setMode('firebase');
    }, cause => setError(cause.message || 'Yetkiler okunamadı.'));
  }

  async function authenticate(email, password, register, remember) {
    setError('');
    try {
      if (register) await session.register(email, password, remember);
      else await session.signIn(email, password, remember);
      if (remember) saveRememberedLogin(session.currentUser().email, session.projectId);
      else clearRememberedLogin();
      await activate(session);
    } catch (cause) { setError(`Giriş yapılamadı: ${cause.message}`); }
  }

  async function resumeSession() {
    setError(''); setMode('loading');
    try { await activate(session); }
    catch (cause) { setError(`Giriş yapılamadı: ${cause.message}`); setMode('resume'); }
  }

  async function logout() {
    profileStop.current?.();
    profileStop.current = null;
    setStore(null); setProfile(null); setUsers([]);
    setData({ employees: [], entries: [], cards: [], inventory: [], settings: DEFAULT_SETTINGS });
    clearRememberedLogin();
    try { await session?.signOut(); } catch { /* oturum zaten kapalı */ }
    setError(''); setTab('dashboard'); setMode('login');
  }

  // İşten çıkış tarihi bugün veya geçmişse ve personelde kart varsa kart iadesi sorulur.
  function offerCardReturn(employee) {
    const card = (data.cards || []).find(item => item.employeeId === employee.id);
    if (card && canSee(profile, 'cards') && isEmployeeLeaving(employee, today)) setCardReturn({ employee, cardUid: card.cardUid });
  }
  function notify(value) { setMessage(value); setTimeout(() => setMessage(''), 4000); }
  async function run(action, success) {
    setError('');
    try { await action(); if (success) notify(success); return true; }
    catch (cause) { setError(cause.message || 'İşlem tamamlanamadı.'); return false; }
  }

  async function importLegacyData() {
    const legacy = getLegacyData();
    if (!legacy) return;
    for (const employee of legacy.employees) await store.saveEmployee(employee);
    for (const entry of legacy.entries) {
      const clean = Object.fromEntries(['id', 'employeeId', 'date', 'status', 'start', 'end'].filter(key => entry[key] !== undefined).map(key => [key, entry[key]]));
      await store.saveEntry({ ...clean, rate: entry.rate === undefined || entry.rate === '' ? null : Number(entry.rate) });
    }
    clearLegacyData();
  }

  const days = useMemo(() => monthDays(month), [month]);
  const periodEnd = days.at(-1).date;
  const periodSettings = useMemo(() => resolveSettings(data.settings, periodEnd), [data.settings, periodEnd]);
  const daySettings = useMemo(() => Object.fromEntries(days.map(day => [day.date, resolveSettings(data.settings, day.date)])), [days, data.settings]);
  const visibleEmployees = useMemo(() => [...data.employees].sort((a, b) => a.name.localeCompare(b.name, 'tr')), [data.employees]);
  const currentEmployeePay = useMemo(() => Object.fromEntries(data.employees.map(item => [item.id, employeeSalaryForMonth(item, today.slice(0, 7))])), [data.employees, today]);
  const activeEmployees = visibleEmployees.filter(item => item.active !== false && item.startDate <= today && (!item.endDate || item.endDate >= today));
  const periodEmployees = visibleEmployees.filter(item => item.startDate <= periodEnd && (!item.endDate || item.endDate >= `${month}-01`));
  const filteredEmployees = visibleEmployees.filter(item => item.name.toLocaleLowerCase('tr-TR').includes(search.toLocaleLowerCase('tr-TR')));
  const filteredPeriodEmployees = periodEmployees.filter(item => item.name.toLocaleLowerCase('tr-TR').includes(search.toLocaleLowerCase('tr-TR')));
  const reports = useMemo(() => periodEmployees.map(item => calculateMonth(item, data.entries, month, periodEnd, data.settings)), [data.employees, data.entries, month, periodEnd, data.settings]);
  const totals = reports.reduce((acc, row) => {
    for (const key of ['bank', 'bankNet', 'bankDeduction', 'baseExtra', 'overtimeGross', 'missingValue', 'carryIn', 'carryOut', 'extraDeduction', 'overtimeDeduction', 'unpaidDeduction', 'extraNet', 'overtimeNet', 'totalNet', 'workedMinutes', 'missingMinutes']) acc[key] = money((acc[key] || 0) + row[key]);
    return acc;
  }, {});
  const selected = reports.find(row => row.employeeId === selectedReport);
  const canEditRates = canEditEntryRates(profile);
  const [showPending, setShowPending] = useState(false);
  // Mesaisi bulunan fakat saatlik ücreti henüz kayda sabitlenmemiş kayıtlar (tüm aylar).
  const pendingRates = useMemo(() => data.entries.flatMap(entry => {
    if (entry.status !== 'present' || !(entry.rate === null || entry.rate === undefined || entry.rate === '')) return [];
    const employee = data.employees.find(item => item.id === entry.employeeId);
    if (!employee) return [];
    const rules = resolveSettings(data.settings, entry.date);
    const offDay = !rules.workdays.includes(new Date(`${entry.date}T12:00:00`).getDay());
    try {
      const overtimeMinutes = calculateDay(entry, !offDay, rules).overtimeMinutes;
      return overtimeMinutes > 0 ? [{ entry, employee, minutes: overtimeMinutes, offDay }] : [];
    } catch { return []; }
  }).sort((a, b) => a.entry.date.localeCompare(b.entry.date) || a.employee.name.localeCompare(b.employee.name, 'tr')), [data.entries, data.employees, data.settings]);
  async function applyRateToPending(rate) {
    const value = Number(rate);
    if (!Number.isFinite(value) || value < 0) throw new Error('Geçerli bir mesai ücreti girin.');
    if (!(await askConfirm({ eyebrow: 'MESAİ ÜCRETİ', title: 'Ücret yazılsın mı?', message: `${pendingRates.length} mesai kaydına saatlik ${currency(value)} ücret yazılacak.`, confirmText: 'Ücreti Yaz' }))) return;
    for (const { entry } of pendingRates) await store.saveEntry({ ...entry, rate: value });
  }
  const pendingPanel = canSee(profile, 'timesheet') && pendingRates.length > 0 && <PendingRates items={pendingRates} open={showPending} onToggle={() => setShowPending(value => !value)} canEdit={canEditRates} onEdit={({ entry, offDay }) => setEntryModal({ ...entry, offDay, status: 'present', rate: null })} onApplyAll={rate => run(() => applyRateToPending(rate), 'Mesai ücretleri kaydedildi.')} />;

  function changeMonth(delta) {
    const [year, value] = month.split('-').map(Number);
    const date = new Date(year, value - 1 + delta, 1);
    const next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    setMonth(next);
    setSelectedDay(today.startsWith(next) ? today : `${next}-01`);
  }

  function dayCell(item, day) {
    const entry = data.entries.find(record => record.employeeId === item.id && record.date === day.date);
    // Kart okutulmuş ama çıkış henüz okutulmamış gün: bugün "İçeride", geçmiş günde "Çıkış yok".
    const clockIn = entry ? null : (data.clockIns || []).find(record => record.employeeId === item.id && record.date === day.date) || null;
    const rules = daySettings[day.date] || resolveSettings(data.settings, day.date);
    const offDay = !rules.workdays.includes(day.weekday);
    const inactive = day.date < item.startDate || (item.endDate && day.date > item.endDate);
    const offEntry = offDay && entry?.status === 'present' ? entry : null;
    const shownEntry = offDay ? offEntry : entry;
    let calc = null;
    try { calc = shownEntry ? calculateDay(shownEntry, !offDay, rules) : null; } catch { calc = null; }
    const ratePending = !!shownEntry && shownEntry.status === 'present' && calc?.overtimeMinutes > 0
      && (shownEntry.rate === null || shownEntry.rate === undefined || shownEntry.rate === '' || !Number.isFinite(Number(shownEntry.rate)));
    const initialRate = initialEntryRate({ existingEntry: shownEntry, offDay, canEditRates, employeeRate: item.overtimeRate, defaultRate: rules.overtimeRate });
    const cellClass = !shownEntry ? (clockIn ? 'pending' : 'unentered') : ratePending ? 'pending' : !calc ? 'short' : calc.overtimeMinutes ? 'overtime' : calc.missingMinutes ? 'short' : 'complete';
    const open = () => setEntryModal({ id: shownEntry?.id || `${item.id}_${day.date}`, employeeId: item.id, date: day.date, offDay, status: offDay ? 'present' : entry?.status || 'present', start: shownEntry?.start || clockIn?.start || rules.startTime, end: shownEntry?.end || rules.endTime, rate: initialRate, ...(shownEntry?.cardUid ? { cardUid: shownEntry.cardUid } : {}) });
    // Wi-Fi okuyucu internetsizken kaydedip sonradan gönderdiyse (0.4.0) hücrede işaret görünür.
    const offline = shownEntry ? shownEntry.source === 'offline' : clockIn?.source === 'offline';
    const label = !offDay && entry?.status === 'absent' ? 'Devamsız' : !offDay && entry?.status === 'leave' ? 'Ücretli izin' : shownEntry ? `${shownEntry.start} – ${ratePending ? 'Ücret?' : shownEntry.end}` : clockIn ? `${clockIn.start} – ${clockInNote(clockIn, today)}` : offDay ? 'Tatil' : 'Kayıt yok';
    return { entry, rules, offDay, inactive, shownEntry, clockIn, calc, ratePending, cellClass, open, label, offline };
  }

  async function exportXlsx() {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Open Attendance Terminal';
    const summary = workbook.addWorksheet('Maaş Özeti', { views: [{ state: 'frozen', ySplit: 3 }] });
    summary.mergeCells('A1:V1');
    summary.getCell('A1').value = `AÇIK PERSONEL TAKİP — ${formatMonthTr(month).toLocaleUpperCase('tr-TR')} MAAŞ RAPORU`;
    summary.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    summary.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF152033' } };
    summary.getRow(1).height = 34;
    summary.addRow([]);
    summary.addRow(['Personel', 'Kayıtlı Şirket', 'Anlaşılan Aylık Maaş', 'Ücret Günü', 'Hak Edilen Maaş', 'Banka Brüt', 'Banka Kesintisi', 'Ödenecek Banka', 'Normal Ek Hakediş', 'Mesai Saati (yuvarlanmış)', 'Mesai Brüt', 'Çalışılan Saat', 'Eksik Saat', 'Eksik Saat Tutarı', 'Önceki Aydan Devreden', 'Ek Hakediş Kesintisi', 'Mesai Kesintisi', 'Karşılanamayan Kesinti', 'Sonraki Aya Devreden', 'Ödenecek Ek Hakediş', 'Ödenecek Mesai', 'Toplam Ödeme']);
    reports.forEach(row => summary.addRow([safeSpreadsheetText(row.name), safeSpreadsheetText(row.company || ''), row.salary, row.payableDays, row.earnedSalary, row.bank, row.bankDeduction, row.bankNet, row.baseExtra, hours(row.overtimeMinutes), row.overtimeGross, hours(row.workedMinutes), hours(row.missingMinutes), row.missingValue, row.carryIn, row.extraDeduction, row.overtimeDeduction, row.unpaidDeduction, row.carryOut, row.extraNet, row.overtimeNet, row.totalNet]));
    summary.getRow(3).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    summary.getRow(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF273B55' } };
    summary.columns.forEach((column, index) => { column.width = index < 2 ? 27 : 19; });
    for (let row = 4; row <= summary.rowCount; row++) for (let col = 3; col <= 22; col++) summary.getRow(row).getCell(col).numFmt = col === 4 ? '0' : '#,##0.00';
    const detail = workbook.addWorksheet('Günlük Döküm', { views: [{ state: 'frozen', ySplit: 1 }] });
    detail.addRow(['Personel', 'Kayıtlı Şirket', 'Tarih', 'Durum', 'Giriş', 'Çıkış', 'Çalışılan Saat', 'Normal Saat', 'Mesai Saati (yuvarlanmış)', 'Eksik Saat', 'Mesai Saat Ücreti']);
    detail.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    detail.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF273B55' } };
    for (const row of reports) for (const day of row.days) detail.addRow([safeSpreadsheetText(row.name), safeSpreadsheetText(row.company || ''), formatDateTr(day.date), day.offDay ? 'Tatil günü çalıştı' : statusText(day.status), day.entry?.start || '', day.entry?.end || '', hours(day.workedMinutes), hours(day.normalMinutes), hours(day.overtimeMinutes), hours(day.missingMinutes), day.ratePending ? 'Ücret girilmedi' : day.rate]);
    detail.columns.forEach((column, index) => { column.width = index < 2 ? 27 : 19; });
    const buffer = await workbook.xlsx.writeBuffer();
    const bytes = Array.from(new Uint8Array(buffer));
    const filename = `Personel-Maas-Raporu-${formatMonthTr(month)}.xlsx`;
    if (window.desktop?.saveXlsx) {
      const saved = await window.desktop.saveXlsx(filename, bytes);
      if (!saved) return;
    }
    else {
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    notify('XLSX raporu hazırlandı.');
  }

  async function exportDailyXlsx() {
    const rows = dailyAttendanceRows(data.employees, data.entries, selectedDay, data.settings);
    if (!rows.length) throw new Error('Seçilen gün için dışa aktarılacak personel bulunamadı.');
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Open Attendance Terminal';
    const sheet = workbook.addWorksheet('Günlük Giriş Çıkış', { views: [{ state: 'frozen', ySplit: 3 }] });
    sheet.mergeCells('A1:J1');
    sheet.getCell('A1').value = `AÇIK PERSONEL TAKİP — ${formatDateTr(selectedDay)} GİRİŞ ÇIKIŞ RAPORU`;
    sheet.getCell('A1').font = { bold: true, size: 15, color: { argb: 'FFFFFFFF' } };
    sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF152033' } };
    sheet.addRow([]);
    sheet.addRow(['Personel', 'Kayıtlı Şirket', 'Tarih', 'Durum', 'Giriş', 'Çıkış', 'Çalışılan Saat', 'Normal Saat', 'Mesai Saati', 'Eksik Saat']);
    for (const row of rows) sheet.addRow([safeSpreadsheetText(row.employee), safeSpreadsheetText(row.company), formatDateTr(row.date), row.status, row.start, row.end, hours(row.workedMinutes), hours(row.normalMinutes), hours(row.overtimeMinutes), hours(row.missingMinutes)]);
    sheet.getRow(3).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF273B55' } };
    sheet.columns.forEach((column, index) => { column.width = index < 2 ? 27 : index < 6 ? 17 : 16; });
    for (let row = 4; row <= sheet.rowCount; row++) for (let col = 7; col <= 10; col++) sheet.getRow(row).getCell(col).numFmt = '0.00';
    const buffer = await workbook.xlsx.writeBuffer();
    const bytes = Array.from(new Uint8Array(buffer));
    const filename = `Personel-Gunluk-Giris-Cikis-${formatDateTr(selectedDay)}.xlsx`;
    if (window.desktop?.saveXlsx) {
      const saved = await window.desktop.saveXlsx(filename, bytes);
      if (!saved) return;
    } else {
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    notify('Günlük giriş-çıkış Excel dosyası hazırlandı.');
  }

  if (mode === 'loading') return <div className="loading">Personel Takip açılıyor…</div>;
  if (mode === 'configuration-error') return <div className="auth-screen"><div className="auth-card"><h1>Firebase bağlantısı kurulamadı</h1><p>{error}</p><button className="secondary wide" onClick={() => connect(embeddedFirebaseConfig)}>Yeniden Dene</button></div></div>;
  if (mode === 'resume') return <Resume email={session?.currentUser()?.email} onContinue={resumeSession} onSwitch={logout} error={error} />;
  if (mode === 'login') return <Login onSubmit={authenticate} error={error} />;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><img className="app-mark" src={appLogo} alt="Uygulama logosu" /><div><strong>AÇIK PERSONEL TAKİP</strong><span>PERSONEL TAKİP</span></div></div>
      <div className="side-label">ÇALIŞMA ALANI</div>
      <nav>
        {canSee(profile, 'dashboard') && <NavButton icon={ChartNoAxesCombined} label="Genel Bakış" active={tab === 'dashboard'} onClick={() => setTab('dashboard')} />}
        {canSee(profile, 'employees') && <NavButton icon={Users} label="Personeller" active={tab === 'employees'} onClick={() => setTab('employees')} />}
        {canSee(profile, 'timesheet') && <NavButton icon={CalendarDays} label="Günlük Saatler" active={tab === 'timesheet'} onClick={() => setTab('timesheet')} />}
        {canSee(profile, 'cards') && <NavButton icon={CreditCard} label="Kart Atama" active={tab === 'cards'} onClick={() => setTab('cards')} />}
        {canSee(profile, 'terminal') && <NavButton icon={ScanLine} label="Kart Okutma" active={tab === 'terminal'} onClick={() => setTab('terminal')} />}
        {canSee(profile, 'reports') && <NavButton icon={ChartNoAxesCombined} label="Maaş Raporu" active={tab === 'reports'} onClick={() => setTab('reports')} />}
      </nav>
      <div className="sidebar-bottom">
        {profile?.admin && <NavButton icon={Shield} label="Admin" active={tab === 'admin'} onClick={() => setTab('admin')} />}
        {canSee(profile, 'settings') && <NavButton icon={Settings} label="Ayarlar" active={tab === 'settings'} onClick={() => setTab('settings')} />}
        <div className="connection cloud"><Cloud size={16} /><div><strong>Firebase bağlı</strong><small>{session?.currentUser()?.email}</small></div></div>
        <button className="sidebar-logout" onClick={logout}><LogOut size={15} /> Çıkış Yap</button>
        <div className="app-version">Sürüm {APP_VERSION}</div>
      </div>
    </aside>
    <nav className="mobile-nav" aria-label="Menü">
      {[['dashboard', ChartNoAxesCombined, 'Özet'], ['timesheet', CalendarDays, 'Puantaj'], ['employees', Users, 'Personel'], ['cards', CreditCard, 'Kart'], ['terminal', ScanLine, 'Okutma'], ['reports', Download, 'Rapor'], ['admin', Shield, 'Admin'], ['settings', Settings, 'Ayarlar']]
        .filter(([key]) => key === 'admin' ? profile?.admin : canSee(profile, key))
        .map(([key, Icon, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon size={20} /><span>{label}</span></button>)}
    </nav>
    <main className="main">
      <header className="topbar"><img className="mobile-mark" src={appLogo} alt="" /><div className="breadcrumb"><span className="breadcrumb-company">AÇIK PERSONEL TAKİP <span>/</span> </span>{TAB_LABELS[tab]}</div><div className="topbar-right"><button className="icon-button mobile-logout" aria-label="Çıkış yap" title="Çıkış yap" onClick={logout}><LogOut size={19} /></button><img className="company-logo" src={companyLogo} alt="Open Attendance" /><span className="today">{formatDateTr(today)}</span></div></header>
      <div className="content">
        {error && <div className="error-banner"><AlertCircle size={18} />{error}<button onClick={() => setError('')}><X size={16} /></button></div>}
        {message && <div className="toast"><Check size={17} />{message}</div>}
        <ConfirmHost />
        <InstallHint />
        {tab === 'waiting' && <section className="panel waiting"><Shield size={34} /><h1>Yetki bekleniyor</h1><p>Hesabınız oluşturuldu. Admin menü erişimlerinizi tanımladığında ekranlar otomatik açılacak.</p><strong>{session?.currentUser()?.email}</strong></section>}
        {tab === 'dashboard' && canSee(profile, 'dashboard') && <>
          <PageHeading eyebrow="AYLIK ÖZET" title="Genel Bakış" description={`${formatMonthTr(month)} dönemi için personel ve çalışma özeti.`} action={<MonthSwitcher month={month} onChange={changeMonth} />} />
          <div className="stat-grid">
            <Stat icon={Users} label="Aktif Personel" value={activeEmployees.length} note="Bugün kayıtlı çalışan" />
            <Stat icon={Clock3} label="Çalışılan Saat" value={`${number(hours(totals.workedMinutes))} sa`} note="Girilen puantajlara göre" />
            <Stat icon={CalendarDays} label="Eksik Saat" value={`${number(hours(totals.missingMinutes))} sa`} note="Kesinti hesaplamasına dahil" tone="amber" />
            <Stat icon={ChartNoAxesCombined} label="Toplam Ödeme" value={currency(totals.totalNet)} note="Banka + ek hakediş + mesai" tone="green" />
          </div>
          <div className="two-column"><section className="panel"><div className="panel-head"><div><h2>Bu ayki ödemeler</h2><p>Personel bazında özet</p></div>{canSee(profile, 'reports') && <button className="text-button" onClick={() => setTab('reports')}>Raporu aç →</button>}</div>{reports.length ? <div className="mini-list">{reports.slice(0, 8).map(row => <div className="mini-row" key={row.employeeId}><div className="person-avatar">{row.name.slice(0, 1).toUpperCase()}</div><div className="mini-name"><strong>{row.name}</strong><span>{row.unenteredDays} gün giriş bekliyor</span></div><strong>{currency(row.totalNet)}</strong></div>)}</div> : <Empty text="Henüz personel eklenmedi." action={canSee(profile, 'employees') && <button className="primary" onClick={() => setTab('employees')}>Personel ekle</button>} />}</section><RulesSummary settings={periodSettings} /></div>
        </>}
        {tab === 'employees' && canSee(profile, 'employees') && <><PageHeading eyebrow="PERSONEL YÖNETİMİ" title="Personeller" description="Maaş bilgileri ve çalışan kayıtları." action={<button className="primary" onClick={() => setEmployeeModal({ id: makeId(), name: '', company: '', startDate: `${month}-01`, endDate: '', salary: '', bank: '', active: true })}><Plus size={17} /> Personel Ekle</button>} /><div className="panel"><div className="table-toolbar"><div className="search"><Search size={17} /><input placeholder="Personel ara..." value={search} onChange={event => setSearch(event.target.value)} /></div><span>{filteredEmployees.length} personel</span></div><div className="table-wrap"><table className="data-table"><thead><tr><th>PERSONEL</th><th>KAYITLI ŞİRKET</th><th>İŞE GİRİŞ</th><th>İŞTEN ÇIKIŞ</th><th>DURUM</th><th>TOPLAM MAAŞ</th><th>BANKA</th><th>EK HAKEDİŞ</th><th>MESAİ TARİFESİ</th><th></th></tr></thead><tbody>{filteredEmployees.map(item => <tr key={item.id} className="clickable-row" onClick={() => setEmployeeModal({ ...item })}><td><div className="employee-name"><div className="person-avatar">{item.name.slice(0, 1).toUpperCase()}</div><strong>{item.name}</strong></div></td><td>{item.company || '—'}</td><td>{formatDateTr(item.startDate) || '—'}</td><td>{formatDateTr(item.endDate) || '—'}</td><td><span className={`employee-status ${item.active === false || (item.endDate && item.endDate < today) ? 'inactive' : 'active'}`}>{item.active === false || (item.endDate && item.endDate < today) ? 'Pasif' : item.startDate > today ? 'Planlandı' : 'Aktif'}</span></td><td className="numeric">{currency(currentEmployeePay[item.id]?.salary)}</td><td className="numeric">{currency(currentEmployeePay[item.id]?.bank)}</td><td className="numeric emphasis">{currency(Math.max(0, currentEmployeePay[item.id]?.salary - currentEmployeePay[item.id]?.bank))}</td><td>{item.overtimeRate != null ? currency(item.overtimeRate) : 'Genel tarife'}</td><td><button className="icon-button" title="Düzenle" onClick={event => { event.stopPropagation(); setEmployeeModal({ ...item }); }}><Pencil size={16} /></button></td></tr>)}</tbody></table></div>{!filteredEmployees.length && <Empty text="Personel bulunamadı." />}</div></>}
        {tab === 'terminal' && canSee(profile, 'terminal') && <TerminalPage store={store} notify={notify} />}
        {tab === 'cards' && canSee(profile, 'cards') && <CardAssignmentsPage employees={visibleEmployees} cards={data.cards || []} inventory={data.inventory || []} today={today} store={store} run={run} notify={notify} onReturnRequest={setCardReturn} />}
        {tab === 'timesheet' && pendingPanel}
        {tab === 'timesheet' && canSee(profile, 'timesheet') && isMobile && <MobileTimesheet date={selectedDay.startsWith(month) ? selectedDay : `${month}-01`} onChangeDay={delta => { const next = shiftDate(selectedDay.startsWith(month) ? selectedDay : `${month}-01`, delta); setSelectedDay(next); setMonth(next.slice(0, 7)); }} onToday={() => { setSelectedDay(today); setMonth(today.slice(0, 7)); }} onExport={() => run(exportDailyXlsx)} employees={visibleEmployees.filter(item => item.name.toLocaleLowerCase('tr-TR').includes(search.toLocaleLowerCase('tr-TR')))} search={search} onSearch={setSearch} dayCell={dayCell} />}
        {tab === 'timesheet' && canSee(profile, 'timesheet') && !isMobile && <><PageHeading eyebrow="PUANTAJ" title="Günlük Saatler" description="Seçilen ayın geçmiş ve gelecek günlerine kayıt girebilirsiniz. Personelin işe giriş ve çıkış tarihleri geçerlidir." action={<div className="action-row daily-export-actions"><MonthSwitcher month={month} onChange={changeMonth} /><input aria-label="Günlük Excel tarihi" type="date" required value={selectedDay} onChange={event => { if (!formatDateTr(event.target.value)) return; setSelectedDay(event.target.value); setMonth(event.target.value.slice(0, 7)); }} /><button className="primary" onClick={() => run(exportDailyXlsx)}><Download size={17} /> Günlük Excel</button></div>} /><div className="legend"><span><i className="dot green" /> Tam gün</span><span><i className="dot amber" /> Eksik saat</span><span><i className="dot blue" /> Mesai</span><span><i className="dot gray" /> Kayıt bekliyor</span><span><i className="dot amber" /> Kart okutuldu, çıkış yok</span><span><i className="dot offline" /> Çevrimdışı okutma</span><span><i className="dot amber" /> Tatil günü: tamamı mesai</span></div><div className="panel timesheet-panel"><div className="timesheet-scroll"><table className="timesheet"><thead><tr><th className="sticky-col">PERSONEL</th>{days.map(day => <th key={day.date} className={!daySettings[day.date].workdays.includes(day.weekday) ? 'sunday' : ''}><span>{dayLabel(day.weekday)}</span><strong>{day.day}</strong></th>)}</tr></thead><tbody>{filteredPeriodEmployees.map(item => <tr key={item.id}><th className="sticky-col"><div className="grid-person"><div className="person-avatar">{item.name.slice(0, 1).toUpperCase()}</div><span>{item.name}</span></div></th>{days.map(day => {
          const { entry, offDay, inactive, shownEntry, clockIn, ratePending, cellClass, open, offline } = dayCell(item, day);
          return <td key={day.date} className={inactive ? 'disabled-cell' : offDay ? 'offday-cell' : ''}>{inactive ? <span className="off-cell">{offDay ? 'Tatil' : '—'}</span> : <button className={`time-cell ${cellClass}${offDay ? ' offday' : ''}${offline ? ' offline-scan' : ''}`} title={offline ? OFFLINE_SCAN_TITLE : clockIn && !shownEntry ? `Kart okutuldu (${clockIn.start}); çıkış okutulmadı` : ratePending ? 'Bu güne özel mesai ücreti girilmedi' : offDay ? 'Tatil günü: çalışılan sürenin tamamı mesai' : undefined} onClick={open}>{!offDay && entry?.status === 'absent' ? <span className="cell-status">Devamsız</span> : !offDay && entry?.status === 'leave' ? <span className="cell-status">Ücretli izin</span> : shownEntry ? <><strong>{shownEntry.start}</strong><span>{ratePending ? 'Ücret?' : shownEntry.end}</span></> : clockIn ? <><strong>{clockIn.start}</strong><span>{clockInNote(clockIn, today)}</span></> : offDay ? <span className="cell-status">Tatil</span> : <Plus size={15} />}{offline && <i className="offline-mark" aria-label="Çevrimdışı okutma" />}</button>}</td>;
        })}</tr>)}</tbody></table></div>{!filteredPeriodEmployees.length && <Empty text="Bu ay için personel bulunamadı." />}</div></>}
        {tab === 'reports' && canSee(profile, 'reports') && <ReportsPage onShowPending={canSee(profile, 'timesheet') ? () => { setShowPending(true); setTab('timesheet'); } : null} month={month} onChangeMonth={changeMonth} reports={reports} totals={totals} selected={selected} selectedReport={selectedReport} onSelect={setSelectedReport} onExport={() => run(exportXlsx)} />}
        {tab === 'admin' && profile?.admin && <AdminPage users={users} firebaseConfig={SANDBOX ? SANDBOX_CONFIG : embeddedFirebaseConfig} onSave={(uid, menus) => run(() => session.setUserMenus(uid, menus), 'Kullanıcı yetkileri kaydedildi.')} />}
        {tab === 'settings' && canSee(profile, 'settings') && <SettingsPage settings={data.settings} employees={data.employees} email={session?.currentUser()?.email} legacyCount={profile?.admin ? (getLegacyData()?.employees.length || 0) + (getLegacyData()?.entries.length || 0) : 0} onImportLegacy={() => run(importLegacyData, 'Eski yerel kayıtlar Firebase’e aktarıldı.')} onSave={(effectiveDate, rules) => run(async () => { validateRules(rules); await store.saveSettingsRevision(effectiveDate, rules); }, 'Hesaplama kuralları kaydedildi.')} onSaveCompany={(oldName, name) => run(() => store.saveCompany(oldName, name), oldName ? 'Şirket adı güncellendi.' : 'Şirket eklendi.')} onDeleteCompany={name => run(() => store.deleteCompany(name), 'Şirket listeden kaldırıldı.')} />}
      </div>
    </main>
    {employeeModal && <EmployeeModal value={employeeModal} selectedMonth={month} companies={data.settings.companies || []} canDelete={canSee(profile, 'employees') && canSee(profile, 'deleteEmployee')} onClose={() => setEmployeeModal(null)} onSave={value => run(async () => { await store.saveEmployee(value); setEmployeeModal(null); offerCardReturn(value); }, 'Personel kaydedildi.')} onDelete={async () => { if (canSee(profile, 'employees') && canSee(profile, 'deleteEmployee') && await askConfirm({ eyebrow: 'PERSONEL SİLME', title: `${employeeModal.name} silinsin mi?`, message: 'Personel ve tüm puantaj kayıtları kalıcı olarak silinir. Bu işlem geri alınamaz.', confirmText: 'Personeli Sil', danger: true })) run(async () => { await store.deleteEmployee(employeeModal.id); setEmployeeModal(null); }, 'Personel silindi.'); }} />}
    {entryModal && <EntryModal value={entryModal} canEditRate={canEditRates} settings={daySettings[entryModal.date] || resolveSettings(data.settings, entryModal.date)} employee={data.employees.find(item => item.id === entryModal.employeeId)} onClose={() => setEntryModal(null)} onSave={value => run(async () => { await store.saveEntry(value); setEntryModal(null); }, 'Günlük kayıt kaydedildi.')} onDelete={() => run(async () => { await store.deleteEntry(entryModal.id); setEntryModal(null); }, 'Günlük kayıt silindi.')} exists={data.entries.some(item => item.id === entryModal.id)} />}
    {cardReturn && <CardReturnModal value={cardReturn} label={(data.inventory || []).find(item => item.cardUid === cardReturn.cardUid)?.label} onClose={() => setCardReturn(null)}
      onReturned={() => run(async () => { await store.removeCard(cardReturn.employee.id, cardReturn.employee.name, false); setCardReturn(null); }, 'Kart teslim alındı; artık boşta.')}
      onLost={() => run(async () => { await store.removeCard(cardReturn.employee.id, cardReturn.employee.name, true); setCardReturn(null); }, 'Kart kayıp olarak işaretlendi.')} />}
  </div>;
}

const OFFLINE_SCAN_TITLE = 'Çevrimdışı okutma: Wi-Fi kart okuyucu internetsizken kaydetti, bağlantı gelince gönderdi. Saat okutma anının saatidir.';
function clockInNote(clockIn, today) { return clockIn.date === today ? 'İçeride' : 'Çıkış yok'; }
function statusText(value) { return ({ present: 'Çalıştı', absent: 'Devamsız', leave: 'Ücretli izin', unentered: 'Kayıt yok' })[value] || value; }
function NavButton({ icon: Icon, label, active, onClick }) { return <button className={`nav-button ${active ? 'active' : ''}`} onClick={onClick}><Icon size={19} /><span>{label}</span></button>; }
function PageHeading({ eyebrow, title, description, action }) { return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>; }
function MonthSwitcher({ month, onChange }) { return <div className="month-switcher"><button onClick={() => onChange(-1)}><ChevronLeft size={18} /></button><strong>{formatMonthTr(month)}</strong><button onClick={() => onChange(1)}><ChevronRight size={18} /></button></div>; }
function Stat({ icon: Icon, label, value, note, tone = '' }) { return <div className={`stat ${tone}`}><div className="stat-top"><span>{label}</span>{Icon && <div className="stat-icon"><Icon size={20} /></div>}</div><strong>{value}</strong>{note && <small>{note}</small>}</div>; }
function Rule({ label, value }) { return <div className="rule"><span>{label}</span><strong>{value}</strong></div>; }
function Empty({ text, action }) { return <div className="empty"><div className="empty-icon"><Users size={25} /></div><strong>{text}</strong>{action}</div>; }

function RulesSummary({ settings }) {
  return <section className="panel tips"><div className="panel-head"><div><h2>Hesaplama kuralları</h2><p>Seçilen ayın şirket ayarları</p></div></div>
    <Rule label="Çalışma günleri" value={settings.workdays.map(dayLabel).join(', ')} />
    <Rule label="Normal saat" value={`${settings.startTime} – ${settings.endTime}`} />
    <Rule label="Yemek molası" value={`${settings.breakMinutes} dakika`} />
    <Rule label="Günlük hedef" value={`${number(hours(settings.dailyTargetMinutes))} saat`} />
    <Rule label="Mesai saat ücreti" value={currency(settings.overtimeRate)} />
    <Rule label="Mesai yuvarlama" value={`${settings.overtimeRoundMinutes} dakika yukarı`} />
    <Rule label="Maaş günü" value={`${settings.salaryDays} gün`} />
    <Rule label="Kesinti sırası" value={settings.deductionOrder === 'overtime-first' ? 'Mesai → ek hakediş' : 'Ek hakediş → mesai'} />
    <Rule label="Banka kesintisi" value={settings.allowBankDeduction ? 'Gerektiğinde uygulanır' : 'Uygulanmaz'} />
    <Rule label="Kalan kesinti" value={settings.carryForward ? 'Sonraki aya devreder' : 'Bu ayda sıfırlanır'} />
  </section>;
}

function ReportsPage({ onShowPending, month, onChangeMonth, reports, totals, selected, selectedReport, onSelect, onExport }) {
  const toggle = id => onSelect(current => current === id ? null : id);
  return <>
    <PageHeading eyebrow="MAAŞ VE HAKEDİŞ" title="Maaş Raporu" description="Kesinti öncesi hakedişler, eksik çalışma ve ödenecek tutarlar." action={<div className="action-row"><MonthSwitcher month={month} onChange={onChangeMonth} /><button className="primary" onClick={onExport} disabled={!reports.length}><Download size={17} /> XLSX Dışa Aktar</button></div>} />
    {reports.some(row => row.pendingRateDays > 0) && <div className="notice"><AlertCircle size={18} /> {reports.reduce((sum, row) => sum + row.pendingRateDays, 0)} mesai kaydının ücreti girilmedi. Bu mesailer ücret girilene kadar ödemeye eklenmez; Günlük Saatler ekranından ücreti girin.{onShowPending && <button className="text-button" onClick={onShowPending}>Listeyi aç →</button>}</div>}
    {reports.some(row => row.unenteredDays > 0) && <div className="notice"><AlertCircle size={18} /> Bu ayda girişi yapılmamış çalışma günleri var. Boş günler otomatik devamsızlık sayılmaz; raporu tamamlamadan önce puantajı kontrol edin.</div>}
    <div className="report-stats"><Stat label="Ödenecek Banka" value={currency(totals.bankNet)} /><Stat label="Ek Hakediş Brüt" value={currency(totals.baseExtra)} /><Stat label="Mesai Brüt" value={currency(totals.overtimeGross)} /><Stat label="Eksik Çalışma Tutarı" value={currency(totals.missingValue)} tone="amber" /></div>
    <div className="panel"><div className="table-toolbar"><strong>Personel Bazında Döküm</strong><span>{reports.length} personel</span></div><div className="table-wrap"><table className="data-table report-table"><thead><tr><th>PERSONEL</th><th>KAYITLI ŞİRKET</th><th>HAK EDİLEN MAAŞ</th><th>BANKA BRÜT</th><th>BANKA KESİNTİ</th><th>ÖDENECEK BANKA</th><th>EK HAKEDİŞ</th><th>MESAİ BRÜT</th><th>ÇALIŞILAN</th><th>EKSİK</th><th>EKSİK TUTARI</th><th>DEVREDEN</th><th>EK KESİNTİ</th><th>MESAİ KESİNTİ</th><th>ÖDENECEK EK</th><th>ÖDENECEK MESAİ</th><th>TOPLAM</th></tr></thead>
      <tbody>{reports.map(row => <tr key={row.employeeId} onClick={() => toggle(row.employeeId)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(row.employeeId); } }} tabIndex={0} aria-expanded={selectedReport === row.employeeId} className="clickable-row"><td><strong>{row.name}</strong>{row.unenteredDays > 0 && <small>{row.unenteredDays} gün eksik kayıt</small>}{row.pendingRateDays > 0 && <small>{row.pendingRateDays} mesai kaydı ücreti bekliyor</small>}</td><td>{row.company || '—'}</td><td>{currency(row.earnedSalary)}</td><td>{currency(row.bank)}</td><td className="negative">{currency(row.bankDeduction)}</td><td>{currency(row.bankNet)}</td><td>{currency(row.baseExtra)}</td><td>{currency(row.overtimeGross)}</td><td>{number(hours(row.workedMinutes))} sa</td><td>{number(hours(row.missingMinutes))} sa</td><td className="negative">{currency(row.missingValue)}</td><td>{currency(row.carryIn)}</td><td className="negative">{currency(row.extraDeduction)}</td><td className="negative">{currency(row.overtimeDeduction)}</td><td>{currency(row.extraNet)}</td><td>{currency(row.overtimeNet)}</td><td className="emphasis">{currency(row.totalNet)}</td></tr>)}</tbody></table></div>{!reports.length && <Empty text="Rapor için personel ekleyin." />}</div>
    {selected && <div className="panel detail-panel"><div className="panel-head"><div><h2>{selected.name} — Kesinti Açıklaması</h2><p>Personel sorularında gösterilebilecek ayrıntılı döküm</p></div><button className="icon-button" onClick={() => onSelect(null)}><X size={18} /></button></div><div className="detail-grid">
      <Rule label="Kayıtlı şirket" value={selected.company || '—'} /><Rule label="Anlaşılan aylık maaş" value={currency(selected.salary)} /><Rule label="Bu ayın ücret günü" value={`${selected.payableDays} gün`} /><Rule label="Hak edilen maaş" value={currency(selected.earnedSalary)} /><Rule label="Normal ek hakediş" value={currency(selected.baseExtra)} /><Rule label="Hesaplanan mesai (yuvarlanmış)" value={`${number(hours(selected.overtimeMinutes))} sa · ${currency(selected.overtimeGross)}`} /><Rule label="Eksik çalışma" value={`${number(hours(selected.missingMinutes))} sa · ${currency(selected.missingValue)}`} />
      <Rule label="Önceki aydan devreden kesinti" value={currency(selected.carryIn)} /><Rule label="Ek hakedişten düşülen" value={currency(selected.extraDeduction)} /><Rule label="Mesaiden düşülen" value={currency(selected.overtimeDeduction)} /><Rule label="Bankadan düşülen" value={currency(selected.bankDeduction)} /><Rule label="Karşılanamayan kesinti" value={currency(selected.unpaidDeduction)} /><Rule label="Sonraki aya devreden" value={currency(selected.carryOut)} />
      <Rule label="Ödenecek ek hakediş" value={currency(selected.extraNet)} /><Rule label="Ödenecek mesai" value={currency(selected.overtimeNet)} /><Rule label="Banka brüt" value={currency(selected.bank)} /><Rule label="Ödenecek banka" value={currency(selected.bankNet)} /><Rule label="Toplam ödeme" value={currency(selected.totalNet)} />
    </div></div>}
  </>;
}

function Login({ onSubmit, error }) {
  const remembered = getRememberedLogin();
  const [email, setEmail] = useState(remembered?.email || ''); const [password, setPassword] = useState(''); const [register, setRegister] = useState(false);
  const [remember, setRemember] = useState(Boolean(remembered));
  return <div className="auth-screen"><div className="auth-card"><img className="login-company-logo" src={companyLogo} alt="Open Attendance" /><img className="login-app-logo" src={appLogo} alt="Uygulama logosu" /><h1>{register ? 'Hesap Oluştur' : 'Oturum Aç'}</h1><p>Personel ve maaş verilerinize güvenli erişim. <span className="login-version">Sürüm {APP_VERSION}</span></p>{error && <div className="form-error">{error}</div>}<form onSubmit={event => { event.preventDefault(); onSubmit(email, password, register, remember); }}><label>E-posta</label><input type="email" required value={email} onChange={event => setEmail(event.target.value)} /><label>Şifre</label><input type="password" minLength="6" required value={password} onChange={event => setPassword(event.target.value)} /><label className="remember-option"><input type="checkbox" checked={remember} onChange={event => setRemember(event.target.checked)} /><span>Beni hatırla <small>Bu cihazda sonraki açılışta tek tıkla giriş yap</small></span></label><button className="primary wide" type="submit">{register ? 'Hesap Oluştur' : 'Giriş Yap'}</button></form><button className="text-button" onClick={() => setRegister(!register)}>{register ? 'Zaten hesabım var' : 'Yeni hesap oluştur'}</button>{SANDBOX && <button className="secondary wide sandbox-login" onClick={() => onSubmit(SANDBOX_LOGIN.email, SANDBOX_LOGIN.password, false, false)}>Deneme hesabıyla gir</button>}<InstallHint /></div></div>;
}

function Resume({ email, onContinue, onSwitch, error }) {
  return <div className="auth-screen"><div className="auth-card"><img className="login-company-logo" src={companyLogo} alt="Open Attendance" /><img className="login-app-logo" src={appLogo} alt="Uygulama logosu" /><h1>Tekrar hoş geldiniz</h1><p>{email} hesabınız bu cihazda hatırlanıyor.</p>{error && <div className="form-error">{error}</div>}<button className="primary wide" onClick={onContinue}>Hesabıma Devam Et</button><button className="text-button" onClick={onSwitch}>Farklı hesapla giriş yap</button><InstallHint /></div></div>;
}

function PendingRates({ items, open, onToggle, canEdit, onEdit, onApplyAll }) {
  const [bulkRate, setBulkRate] = useState('');
  return <div className="panel pending-panel">
    <button className="pending-head" onClick={onToggle} aria-expanded={open}><AlertCircle size={18} /><span><strong>{items.length} mesai kaydının saatlik ücreti eksik</strong><small>Bu kayıtların mesaisi ücret girilene kadar ödemeye eklenmez.</small></span><b>{open ? 'Gizle' : 'Göster'}</b></button>
    {open && <>
      {canEdit ? <form className="pending-bulk" onSubmit={event => { event.preventDefault(); onApplyAll(bulkRate); }}><label>Hepsine aynı ücret (TL/saat)</label><input type="number" min="0" step="0.01" required value={bulkRate} onChange={event => setBulkRate(event.target.value)} placeholder="Ör. 200" /><button className="secondary" type="submit">Tümüne Uygula</button></form>
        : <p className="help-text pending-note">Ücreti girmek için Günlük Saatler yetkisine ek olarak Personeller veya Ayarlar yetkisi gerekir.</p>}
      <div className="pending-list">{items.map(item => <div className="pending-row" key={item.entry.id}>
        <div className="person-avatar">{item.employee.name.slice(0, 1).toUpperCase()}</div>
        <div className="pending-info"><strong>{item.employee.name}</strong><span>{formatDateTr(item.entry.date)}</span></div>
        <div className="pending-time"><strong>{item.entry.start} – {item.entry.end}</strong><span>{number(hours(item.minutes))} sa mesai</span></div>
        {canEdit && <button className="primary" onClick={() => onEdit(item)}>Ücret Gir</button>}
      </div>)}</div>
    </>}
  </div>;
}

const formatMonth = value => formatMonthTr(value) || value || '—';
function salaryRows(value, selectedMonth) {
  if (value.salaryHistory?.length) return [...value.salaryHistory].sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth)).map(item => ({ effectiveMonth: item.effectiveMonth, salary: item.salary, bank: item.bank }));
  const startMonth = (value.startDate || `${selectedMonth}-01`).slice(0, 7);
  if (value.salary !== '' && value.salary != null) return [{ effectiveMonth: startMonth, salary: Number(value.salary), bank: Number(value.bank) || 0 }];
  return [{ effectiveMonth: startMonth, salary: '', bank: '' }];
}
function describeSalaryChanges(before, after) {
  const key = item => item.effectiveMonth;
  const old = new Map(before.map(item => [key(item), item]));
  const next = new Map(after.map(item => [key(item), item]));
  const lines = [];
  for (const item of after) {
    const previous = old.get(key(item));
    if (!previous) lines.push(`${formatMonth(item.effectiveMonth)} ayından itibaren: ${currency(item.salary)} (banka ${currency(item.bank)})`);
    else if (Number(previous.salary) !== Number(item.salary) || Number(previous.bank) !== Number(item.bank)) lines.push(`${formatMonth(item.effectiveMonth)} kaydı: ${currency(previous.salary)} → ${currency(item.salary)} (banka ${currency(previous.bank)} → ${currency(item.bank)})`);
  }
  for (const item of before) if (!next.has(key(item))) lines.push(`${formatMonth(item.effectiveMonth)} kaydı silinecek`);
  return lines;
}

function CardAssignmentsPage({ employees, cards, inventory, today, store, run, notify, onReturnRequest }) {
  const [view, setView] = useState('assign');
  const [readerState, setReaderState] = useState('idle');
  const [scanLog, setScanLog] = useState([]);
  const reader = useRef(null);
  const latest = useRef({ inventory, cards, employees });
  latest.current = { inventory, cards, employees };
  const added = useRef([]);
  const queue = useRef(Promise.resolve());
  const labels = useMemo(() => new Map(inventory.map(item => [item.cardUid, item.label])), [inventory]);
  useEffect(() => () => { reader.current?.disconnect(); }, []);
  // Wi-Fi okuyucu (2.0) bu sayfa bağlıyken okutulan kartı giriş/çıkış olarak kaydetmez ("Kart Atama modu").
  // Komut birkaç saniyede bir yenilenir; sayfa kapanınca cihaz 15 sn içinde normal çalışmaya döner. Eski okuyucular yok sayar.
  useEffect(() => {
    if (readerState !== 'connected') return undefined;
    const hold = () => { reader.current?.sendFrame?.('assign').catch(() => {}); };
    hold();
    const timer = setInterval(hold, 8000);
    return () => clearInterval(timer);
  }, [readerState]);
  // Yeni eklenen kart listeye yansıyınca geçici kayıttan çıkarılır; böylece sonradan silinen kart tekrar okutulabilir.
  useEffect(() => { added.current = added.current.filter(item => !inventory.some(card => card.cardUid === item.cardUid)); }, [inventory]);
  const log = (tone, text) => setScanLog(list => [{ id: makeId(), tone, text }, ...list].slice(0, 8));
  const beepError = async () => { try { await reader.current?.beepError(); } catch { /* ses verilemese de okuma sürer */ } };
  // Ekranlı okuyucuya kısa bilgi gönderir; eski okuyucular bu satırı görmezden gelir.
  const show = async (kind, lines) => { try { await reader.current?.display(kind, lines); } catch { /* ekran yoksa okuma sürer */ } };

  // Okutulan kart listede yoksa sıradaki numarayla eklenir; varsa durumu gösterilir.
  // Bir okutmada hata olsa bile sıradaki okutmalar işlenmeye devam eder.
  function handleScan(cardUid) {
    queue.current = queue.current.then(async () => {
      const { inventory: list, cards: mappings, employees: people } = latest.current;
      const known = list.find(item => item.cardUid === cardUid) || added.current.find(item => item.cardUid === cardUid);
      if (known) {
        const holder = mappings.find(item => item.cardUid === cardUid);
        const name = holder && people.find(item => item.id === holder.employeeId)?.name;
        log('info', `Kart ${known.label} zaten kayıtlı · ${holder ? `${name || 'bir personelde'}` : known.lost ? 'Kayıp' : 'Boşta'}`);
        await show('info', [`KART ${known.label}`, holder ? name || 'BİR PERSONELDE' : known.lost ? 'KAYIP' : 'BOŞTA', 'ZATEN KAYITLI']);
        await beepError();
        return;
      }
      try {
        const record = await store.addInventoryCard(cardUid, nextCardLabel([...list, ...added.current]));
        added.current.push(record);
        log('ok', `Kart ${record.label} eklendi · ${cardUid}`);
        await show('ok', [`KART ${record.label}`, 'LİSTEYE EKLENDİ']);
      } catch (cause) {
        log('error', cause?.message || 'Kart eklenemedi.');
        await show('err', ['KART EKLENEMEDİ', 'TEKRAR DENEYİN']);
        await beepError();
      }
    }).catch(cause => log('error', cause?.message || 'Kart okutması işlenemedi.'));
  }
  async function connect() {
    setReaderState('connecting');
    try {
      reader.current = await connectCardReader({
        onCard: handleScan,
        onStatus: state => { if (state === 'disconnected') { reader.current = null; setReaderState('idle'); } },
        onError: cause => log('error', cause.message),
      });
      setReaderState('connected');
      notify('Kart okuyucu bağlandı. Kartları sırayla okutun.');
    } catch (cause) {
      reader.current = null;
      setReaderState('idle');
      if (cause?.message) log('error', cause.message);
    }
  }
  const readerPanel = <div className="panel card-reader-panel">
    <div className="card-reader-head">
      <div className={`reader-dot ${readerState === 'connected' ? 'on' : ''}`} />
      <div><strong>{readerState === 'connected' ? 'Kart okuyucu bağlı' : 'USB kart okuyucu'}</strong><small>{readerState === 'connected' ? 'Yeni kartlar okutuldukça Kart Listesi\'ne eklenir. Kayıtlı kartın kimde olduğu gösterilir.' : 'ESP32 + RC522 cihazını USB kablosuyla bilgisayara takıp bağlanın.'}</small></div>
      {serialSupported()
        ? readerState === 'connected'
          ? <button className="secondary" onClick={() => reader.current?.disconnect()}><Unplug size={16} /> Bağlantıyı Kes</button>
          : <button className="primary" disabled={readerState === 'connecting'} onClick={connect}><Usb size={16} /> {readerState === 'connecting' ? 'Bağlanıyor…' : 'Okuyucuya Bağlan'}</button>
        : <span className="help-text">USB okuyucu için masaüstü uygulamasını ya da bilgisayarda Chrome/Edge kullanın.</span>}
    </div>
    {scanLog.length > 0 && <ul className="scan-log">{scanLog.map(item => <li key={item.id} className={item.tone}>{item.text}</li>)}</ul>}
  </div>;
  return <>
    <PageHeading eyebrow="RFID PERSONEL KARTLARI" title="Kart Atama" description="Kartları bir kez listeye kaydedin; personele kart verirken listeden seçin." />
    <div className="status-picker card-tabs" role="tablist">
      <button role="tab" aria-selected={view === 'assign'} className={view === 'assign' ? 'selected' : ''} onClick={() => setView('assign')}>Atamalar</button>
      <button role="tab" aria-selected={view === 'inventory'} className={view === 'inventory' ? 'selected' : ''} onClick={() => setView('inventory')}>Kart Listesi ({inventory.length})</button>
    </div>
    {readerPanel}
    {view === 'assign'
      ? <CardAssignmentsTab employees={employees} cards={cards} inventory={inventory} labels={labels} today={today} run={run} store={store} onReturnRequest={onReturnRequest} />
      : <CardInventoryTab employees={employees} cards={cards} inventory={inventory} run={run} store={store} />}
  </>;
}

// Kapıdaki bilgisayar: personel kartını okuttuğunda ilk okutma giriş, sonraki okutma çıkış olarak Günlük Saatler'e yazılır.
function terminalMessage(result) {
  if (result.action === 'unknown') return { kind: 'err', lines: ['TANIMSIZ KART', 'KART KİMSEYE VERİLMEMİŞ'] };
  if (result.action === 'left') return { kind: 'err', lines: ['KART GEÇERSİZ', result.name, 'İŞTEN AYRILMIŞ'] };
  return readerMessageFor(result);
}
function terminalLogText(result) {
  if (result.action === 'unknown') return 'Tanımsız kart: kart kimseye verilmemiş';
  if (result.action === 'left') return `${result.name}: işten ayrılmış, kayıt yapılmadı`;
  if (result.action === 'in') return `${result.name} · Giriş ${result.start}`;
  if (result.action === 'out' || result.action === 'extend') return `${result.name} · Çıkış ${result.end} (giriş ${result.start})`;
  if (result.action === 'repeat') return `${result.name} · Az önce okuttu, tekrar sayılmadı`;
  if (result.action === 'blocked') return `${result.name} · ${result.reason === 'leave' ? 'Bugün izinli' : result.reason === 'absent' ? 'Bugün devamsız' : 'Gün elle girilmiş'}, kayıt değişmedi`;
  return result.name || '';
}
const terminalTone = result => ['in', 'out', 'extend'].includes(result.action) ? 'ok' : result.action === 'repeat' ? 'info' : 'error';

function TerminalPage({ store, notify }) {
  const [readerState, setReaderState] = useState('idle');
  const [last, setLast] = useState(null);
  const [scanLog, setScanLog] = useState([]);
  const [clock, setClock] = useState(turkeyNow());
  const [testUid, setTestUid] = useState('');
  const reader = useRef(null);
  const queue = useRef(Promise.resolve());
  const reconnect = useRef(null);
  // Okuyucu bağlıyken yetkiler yenilense de her okutma güncel veri katmanıyla kaydedilir.
  const storeRef = useRef(store);
  storeRef.current = store;
  const log = (tone, text, time = turkeyNow().time) => setScanLog(list => [{ id: makeId(), tone, text, time }, ...list].slice(0, 30));
  // Wi-Fi okuyucu (2.0) kendi kaydediyorsa bu bilgisayar okutmayı kaydetmez; aksi hâlde aynı okutma iki yerden yazılırdı.
  // Cihaz Wi-Fi modunda her UID satırından önce MODE:WIFI gönderir, bu yüzden karar okutma anında bellidir.
  const deviceMode = useRef(null);
  const [device, setDevice] = useState(null);
  const onDevice = info => {
    if (info.type === 'mode') { deviceMode.current = info.mode; setDevice(current => ({ ...current, mode: info.mode })); }
    if (info.type === 'status') { deviceMode.current = info.mode; setDevice({ mode: info.mode, status: info }); }
  };
  const forgetDevice = () => { deviceMode.current = null; setDevice(null); };

  useEffect(() => { const timer = setInterval(() => setClock(turkeyNow()), 1000); return () => clearInterval(timer); }, []);
  // Son okutma ekranda birkaç saniye büyük görünür.
  useEffect(() => { if (!last) return; const timer = setTimeout(() => setLast(null), 6000); return () => clearTimeout(timer); }, [last]);

  function handleScan(cardUid) {
    if (deviceMode.current === 'wifi') {
      log('info', `${cardUid} · Cihaz Wi-Fi ile kendisi kaydediyor; bu bilgisayar kaydetmedi.`);
      return;
    }
    queue.current = queue.current.then(async () => {
      try {
        const result = await storeRef.current.clockCard(cardUid);
        const message = terminalMessage(result);
        setLast({ ...message, id: makeId() });
        log(terminalTone(result), terminalLogText(result));
        try {
          await reader.current?.display(message.kind, message.lines);
          if (message.kind === 'in' || message.kind === 'out') await reader.current?.beepOk(); else await reader.current?.beepError();
        } catch { /* ses/ekran verilemese de kayıt yapıldı */ }
      } catch (cause) {
        const text = cause?.message || 'Okutma kaydedilemedi.';
        setLast({ kind: 'err', lines: ['KAYIT YAPILMADI', 'TEKRAR OKUTUN'], id: makeId() });
        log('error', text);
        try { await reader.current?.display('err', ['KAYIT YAPILMADI', 'TEKRAR OKUTUN']); await reader.current?.beepError(); } catch { /* okuyucu yok */ }
      }
    }).catch(() => {});
  }

  // Daha önce bağlanmış okuyucuya tıklamadan bağlanır; kablo çıkarılıp takılınca yeniden bağlanır.
  useEffect(() => {
    let alive = true;
    const coordinator = createReaderReconnectCoordinator({
      open: (port, onDisconnected) => connectCardReader({
        port,
        onCard: handleScan,
        onStatus: state => { if (state === 'disconnected') onDisconnected(); },
        onError: cause => log('error', cause.message),
        onDevice,
      }),
      onState: state => { if (state !== 'connected') { reader.current = null; forgetDevice(); } setReaderState(state); },
      onConnected: nextReader => {
        reader.current = nextReader;
        forgetDevice();
        nextReader.sendFrame?.('status').catch(() => {});
        notify('Kart okuyucu bağlandı. Personel kartlarını okutabilir.');
      },
      onError: cause => { if (cause?.message) log('error', cause.message); },
    });
    reconnect.current = coordinator;
    rememberedReaderPort().then(port => { if (alive && port) coordinator.connect(port); });
    // Bluetooth kulaklık gibi okuyucu olmayan seri cihazların takılması bağlı okuyucuyu kapatmaz.
    const onConnect = event => { const port = event.port || event.target; if (alive && isReaderPort(port)) coordinator.portConnected(port); };
    const onDisconnect = event => { if (alive) coordinator.portDisconnected(event.port || event.target); };
    if (serialSupported()) {
      navigator.serial.addEventListener?.('connect', onConnect);
      navigator.serial.addEventListener?.('disconnect', onDisconnect);
    }
    return () => {
      alive = false;
      reconnect.current = null;
      if (serialSupported()) {
        navigator.serial.removeEventListener?.('connect', onConnect);
        navigator.serial.removeEventListener?.('disconnect', onDisconnect);
      }
      coordinator.dispose();
    };
  }, []);

  const connected = readerState === 'connected';
  return <>
    <PageHeading eyebrow="GİRİŞ – ÇIKIŞ" title="Kart Okutma" description={`Personel kartını okuttuğunda ilk okutma giriş, sonraki okutma çıkış olarak Günlük Saatler'e yazılır. ${REPEAT_MINUTES} dakika içindeki ikinci okutma sayılmaz.`} />
    <div className="panel card-reader-panel">
      <div className="card-reader-head">
        <div className={`reader-dot ${connected ? 'on' : ''}`} />
        <div><strong>{connected ? 'Kart okuyucu bağlı' : 'USB kart okuyucu'}</strong><small>{connected ? (device?.mode === 'wifi' ? 'Okuyucu Wi-Fi modunda: okutmaları kendisi kaydediyor.' : 'Bu sayfa açık kaldığı sürece okutmalar kaydedilir.') : 'Okuyucuyu USB kablosuyla takıp bağlanın. Bir kez bağlandıktan sonra uygulama açılınca kendiliğinden bağlanır.'}</small></div>
        {serialSupported()
          ? connected
            ? <button className="secondary" onClick={() => reconnect.current?.manualDisconnect()}><Unplug size={16} /> Bağlantıyı Kes</button>
            : <button className="primary" disabled={readerState === 'connecting'} onClick={() => reconnect.current?.connect()}><Usb size={16} /> {readerState === 'connecting' ? 'Bağlanıyor…' : 'Okuyucuya Bağlan'}</button>
          : <span className="help-text">USB okuyucu için masaüstü uygulamasını ya da bilgisayarda Chrome/Edge kullanın.</span>}
      </div>
    </div>
    {connected && device?.mode === 'wifi' && <div className="notice device-wifi-notice"><Wifi size={18} /><div><strong>Cihaz Wi-Fi ile kendisi kaydediyor</strong><span>Bu bilgisayar okutmaları kaydetmez, böylece çift kayıt olmaz. {device.status ? `${DEVICE_NET_LABELS[device.status.net] || ''}${device.status.queue ? ` · Gönderilecek okutma: ${device.status.queue}` : ''}` : ''}</span></div></div>}
    <div className={`panel terminal-display ${last ? `tone-${last.kind}` : 'tone-idle'}`} aria-live="polite">
      {last
        ? <><span className="terminal-title">{last.lines[0]}</span><strong className="terminal-name">{last.lines[1]}</strong>{last.lines[2] && <span className="terminal-detail">{last.lines[2]}</span>}</>
        : <><span className="terminal-title">KARTINIZI OKUTUN</span><strong className="terminal-clock">{clock.time}</strong><span className="terminal-detail">{formatDateTr(clock.date)}</span></>}
    </div>
    {SANDBOX && <div className="panel terminal-test"><div className="field"><label>Deneme: kart UID'si yazıp okutun<small>Yalnız Deneme Ortamı'nda görünür. Örnek kartlar: 04A1B2C3 … 04A1B2C7</small></label><div className="action-row"><input value={testUid} onChange={event => setTestUid(event.target.value)} placeholder="04A1B2C3" /><button className="primary" onClick={() => handleScan(testUid)}><ScanLine size={16} /> Okut</button></div></div></div>}
    <div className="panel">
      <div className="table-toolbar"><strong>Bu bilgisayardaki son okutmalar</strong><span>{scanLog.length} kayıt</span></div>
      {scanLog.length ? <ul className="scan-log terminal-log">{scanLog.map(item => <li key={item.id} className={item.tone}><time>{item.time}</time>{item.text}</li>)}</ul> : <Empty text="Henüz kart okutulmadı." />}
    </div>
  </>;
}

function cardName(labels, cardUid) { return labels.get(cardUid) ? `Kart ${labels.get(cardUid)}` : cardUid; }

function CardAssignmentsTab({ employees, cards, inventory, labels, today, run, store, onReturnRequest }) {
  const [query, setQuery] = useState('');
  const assignments = new Map(cards.map(item => [item.employeeId, item.cardUid]));
  const free = availableCards(inventory, cards);
  const leaving = cardsNeedingReturn(employees, cards, today);
  // İşten ayrılan personele yeni kart verilmez; elinde kart kalan ayrılan personel iade için listede görünür.
  const rows = employees.filter(item => (!isEmployeeLeaving(item, today) || assignments.has(item.id)) && item.name.toLocaleLowerCase('tr-TR').includes(query.toLocaleLowerCase('tr-TR')));
  return <>
    {leaving.length > 0 && <div className="notice card-return-notice"><AlertCircle size={18} /><div><strong>İşten ayrılan personelde kart var</strong>{leaving.map(({ employee, cardUid }) => <div key={employee.id} className="card-return-line"><span>{employee.name} · {cardName(labels, cardUid)}</span><button className="secondary" onClick={() => onReturnRequest({ employee, cardUid })}>Kartı al</button></div>)}</div></div>}
    {!inventory.length && <div className="notice"><CreditCard size={18} /> Kart Listesi boş. Önce "Kart Listesi" sekmesinden kartları kaydedin ya da okuyucuyla okutun.</div>}
    <div className="panel card-assignment-panel">
      <div className="table-toolbar"><div className="search"><Search size={17} /><input placeholder="Personel ara..." value={query} onChange={event => setQuery(event.target.value)} /></div><span>{cards.length} kart atanmış · {free.length} kart boşta</span></div>
      <div className="card-assignment-list">{rows.map(employee => <CardAssignmentRow key={employee.id} employee={employee} leaving={isEmployeeLeaving(employee, today)} cardUid={assignments.get(employee.id) || ''} free={free} labels={labels}
        onAssign={cardUid => run(() => store.assignCard(employee.id, employee.name, cardUid), `${cardName(labels, cardUid)} ${employee.name} personeline verildi.`)}
        onRemove={() => onReturnRequest({ employee, cardUid: assignments.get(employee.id) })} />)}</div>
      {!rows.length && <Empty text="Personel bulunamadı." />}
    </div>
  </>;
}

function CardAssignmentRow({ employee, leaving, cardUid, free, labels, onAssign, onRemove }) {
  const [value, setValue] = useState('');
  useEffect(() => setValue(''), [cardUid]);
  return <form className="card-assignment-row" onSubmit={event => { event.preventDefault(); if (value) onAssign(value); }}>
    <div className="employee-name"><div className="person-avatar">{employee.name.slice(0, 1).toUpperCase()}</div><div><strong>{employee.name}</strong><small>{cardUid ? `${cardName(labels, cardUid)} · ${cardUid}` : 'Kart verilmedi'}</small></div></div>
    <label className="card-uid-field"><span>{leaving ? 'İşten ayrıldı' : cardUid ? 'Kartı değiştir' : 'Kart seç'}</span><select aria-label={`${employee.name} kart seçimi`} disabled={leaving} value={value} onChange={event => setValue(event.target.value)}>
      <option value="">{free.length ? 'Boştaki kartlardan seçin' : 'Boşta kart yok'}</option>
      {free.map(item => <option key={item.cardUid} value={item.cardUid}>Kart {item.label} · {item.cardUid}</option>)}
    </select></label>
    <div className="card-assignment-actions"><button className="primary" type="submit" disabled={!value || leaving}><Check size={16} /> {cardUid ? 'Değiştir' : 'Ver'}</button>{cardUid && <button className="secondary danger-text" type="button" onClick={onRemove}><Trash2 size={16} /> Kartı Al</button>}</div>
  </form>;
}

function CardInventoryTab({ employees, cards, inventory, run, store }) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [manual, setManual] = useState({ uid: '', label: '' });
  const [history, setHistory] = useState(null);
  const [editing, setEditing] = useState(null);
  const holders = new Map(cards.map(item => [item.cardUid, employees.find(person => person.id === item.employeeId)?.name || 'Personel']));
  const counts = { all: inventory.length, available: 0, assigned: 0, lost: 0 };
  inventory.forEach(item => { counts[cardStatus(item, cards)] += 1; });
  const search = query.trim().toLocaleLowerCase('tr-TR');
  const rows = sortInventory(inventory).filter(item => (filter === 'all' || cardStatus(item, cards) === filter)
    && (!search || item.label.toLocaleLowerCase('tr-TR').includes(search) || item.cardUid.toLowerCase().includes(search) || (holders.get(item.cardUid) || '').toLocaleLowerCase('tr-TR').includes(search)));
  const labelTaken = (label, except) => inventory.some(item => item.cardUid !== except && item.label.toLocaleLowerCase('tr-TR') === label.trim().toLocaleLowerCase('tr-TR'));
  function addManual(event) {
    event.preventDefault();
    const label = manual.label.trim() || nextCardLabel(inventory);
    if (labelTaken(label)) return run(() => { throw new Error(`Kart ${label} numarası başka bir kartta kullanılıyor.`); });
    run(async () => { await store.addInventoryCard(manual.uid, label); setManual({ uid: '', label: '' }); }, `Kart ${label} listeye eklendi.`);
  }
  function saveEdit(item, uid, label) {
    if (labelTaken(label, item.cardUid)) return run(() => { throw new Error(`Kart ${label.trim()} numarası başka bir kartta kullanılıyor.`); });
    run(async () => { await store.updateInventoryCard(item.cardUid, uid, label); setEditing(null); }, 'Kart bilgileri güncellendi.');
  }
  async function toggleLost(item) {
    const holder = holders.get(item.cardUid);
    if (!item.lost && !(await askConfirm({ eyebrow: 'KAYIP KART', title: `Kart ${item.label} kayıp işaretlensin mi?`,
      message: holder ? `Bu kart şu an ${holder} personelinde. Kayıp işaretlenirse ataması kaldırılır ve kart terminalde kabul edilmez.` : 'Kart, bulundu olarak işaretlenene kadar kimseye verilemez.',
      confirmText: 'Kayıp İşaretle', danger: true }))) return;
    run(() => store.setInventoryLost(item.cardUid, !item.lost, holder || ''), item.lost ? `Kart ${item.label} bulundu, tekrar boşta.` : `Kart ${item.label} kayıp olarak işaretlendi.`);
  }
  async function remove(item) {
    if (!(await askConfirm({ eyebrow: 'KART SİLME', title: `Kart ${item.label} silinsin mi?`, message: `${item.cardUid} UID'li kart listeden tamamen silinir.`,
      note: 'Bu yalnız yanlışlıkla eklenmiş, hiç kullanılmamış kartlar içindir. Bilgileri yanlışsa silmek yerine "Düzenle" ile düzeltebilirsiniz.', confirmText: 'Kartı Sil', danger: true }))) return;
    run(() => store.deleteInventoryCard(item.cardUid), `Kart ${item.label} listeden silindi.`);
  }
  async function showHistory(item) {
    setHistory({ card: item, items: null });
    try { setHistory({ card: item, items: sortCardHistory(await store.cardHistory(item.cardUid)) }); }
    catch (cause) { setHistory(null); run(() => { throw cause; }); }
  }
  return <>
    <form className="panel card-manual-add" onSubmit={addManual}>
      <label className="card-uid-field"><span>Kart UID (elle ekleme)</span><input autoComplete="off" spellCheck="false" maxLength={29} value={manual.uid} onChange={event => setManual({ ...manual, uid: event.target.value.toUpperCase() })} placeholder="Ör. A1 B2 C3 D4" /></label>
      <label className="card-uid-field"><span>Kart numarası</span><input maxLength={20} value={manual.label} onChange={event => setManual({ ...manual, label: event.target.value })} placeholder={nextCardLabel(inventory)} /></label>
      <button className="primary" type="submit" disabled={!manual.uid.trim()}><Plus size={16} /> Listeye Ekle</button>
    </form>
    <div className="panel">
      <div className="table-toolbar card-inventory-toolbar"><div className="search"><Search size={17} /><input placeholder="Kart no, UID veya personel ara..." value={query} onChange={event => setQuery(event.target.value)} /></div>
        <div className="status-picker card-filter">{[['all', 'Tümü'], ['available', 'Boşta'], ['assigned', 'Atanmış'], ['lost', 'Kayıp']].map(([key, text]) => <button key={key} type="button" className={filter === key ? 'selected' : ''} onClick={() => setFilter(key)}>{text} ({counts[key]})</button>)}</div></div>
      <div className="table-wrap"><table className="data-table card-inventory-table"><thead><tr><th>KART NO</th><th>UID</th><th>DURUM</th><th>KİMDE</th><th></th></tr></thead><tbody>{rows.map(item => { const status = cardStatus(item, cards); return <tr key={item.cardUid}>
        <td className="emphasis">Kart {item.label}</td><td className="numeric uid-cell">{item.cardUid}</td>
        <td><span className={`card-status ${status}`}>{CARD_STATUS_LABELS[status]}</span></td><td>{holders.get(item.cardUid) || '—'}</td>
        <td><div className="action-row card-row-actions"><button className="text-button" onClick={() => showHistory(item)}><History size={14} /> Geçmiş</button><button className="text-button" onClick={() => setEditing(item)}><Pencil size={14} /> Düzenle</button><button className="text-button" onClick={() => toggleLost(item)}>{item.lost ? 'Bulundu' : 'Kayıp'}</button>{status !== 'assigned' && !(item.events > 0) && <button className="text-button danger-text" onClick={() => remove(item)}><Trash2 size={14} /> Sil</button>}</div></td>
      </tr>; })}</tbody></table></div>
      {!rows.length && <Empty text={inventory.length ? 'Bu filtrede kart yok.' : 'Henüz kart eklenmedi. Okuyucuyu bağlayıp kartları okutun.'} />}
    </div>
    {editing && <CardEditModal item={editing} assigned={cards.some(card => card.cardUid === editing.cardUid)} holder={holders.get(editing.cardUid)} onClose={() => setEditing(null)} onSave={(uid, label) => saveEdit(editing, uid, label)} />}
    {history && <div className="modal-backdrop" onMouseDown={() => setHistory(null)}><div className="modal" onMouseDown={event => event.stopPropagation()}>
      <div className="modal-head"><div><span className="eyebrow">KART GEÇMİŞİ</span><h2>Kart {history.card.label}</h2><p className="uid-cell">{history.card.cardUid}</p></div><button className="icon-button" onClick={() => setHistory(null)}><X size={19} /></button></div>
      <div className="card-history">{history.items == null ? <p className="help-text">Yükleniyor…</p> : history.items.length ? history.items.map(item => <div className="rule" key={item.id}><span>{formatDateTr(item.date)}</span><strong>{CARD_HISTORY_LABELS[item.action] || item.action}{item.employeeName ? ` · ${item.employeeName}` : ''}</strong></div>) : <p className="help-text">Bu kart henüz kimseye verilmedi.</p>}</div>
    </div></div>}
  </>;
}

function CardEditModal({ item, assigned, holder, onClose, onSave }) {
  const [uid, setUid] = useState(item.cardUid);
  const [label, setLabel] = useState(item.label);
  const uidLocked = item.events > 0 || assigned;
  const changed = uid.replace(/[\s:-]/g, '').toUpperCase() !== item.cardUid || label.trim() !== item.label;
  function submit(event) { event.preventDefault(); onSave(uidLocked ? item.cardUid : uid, label); }
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={event => event.stopPropagation()}>
    <div className="modal-head"><div><span className="eyebrow">KART BİLGİLERİ</span><h2>Kart {item.label}</h2><p className="uid-cell">{item.cardUid}</p></div><button className="icon-button" aria-label="Kapat" onClick={onClose}><X size={19} /></button></div>
    <form onSubmit={submit}>
      <div className="field"><label>Kart numarası<small>Kartın üzerine yapıştırılan numara.</small></label><input autoFocus maxLength={20} required value={label} onChange={event => setLabel(event.target.value)} /></div>
      <div className="field"><label>Kart UID<small>{uidLocked ? (assigned ? `Kart şu an ${holder || 'bir personelde'}. UID değiştirmek için önce kartı teslim alın.` : 'Bu kart daha önce kullanıldığı için UID değiştirilemez; geçmiş kayıtları bu UID\'ye bağlı.') : 'Okuyucunun verdiği numara. Yanlış girildiyse düzeltin.'}</small></label><input className="uid-cell" autoComplete="off" spellCheck="false" maxLength={29} disabled={uidLocked} value={uid} onChange={event => setUid(event.target.value.toUpperCase())} /></div>
      <div className="modal-actions"><button type="button" className="secondary" onClick={onClose}>Vazgeç</button><button className="primary" type="submit" disabled={!changed || !label.trim()}><Check size={17} /> Kaydet</button></div>
    </form>
  </div></div>;
}

function CardReturnModal({ value, label, onReturned, onLost, onClose }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={event => event.stopPropagation()}>
    <div className="modal-head"><div><span className="eyebrow">KART İADESİ</span><h2>{value.employee.name}</h2><p>{label ? `Kart ${label}` : value.cardUid}</p></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div>
    <div className="card-return-body"><p>Kartı personelden teslim aldınız mı?</p>
      <div className="card-return-choices">
        <button className="primary" onClick={onReturned}><Check size={16} /> Teslim alındı</button>
        <button className="secondary danger-text" onClick={onLost}><AlertCircle size={16} /> Kayıp / teslim edilmedi</button>
        <button className="text-button subtle" onClick={onClose}>Sonra karar ver</button>
      </div>
      <p className="help-text">Teslim alınan kart boşa çıkar ve başka personele verilebilir. Kayıp işaretlenen kart terminalde kabul edilmez. Personelin eski puantaj kayıtları değişmez.</p>
    </div>
  </div></div>;
}

function MobileTimesheet({ date, onChangeDay, onToday, onExport, employees, search, onSearch, dayCell }) {
  const value = new Date(`${date}T12:00:00`);
  const day = { date, day: value.getDate(), weekday: value.getDay() };
  const rows = employees.filter(item => item.startDate <= date && (!item.endDate || item.endDate >= date));
  const cells = rows.map(item => ({ item, cell: dayCell(item, day) }));
  const offDay = cells[0]?.cell.offDay;
  const entered = cells.filter(({ cell }) => cell.shownEntry).length;
  return <>
    <div className="mobile-day-bar">
      <button className="icon-button" aria-label="Önceki gün" onClick={() => onChangeDay(-1)}><ChevronLeft size={22} /></button>
      <button className="mobile-day-label" onClick={onToday}><strong>{formatDateTr(date)}</strong><span>{value.toLocaleDateString('tr-TR', { weekday: 'long' })}{date === todayKey() ? ' · Bugün' : ''}</span></button>
      <button className="icon-button" aria-label="Sonraki gün" onClick={() => onChangeDay(1)}><ChevronRight size={22} /></button>
    </div>
    <button className="secondary mobile-daily-export" onClick={onExport}><Download size={17} /> Günlük Excel</button>
    {offDay && <div className="notice"><AlertCircle size={18} /> Çalışma günü değil. Girilen sürenin tamamı mesai sayılır.</div>}
    <div className="panel mobile-list">
      <div className="table-toolbar"><div className="search"><Search size={17} /><input placeholder="Personel ara..." value={search} onChange={event => onSearch(event.target.value)} /></div><span>{entered}/{cells.length}</span></div>
      {cells.map(({ item, cell }) => <button key={item.id} className={`mobile-entry ${cell.cellClass}${cell.offDay ? ' offday' : ''}`} onClick={cell.open}>
        <div className="person-avatar">{item.name.slice(0, 1).toUpperCase()}</div>
        <div className="mobile-entry-name"><strong>{item.name}</strong><span>{item.company || '—'}</span></div>
        <div className="mobile-entry-value"><strong>{cell.label}</strong>{cell.offline && <span className="offline-badge" title={OFFLINE_SCAN_TITLE}>Çevrimdışı okutma</span>}{cell.calc && cell.shownEntry?.status === 'present' && <span>{cell.calc.overtimeMinutes ? `+${number(hours(cell.calc.overtimeMinutes))} sa mesai` : cell.calc.missingMinutes ? `−${number(hours(cell.calc.missingMinutes))} sa eksik` : 'Tam gün'}</span>}</div>
        {cell.shownEntry ? <Pencil size={16} /> : <Plus size={18} />}
      </button>)}
      {!cells.length && <Empty text="Bu gün için personel bulunamadı." />}
    </div>
  </>;
}

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let deferredInstall = null;
const installListeners = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstall = event; installListeners.forEach(listener => listener()); });
  window.addEventListener('appinstalled', () => { deferredInstall = null; installListeners.forEach(listener => listener()); });
}
function InstallHint() {
  const [, refresh] = useState(0);
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('open-attendance-install-hint') === 'hidden'; } catch { return false; } });
  useEffect(() => { const listener = () => refresh(value => value + 1); installListeners.add(listener); return () => installListeners.delete(listener); }, []);
  if (window.desktop || hidden || isStandalone() || !window.matchMedia(MOBILE_QUERY).matches) return null;
  const close = () => { setHidden(true); try { localStorage.setItem('open-attendance-install-hint', 'hidden'); } catch { /* tarayıcı depolamayı engelliyor */ } };
  if (deferredInstall) return <div className="install-hint"><Smartphone size={20} /><div><strong>Uygulamayı yükle</strong><span>Ana ekrandan tek dokunuşla açın.</span></div><button className="primary" onClick={async () => { const prompt = deferredInstall; deferredInstall = null; await prompt.prompt(); refresh(value => value + 1); }}>Yükle</button><button className="icon-button" aria-label="Kapat" onClick={close}><X size={16} /></button></div>;
  if (isIos()) return <div className="install-hint"><Share size={20} /><div><strong>Ana ekrana ekleyin</strong><span>Safari'de alttaki <b>Paylaş</b> düğmesine, sonra <b>Ana Ekrana Ekle</b>'ye dokunun.</span></div><button className="icon-button" aria-label="Kapat" onClick={close}><X size={16} /></button></div>;
  return null;
}

function EmployeeModal({ value, selectedMonth, companies, canDelete, onClose, onSave, onDelete }) {
  const isNew = !value.name;
  const initialRows = useMemo(() => salaryRows(value, selectedMonth), [value, selectedMonth]);
  const [form, setForm] = useState({ ...value });
  const [rows, setRows] = useState(initialRows);
  const [formError, setFormError] = useState('');
  const thisMonth = todayKey().slice(0, 7);
  const sortedRows = [...rows].filter(row => row.effectiveMonth).sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth));
  const current = sortedRows.filter(row => row.effectiveMonth <= thisMonth).at(-1) || sortedRows[0];
  const updateRow = (index, patch) => setRows(list => list.map((row, position) => position === index ? { ...row, ...patch } : row));
  function addRow() {
    if (rows.length >= 20) return setFormError('En fazla 20 maaş kaydı eklenebilir. Eski bir kaydı silmeden yenisini ekleyemezsiniz.');
    const latest = sortedRows.at(-1) || { salary: '', bank: '' };
    let month = selectedMonth > (latest.effectiveMonth || '') ? selectedMonth : thisMonth;
    while (rows.some(row => row.effectiveMonth === month)) { const [y, m] = month.split('-').map(Number); const next = new Date(y, m, 1); month = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`; }
    setRows(list => [...list, { effectiveMonth: month, salary: latest.salary, bank: latest.bank }]);
  }
  function changeStart(startDate) {
    setForm({ ...form, startDate });
    // Yeni personelde tek maaş kaydı işe giriş ayıyla başlar.
    if (isNew && rows.length === 1 && startDate) updateRow(0, { effectiveMonth: startDate.slice(0, 7) });
  }
  async function submit(event) {
    event.preventDefault();
    setFormError('');
    if (!form.name.trim()) return;
    if (!form.company || !companies.includes(form.company) && form.company !== value.company) return setFormError('Ayarlar bölümünde kayıtlı bir şirket seçin.');
    if (form.endDate && form.endDate < form.startDate) return setFormError('İşten çıkış tarihi işe giriş tarihinden önce olamaz.');
    if (!rows.length) return setFormError('En az bir maaş kaydı gerekli.');
    if (rows.length > 20) return setFormError('En fazla 20 maaş kaydı kaydedilebilir. Fazla kayıtları silin.');
    const clean = [];
    for (const row of rows) {
      if (!/^\d{4}-\d{2}$/.test(row.effectiveMonth || '')) return setFormError('Her maaş kaydı için geçerli bir ay seçin.');
      const salary = Number(row.salary), bank = Number(row.bank);
      if (row.salary === '' || !Number.isFinite(salary) || salary < 0 || salary > 1000000000) return setFormError(`${formatMonth(row.effectiveMonth)} için 0–1.000.000.000 TL arasında toplam maaş girin.`);
      if (row.bank === '' || !Number.isFinite(bank) || bank < 0 || bank > 1000000000) return setFormError(`${formatMonth(row.effectiveMonth)} için 0–1.000.000.000 TL arasında banka tutarı girin.`);
      if (bank > salary) return setFormError(`${formatMonth(row.effectiveMonth)}: banka tutarı toplam maaşı aşamaz.`);
      if (clean.some(item => item.effectiveMonth === row.effectiveMonth)) return setFormError(`${formatMonth(row.effectiveMonth)} için birden fazla maaş kaydı var.`);
      clean.push({ effectiveMonth: row.effectiveMonth, salary, bank });
    }
    clean.sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth));
    if (!isNew) {
      const changes = describeSalaryChanges(initialRows.map(row => ({ ...row, salary: Number(row.salary), bank: Number(row.bank) })), clean);
      if (changes.length && !(await askConfirm({ eyebrow: 'MAAŞ DEĞİŞİKLİĞİ', title: 'Maaş değişiklikleri kaydedilsin mi?', items: changes, note: 'Raporlar yalnızca bu aylardan itibaren yeniden hesaplanır; daha önceki aylar değişmez.', confirmText: 'Kaydet' }))) return;
    }
    const applicable = clean.filter(row => row.effectiveMonth <= thisMonth).at(-1) || clean[0];
    const overtimeRate = form.overtimeRate == null || form.overtimeRate === '' ? null : Number(form.overtimeRate);
    if (overtimeRate !== null && (!Number.isFinite(overtimeRate) || overtimeRate < 0 || overtimeRate > 1000000)) return setFormError('Kişiye özel mesai ücreti 0–1.000.000 TL arasında olmalı.');
    onSave({ ...form, name: form.name.trim(), company: (form.company || '').trim(), salary: applicable.salary, bank: applicable.bank, salaryHistory: clean, overtimeRate });
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={event => event.stopPropagation()}>
    <div className="modal-head"><div><span className="eyebrow">PERSONEL KARTI</span><h2>{isNew ? 'Yeni Personel' : 'Personeli Düzenle'}</h2></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div>
    <form onSubmit={submit}>
      <div className="field"><label>Ad Soyad</label><input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Personel adı" /></div>
      <div className="field"><label>Kayıtlı Şirket</label><select required value={form.company || ''} onChange={event => setForm({ ...form, company: event.target.value })}><option value="">Şirket seçin</option>{form.company && !companies.includes(form.company) && <option value={form.company}>{form.company} (eski kayıt)</option>}{companies.map(company => <option key={company} value={company}>{company}</option>)}</select>{!companies.length && <p className="help-text">Önce Ayarlar bölümüne şirket adı ekleyin.</p>}</div>
      <div className="form-grid"><div className="field"><label>İşe Giriş Tarihi</label><input required type="date" value={form.startDate} onChange={event => changeStart(event.target.value)} /></div><div className="field"><label>İşten Çıkış Tarihi <small>Boşsa aktif kalır</small></label><input type="date" min={form.startDate} value={form.endDate || ''} onChange={event => setForm({ ...form, endDate: event.target.value })} /></div></div>
      <div className="salary-history">
        <div className="salary-history-head"><div><strong>Maaş Geçmişi</strong><span>Her kayıt seçilen aydan itibaren geçerlidir. En fazla 20 maaş kaydı tutulabilir.</span></div>{!isNew && <button type="button" className="secondary" disabled={rows.length >= 20} title={rows.length >= 20 ? 'En fazla 20 maaş kaydı tutulabilir.' : undefined} onClick={addRow}><Plus size={15} /> Zam / Değişiklik</button>}</div>
        <div className="salary-row salary-row-labels"><span>Geçerli ay</span><span>Toplam maaş (TL)</span><span>Banka (TL)</span><span /></div>
        {rows.map((row, index) => <div className={`salary-row${current && row.effectiveMonth === current.effectiveMonth ? ' current' : ''}`} key={index}>
          <label className="salary-cell salary-month"><small className="salary-caption">Geçerli ay</small><input aria-label="Geçerli ay" type="month" required value={row.effectiveMonth} onChange={event => updateRow(index, { effectiveMonth: event.target.value })} /></label>
          <label className="salary-cell"><small className="salary-caption">Toplam maaş (TL)</small><input aria-label="Toplam maaş" type="number" min="0" step="0.01" required value={row.salary} onChange={event => updateRow(index, { salary: event.target.value })} placeholder="Toplam maaş" /></label>
          <label className="salary-cell"><small className="salary-caption">Banka (TL)</small><input aria-label="Banka tutarı" type="number" min="0" step="0.01" required value={row.bank} onChange={event => updateRow(index, { bank: event.target.value })} placeholder="Banka" /></label>
          <button type="button" className="icon-button danger-icon" aria-label={`${formatMonth(row.effectiveMonth)} kaydını sil`} title="Kaydı sil" disabled={rows.length === 1} onClick={() => setRows(list => list.filter((_, position) => position !== index))}><Trash2 size={15} /></button>
        </div>)}
        {current && <div className="computed"><span>Şu anki maaş ({formatMonth(current.effectiveMonth)} kaydı) · normal ek hakediş</span><strong>{currency(Number(current.salary) || 0)} · {currency(Math.max(0, Number(current.salary || 0) - Number(current.bank || 0)))}</strong></div>}
      </div>
      <div className="field"><label>Kişiye Özel Mesai Ücreti (TL/saat) <small>Boş bırakılırsa genel tarife kullanılır</small></label><input type="number" min="0" step="0.01" value={form.overtimeRate ?? ''} onChange={event => setForm({ ...form, overtimeRate: event.target.value })} placeholder="Genel tarife" /></div>
      {formError && <div className="form-error">{formError}</div>}
      <div className="modal-actions">{canDelete && !isNew && <button type="button" className="danger-link" onClick={onDelete}>Personeli Sil</button>}<button type="button" className="secondary" onClick={onClose}>Vazgeç</button><button className="primary" type="submit"><Check size={17} /> Kaydet</button></div>
    </form>
  </div></div>;
}

function EntryModal({ value, settings, employee, canEditRate, onClose, onSave, onDelete, exists }) {
  const [form, setForm] = useState(value);
  const offDay = form.offDay === true;
  let result = null, validation = '';
  try { result = calculateDay(form, !offDay, settings); } catch (cause) { validation = cause.message; }

  function submit(event) {
    event.preventDefault();
    if (validation) return;
    const { offDay: _offDay, ...entry } = form;
    onSave({ ...entry, status: offDay ? 'present' : entry.status, rate: entry.rate === '' || entry.rate == null ? null : Number(entry.rate) });
  }
  const rateField = canEditRate
    ? <div className="field"><label>{offDay ? 'Pazar / Tatil Günü Mesai Ücreti (TL/saat)' : 'Mesai Ücreti (TL/saat)'}{offDay && <small>Bu güne özel ücreti girin</small>}</label><input type="number" min="0" max="1000000" step="0.01" required={offDay} value={form.rate ?? ''} placeholder={offDay ? 'Ör. 200' : 'Yetkili kişi onaylayacak'} onChange={event => setForm({ ...form, rate: event.target.value })} /></div>
    : <div className="entry-preview rate-readonly"><Rule label={offDay ? 'Tatil günü mesai ücreti' : 'Mesai ücreti'} value={form.rate != null ? `${currency(form.rate)} / saat` : 'Yetkili kişi girecek'} /></div>;
  return <div className="modal-backdrop" onMouseDown={onClose}><div className="modal" onMouseDown={event => event.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">{offDay ? 'TATİL GÜNÜ PUANTAJI' : 'GÜNLÜK PUANTAJ'}</span><h2>{employee?.name}</h2><p>{formatDateTr(form.date)}</p></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div><form onSubmit={submit}>{offDay ? <div className="notice"><AlertCircle size={18} /> Çalışma günü değil. Girilen sürenin tamamı mesai sayılır ve bu güne özel ücretle hesaplanır.</div> : <div className="status-picker">{[['present', 'Çalıştı'], ['absent', 'Devamsız'], ['leave', 'Ücretli İzin']].map(([status, label]) => <button type="button" key={status} className={form.status === status ? 'selected' : ''} onClick={() => setForm({ ...form, status })}>{label}</button>)}</div>}{form.status === 'present' && <><div className="form-grid"><div className="field"><label>Giriş Saati</label><input type="time" required value={form.start} onChange={event => setForm({ ...form, start: event.target.value })} /></div><div className="field"><label>Çıkış Saati</label><input type="time" required value={form.end} onChange={event => setForm({ ...form, end: event.target.value })} /></div></div>{rateField}{validation && <div className="form-error">{validation}</div>}{result && <div className="entry-preview"><Rule label="Çalışılan" value={`${number(hours(result.workedMinutes))} saat`} /><Rule label="Normal" value={`${number(hours(result.normalMinutes))} saat`} /><Rule label="Mesai (yuvarlanmış)" value={`${number(hours(result.overtimeMinutes))} saat`} /><Rule label="Eksik" value={`${number(hours(result.missingMinutes))} saat`} /></div>}</>}{form.status === 'absent' && <div className="entry-preview"><Rule label="Eksik çalışma" value={`${number(hours(settings.dailyTargetMinutes))} saat`} /></div>}{form.status === 'leave' && <div className="entry-preview"><Rule label="Eksik çalışma" value="0 saat" /><Rule label="Durum" value="Ücretli izin" /></div>}<div className="modal-actions">{exists && <button type="button" className="danger-link" onClick={onDelete}>Kaydı Sil</button>}<button type="button" className="secondary" onClick={onClose}>Vazgeç</button><button className="primary" type="submit" disabled={!!validation}><Check size={17} /> Kaydet</button></div></form></div></div>;
}


function AdminPage({ users, firebaseConfig, onSave }) {
  const [drafts, setDrafts] = useState({});
  useEffect(() => setDrafts(Object.fromEntries(users.map(user => [user.uid, user.menus || []]))), [users]);
  function toggle(uid, key) {
    setDrafts(current => {
      const selected = new Set(current[uid] || []);
      if (selected.has(key)) {
        selected.delete(key);
        if (key === 'employees') selected.delete('deleteEmployee');
      } else {
        selected.add(key);
        if (key === 'deleteEmployee') selected.add('employees');
      }
      return { ...current, [uid]: [...selected] };
    });
  }
  return <><PageHeading eyebrow="YETKİ YÖNETİMİ" title="Admin" description="Kayıtlı kullanıcıların menü ve işlem yetkilerini yönetin." /><div className="notice">Yeni kullanıcı önce giriş ekranından hesap oluşturur. İlk girişten sonra burada görünür; erişim verilene kadar şirket verilerini göremez. Personel Silme yetkisi Personeller erişimini de gerektirir.</div><div className="panel"><div className="table-toolbar"><strong>Kullanıcılar</strong><span>{users.length} hesap</span></div><div className="table-wrap"><table className="data-table permission-table"><thead><tr><th>KULLANICI</th>{PERMISSION_KEYS.map(key => <th key={key}>{MENU_LABELS[key].toLocaleUpperCase('tr-TR')}</th>)}<th></th></tr></thead><tbody>{users.map(user => <tr key={user.uid}><td><strong>{user.email}</strong>{user.admin && <small>Admin · tüm yetkiler</small>}</td>{PERMISSION_KEYS.map(key => <td key={key}><input type="checkbox" aria-label={`${user.email} ${MENU_LABELS[key]}`} checked={user.admin || drafts[user.uid]?.includes(key) || false} disabled={user.admin} onChange={() => toggle(user.uid, key)} /></td>)}<td>{!user.admin && <button className="secondary" disabled={JSON.stringify([...(drafts[user.uid] || [])].sort()) === JSON.stringify([...(user.menus || [])].sort())} onClick={() => onSave(user.uid, drafts[user.uid] || [])}>Kaydet</button>}</td></tr>)}</tbody></table></div>{!users.length && <Empty text="Henüz kayıtlı kullanıcı yok." />}</div><DeviceSetupPanel users={users} firebaseConfig={firebaseConfig} /></>;
}

// Admin: Wi-Fi kart okuyucu (firmware 2.0) kurulumu. Bilgiler yalnız USB ile cihaza gönderilir;
// şifreler Firestore'a, tarayıcı depolamasına veya kayıtlara yazılmaz, cihazdan geri okunmaz.
const EMPTY_DEVICE_FORM = { ssid: '', wifiPassword: '', email: '', password: '', setupPassword: '' };
function DeviceSetupPanel({ users, firebaseConfig }) {
  const [state, setState] = useState('idle');
  const [status, setStatus] = useState(null);
  const [legacy, setLegacy] = useState(false);
  const [form, setForm] = useState(EMPTY_DEVICE_FORM);
  const [result, setResult] = useState(null);
  const [failures, setFailures] = useState(null);
  const [busy, setBusy] = useState(false);
  const reader = useRef(null);
  const pendingCfg = useRef(null);
  const failBuffer = useRef([]);
  const statusSeen = useRef(false);
  const timeSent = useRef(false);
  useEffect(() => () => { reader.current?.disconnect(); }, []);
  useEffect(() => {
    if (state !== 'connected') return undefined;
    const timer = setInterval(() => { reader.current?.sendFrame('status').catch(() => {}); }, 5000);
    const legacyTimer = setTimeout(() => { if (!statusSeen.current) setLegacy(true); }, 4000);
    return () => { clearInterval(timer); clearTimeout(legacyTimer); };
  }, [state]);
  function onDevice(info) {
    if (info.type === 'status') {
      statusSeen.current = true; setLegacy(false); setStatus(info);
      // Cihaz saati internetten (NTP / Google) ayarlanamadıysa bağlantı başına bir kez bu bilgisayarın saati gönderilir.
      if (info.clock === 'unset' && !timeSent.current) { timeSent.current = true; command('time', deviceTimeFields()).catch(() => {}); }
    }
    else if (info.type === 'cfg') {
      const pending = pendingCfg.current;
      if (pending) { clearTimeout(pending.timer); pendingCfg.current = null; pending.resolve(info); }
    } else if (info.type === 'fail') failBuffer.current.push(info);
    else if (info.type === 'fail-end') { setFailures(failBuffer.current); failBuffer.current = []; }
  }
  const command = (name, fields) => reader.current ? reader.current.sendFrame(name, fields) : Promise.reject(new Error('Cihaz bağlı değil.'));
  const waitCfg = () => new Promise(resolve => {
    pendingCfg.current = { resolve, timer: setTimeout(() => { pendingCfg.current = null; resolve(null); }, 6000) };
  });
  async function connect() {
    setState('connecting'); setResult(null); setLegacy(false); statusSeen.current = false; timeSent.current = false;
    try {
      reader.current = await connectCardReader({
        onCard: () => {},
        onDevice,
        onStatus: value => { if (value === 'disconnected') { reader.current = null; setState('idle'); setStatus(null); setFailures(null); } },
        onError: cause => setResult({ tone: 'error', text: cause.message }),
      });
      setState('connected');
      await command('status');
    } catch (cause) {
      reader.current = null;
      setState('idle');
      if (cause?.message) setResult({ tone: 'error', text: cause.message });
    }
  }
  async function send(event) {
    event.preventDefault();
    const problem = validateDeviceConfig(form, { requireAccount: !status?.account }) || deviceAccountProblem(users, form.email);
    if (problem) { setResult({ tone: 'error', text: problem }); return; }
    setBusy(true); setResult(null);
    try {
      const reply = waitCfg();
      await command('cfg', deviceConfigFields(form, firebaseConfig));
      const answer = await reply;
      if (!answer) setResult({ tone: 'error', text: 'Cihaz cevap vermedi. Cihazda 2.0 yazılımı yüklü mü ve USB ile bağlı mı kontrol edin.' });
      else if (answer.ok) {
        setResult({ tone: 'ok', text: 'Bilgiler cihaza kaydedildi. Cihaz Wi-Fi ağına bağlanıyor; durum birkaç saniye içinde güncellenir.' });
        setForm(EMPTY_DEVICE_FORM);
      } else setResult({ tone: 'error', text: DEVICE_CFG_ERRORS[answer.reason] || 'Cihaz bilgileri kabul etmedi.' });
      command('status').catch(() => {});
    } catch (cause) {
      setResult({ tone: 'error', text: cause?.message || 'Bilgiler cihaza gönderilemedi.' });
    } finally { setBusy(false); }
  }
  async function forget() {
    if (!(await askConfirm({ eyebrow: 'KART OKUYUCU', title: 'Wi-Fi ayarları silinsin mi?', message: 'Cihazdaki Wi-Fi ve cihaz hesabı bilgileri silinir. Cihaz yalnız USB ile bilgisayara bağlı çalışır (Kart Okutma sayfası).', note: 'Cihazda gönderilmeyi bekleyen okutmalar silinmez; yeniden kurulumdan sonra gönderilir.', confirmText: 'Sil', danger: true }))) return;
    setResult(null);
    const reply = waitCfg();
    await command('forget').catch(() => {});
    const answer = await reply;
    setResult(answer?.ok ? { tone: 'ok', text: 'Wi-Fi ayarları silindi. Cihaz USB modunda.' } : { tone: 'error', text: 'Cihaz cevap vermedi.' });
    command('status').catch(() => {});
  }
  async function clearFailures() {
    if (!(await askConfirm({ eyebrow: 'KART OKUYUCU', title: 'Gönderilemeyen okutma listesi temizlensin mi?', message: 'Bu okutmalar sisteme yazılamadı. Gerekirse Günlük Saatler\'den elle girin; liste temizlenince cihazdan silinir.', confirmText: 'Temizle', danger: true }))) return;
    await command('failclear').catch(() => {});
    setFailures([]);
    command('status').catch(() => {});
  }
  const field = (key, label, props = {}) => <div className="field"><label htmlFor={`device-${key}`}>{label}{props.hint && <small>{props.hint}</small>}</label>
    <input id={`device-${key}`} value={form[key]} autoComplete="off" spellCheck={false} type={props.type || 'text'} placeholder={props.placeholder || ''} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} /></div>;
  const connected = state === 'connected';
  return <div className="panel device-panel">
    <div className="panel-head"><div><h2>Kart Okuyucu Cihazı</h2><p>Okuyucunun bilgisayarsız, Wi-Fi ile kendi başına kayıt yapması için kurulum. Cihazı USB kablosuyla bu bilgisayara takın.</p></div>
      {serialSupported()
        ? connected
          ? <button className="secondary" onClick={() => reader.current?.disconnect()}><Unplug size={16} /> Bağlantıyı Kes</button>
          : <button className="primary" disabled={state === 'connecting'} onClick={connect}><Usb size={16} /> {state === 'connecting' ? 'Bağlanıyor…' : 'Cihaza Bağlan'}</button>
        : <span className="help-text">Kurulum için masaüstü uygulamasını ya da bilgisayarda Chrome/Edge kullanın.</span>}
    </div>
    {SANDBOX && <div className="notice device-notice"><AlertCircle size={18} /> Deneme Ortamı: cihaz bu bilgisayardaki emülatöre bağlanamaz. Gerçek kurulumu canlı uygulamadan yapın.</div>}
    {legacy && <div className="notice device-notice"><AlertCircle size={18} /> Cihaz durum bilgisi göndermiyor. Büyük olasılıkla eski (1.x) yazılım yüklü; Wi-Fi için 2.0 yazılımını yükleyin (firmware/kart-okuyucu/KURULUM.md).</div>}
    {connected && status && <div className="device-status">
      <Rule label="Yazılım" value={status.firmware ? `Sürüm ${status.firmware}` : '—'} />
      <Rule label="Çalışma şekli" value={status.mode === 'wifi' ? 'Wi-Fi (kendisi kaydediyor)' : 'USB (bilgisayara bağlı)'} />
      <Rule label="Wi-Fi" value={`${DEVICE_WIFI_LABELS[status.wifi] || status.wifi}${status.ssid ? ` · ${status.ssid}` : ''}`} />
      <Rule label="İnternet / sistem" value={DEVICE_NET_LABELS[status.net] || status.net} />
      <Rule label="Cihaz hesabı" value={status.account || 'Girilmemiş'} />
      <Rule label="Cihaz saati" value={status.clock === 'ok' ? `${status.time || 'Ayarlı'}${status.timeSource === 'usb' ? ' · bu bilgisayardan' : status.timeSource === 'http' ? ' · Google sunucusundan' : ''}` : 'Ayarsız (internete bağlanınca ya da bu bilgisayardan ayarlanır)'} />
      <Rule label="Gönderilecek okutma" value={String(status.queue)} />
      <Rule label="Gönderilemeyen okutma" value={String(status.failed)} />
    </div>}
    {connected && <div className="device-actions action-row">
      <button className="secondary" onClick={() => command('status').catch(() => {})}><RefreshCw size={16} /> Durumu Yenile</button>
      <button className="secondary" disabled={!status?.failed} onClick={() => { failBuffer.current = []; command('failed').catch(() => {}); }}><AlertCircle size={16} /> Gönderilemeyenler</button>
      <button className="secondary" onClick={() => command('setup').catch(() => {})}><Wifi size={16} /> Kurulum Ağını Aç</button>
      <button className="secondary danger-text" onClick={forget}><WifiOff size={16} /> Wi-Fi Ayarlarını Sil</button>
    </div>}
    {failures && <div className="device-failures">
      <div className="table-toolbar"><strong>Gönderilemeyen okutmalar</strong><span>{failures.length} kayıt</span></div>
      {failures.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>OKUTMA ZAMANI</th><th>KART</th><th>NEDEN</th></tr></thead><tbody>{failures.map((item, index) => <tr key={`${item.cardUid}-${index}`}><td className="numeric">{item.at.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}</td><td className="numeric uid-cell">{item.cardUid}</td><td>{deviceFailText(item.reason)}</td></tr>)}</tbody></table></div> : <Empty text="Gönderilemeyen okutma yok." />}
      {failures.length > 0 && <div className="device-actions"><button className="secondary danger-text" onClick={clearFailures}><Trash2 size={16} /> Listeyi Temizle</button></div>}
    </div>}
    {connected && <form className="device-form" onSubmit={send} autoComplete="off">
      <div className="form-grid">
        {field('ssid', 'Wi-Fi adı', { placeholder: 'Ör. Fabrika-WiFi' })}
        {field('wifiPassword', 'Wi-Fi şifresi', { type: 'password', hint: 'Şifresiz ağ için boş bırakın' })}
        {field('email', 'Cihaz hesabı e-posta', { placeholder: 'terminal@example.com', hint: status?.account ? 'Boş bırakılırsa cihazdaki hesap korunur' : 'Yalnız Kart Okutma yetkisi olan ayrı hesap' })}
        {field('password', 'Cihaz hesabı şifresi', { type: 'password' })}
        {field('setupPassword', 'Kurulum ağı şifresi', { type: 'password', hint: `"${SETUP_AP_NAME}" yedek ağı için, en az 8 karakter. Boş bırakılırsa mevcut şifre korunur.` })}
      </div>
      <p className="help-text">Şifreler yalnız USB kablosuyla cihaza gönderilir; programda veya bulutta saklanmaz ve cihazdan geri okunamaz.</p>
      {result && <div className={result.tone === 'ok' ? 'notice device-result ok' : 'form-error'}>{result.text}</div>}
      <div className="device-actions"><button className="primary" type="submit" disabled={busy}><Send size={16} /> {busy ? 'Gönderiliyor…' : 'Cihaza Gönder'}</button></div>
    </form>}
    {!connected && result && <div className={result.tone === 'ok' ? 'notice device-result ok' : 'form-error device-result'}>{result.text}</div>}
  </div>;
}

function SettingsPage({ settings, employees, email, legacyCount, onImportLegacy, onSave, onSaveCompany, onDeleteCompany }) {
  const [effectiveDate, setEffectiveDate] = useState(todayKey());
  const [form, setForm] = useState(() => resolveSettings(settings, effectiveDate));
  const [companyName, setCompanyName] = useState('');
  const [editingCompany, setEditingCompany] = useState(null);
  useEffect(() => setForm(resolveSettings(settings, effectiveDate)), [settings, effectiveDate]);
  const companies = settings.companies || [];
  function cancelCompanyEdit() { setEditingCompany(null); setCompanyName(''); }
  async function submitCompany(event) {
    event.preventDefault();
    if (await onSaveCompany(editingCompany, companyName)) cancelCompanyEdit();
  }
  function save(event) {
    event.preventDefault();
    const rules = {
      workdays: [...form.workdays].sort(),
      startTime: form.startTime, endTime: form.endTime,
      breakMinutes: Number(form.breakMinutes), dailyTargetMinutes: Number(form.dailyTargetMinutes),
      salaryDays: Number(form.salaryDays), overtimeRate: Number(form.overtimeRate),
      overtimeRoundMinutes: Number(form.overtimeRoundMinutes),
      deductionOrder: form.deductionOrder,
      allowBankDeduction: Boolean(form.allowBankDeduction),
      carryForward: Boolean(form.carryForward)
    };
    onSave(effectiveDate, rules);
  }
  function toggleDay(day) {
    setForm(current => ({ ...current, workdays: current.workdays.includes(day) ? current.workdays.filter(value => value !== day) : [...current.workdays, day] }));
  }
  return <>
    <PageHeading eyebrow="SİSTEM" title="Ayarlar" description="Şirketleri ve hesaplama kurallarını geçerli olacağı tarihle yönetin." />
    <div className="settings-grid">
      <section className="panel settings-card rule-editor">
        <div className="panel-head"><div><h2>Hesaplama Özeti</h2><p>Değişiklik seçilen günden itibaren uygulanır; önceki günler korunur.</p></div><ShieldCheck size={21} /></div>
        <form onSubmit={save}>
          <div className="field"><label>Geçerli Olacağı Gün</label><input type="date" required value={effectiveDate} onChange={event => setEffectiveDate(event.target.value)} /></div>
          <div className="field"><label>Çalışma Günleri</label><div className="weekday-options">{[1, 2, 3, 4, 5, 6, 0].map(day => <label key={day}><input type="checkbox" checked={form.workdays.includes(day)} onChange={() => toggleDay(day)} /> {dayLabel(day)}</label>)}</div></div>
          <div className="form-grid"><div className="field"><label>Normal Giriş</label><input type="time" required value={form.startTime} onChange={event => setForm({ ...form, startTime: event.target.value })} /></div><div className="field"><label>Normal Çıkış</label><input type="time" required value={form.endTime} onChange={event => setForm({ ...form, endTime: event.target.value })} /></div></div>
          <div className="form-grid"><div className="field"><label>Yemek Molası (dakika)</label><input type="number" min="0" step="1" required value={form.breakMinutes} onChange={event => setForm({ ...form, breakMinutes: event.target.value })} /></div><div className="field"><label>Günlük Hedef (saat)</label><input type="number" min="0.25" step="0.25" required value={Number(form.dailyTargetMinutes) / 60} onChange={event => setForm({ ...form, dailyTargetMinutes: Number(event.target.value) * 60 })} /></div></div>
          <div className="form-grid"><div className="field"><label>Maaşın Bölüneceği Gün</label><input type="number" min="1" max="31" step="1" required value={form.salaryDays} onChange={event => setForm({ ...form, salaryDays: event.target.value })} /></div><div className="field"><label>Mesai Ücreti (TL/saat)</label><input type="number" min="0" step="0.01" required value={form.overtimeRate} onChange={event => setForm({ ...form, overtimeRate: event.target.value })} /></div></div>
          <div className="form-grid"><div className="field"><label>Mesai Yuvarlama</label><select value={form.overtimeRoundMinutes} onChange={event => setForm({ ...form, overtimeRoundMinutes: Number(event.target.value) })}><option value={15}>15 dakika yukarı</option><option value={30}>30 dakika yukarı</option><option value={60}>60 dakika yukarı</option></select></div><div className="field"><label>Kesinti Sırası</label><select value={form.deductionOrder} onChange={event => setForm({ ...form, deductionOrder: event.target.value })}><option value="extra-first">Önce ek hakediş, sonra mesai</option><option value="overtime-first">Önce mesai, sonra ek hakediş</option></select></div></div>
          <label className="settings-check"><input type="checkbox" checked={form.allowBankDeduction} onChange={event => setForm({ ...form, allowBankDeduction: event.target.checked })} /><span>Ek hakediş ve mesai yetmezse banka tutarından da düş</span></label>
          <label className="settings-check"><input type="checkbox" checked={form.carryForward} onChange={event => setForm({ ...form, carryForward: event.target.checked })} /><span>Karşılanamayan kesintiyi sonraki aya devret</span></label>
          <p className="help-text">Ödeme kalemleri sıfırın altına inmez. Personelin kendi mesai tarifesi varsa genel tarifenin yerine kullanılır.</p>
          <button className="primary" type="submit"><Check size={17} /> Kuralları Kaydet</button>
        </form>
      </section>
      <section className="panel settings-card company-card">
        <div className="panel-head"><div><h2>Şirketler</h2><p>Personel kartında seçilecek şirketleri yönetin.</p></div><Users size={21} /></div>
        <form className="company-form" onSubmit={submitCompany}>
          <div className="field"><label>{editingCompany ? 'Şirket Adını Düzenle' : 'Yeni Şirket Adı'}</label><input required maxLength={120} value={companyName} onChange={event => setCompanyName(event.target.value)} placeholder="Demo Şirket" /></div>
          <div className="company-form-actions"><button className="primary" type="submit">{editingCompany ? <Check size={17} /> : <Plus size={17} />}{editingCompany ? 'Değişikliği Kaydet' : 'Şirket Ekle'}</button>{editingCompany && <button className="secondary" type="button" onClick={cancelCompanyEdit}>Vazgeç</button>}</div>
        </form>
        <div className="company-list-head"><strong>Kayıtlı Şirketler</strong><span>{companies.length} şirket</span></div>
        <div className="company-list">{companies.length ? companies.map(company => {
          const linkedCount = employees.filter(item => item.company === company).length;
          return <div className="company-row" key={company}><div><strong>{company}</strong><small>{linkedCount ? `${linkedCount} personel bağlı` : 'Henüz personel bağlı değil'}</small></div><div className="company-row-actions"><button type="button" className="icon-button" aria-label={`${company} düzenle`} title={linkedCount ? 'Önce bağlı personelin şirketini değiştirin' : 'Şirketi düzenle'} disabled={linkedCount > 0} onClick={() => { setEditingCompany(company); setCompanyName(company); }}><Pencil size={16} /></button><button type="button" className="icon-button danger-icon" aria-label={`${company} sil`} title={linkedCount ? 'Önce bağlı personelin şirketini değiştirin' : 'Şirketi sil'} disabled={linkedCount > 0} onClick={() => { if (editingCompany === company) cancelCompanyEdit(); onDeleteCompany(company); }}><Trash2 size={16} /></button></div></div>;
        }) : <div className="company-empty">Henüz şirket eklenmedi.</div>}</div>
        <p className="help-text company-note">Personel bağlı bir şirketi düzenlemek veya silmek için önce personel kartlarındaki şirket seçimini değiştirin.</p>
      </section>
      <section className="panel settings-card"><div className="panel-head"><div><h2>Firebase Bağlantısı</h2><p>Personel ve puantaj kayıtları ortak şirket verisinde tutulur.</p></div><Cloud size={21} /></div><div className="connection-line"><span>Durum</span><strong>Bağlı</strong></div><div className="connection-line"><span>Hesap</span><strong>{email}</strong></div><div className="connection-line"><span>Uygulama sürümü</span><strong>{APP_VERSION}{window.desktop ? ' · Masaüstü' : ' · Web'}</strong></div></section>
      {legacyCount > 0 && <section className="panel settings-card"><div className="panel-head"><div><h2>Eski Yerel Kayıtlar</h2><p>Önceki deneme sürümünden kalan {legacyCount} kayıt</p></div><Cloud size={21} /></div><p className="help-text">Kayıtlar Firebase'e aktarılınca yerel kopya temizlenir. Aynı kimlikli bulut kayıtları güncellenir.</p><button className="primary" onClick={onImportLegacy}>Firebase'e Aktar</button></section>}
    </div>
  </>;
}

if ('serviceWorker' in navigator && !window.desktop && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* çevrimdışı önbellek isteğe bağlıdır */ }); });
}
// Web sürümünde yayımlanan yeni sürümü fark edip yenileme önerir (masaüstünde güncelleme ekranı var).
const currentBuild = () => document.querySelector('script[type="module"][src*="/assets/"]')?.getAttribute('src')?.split('/').pop() || null;
function UpdateBanner() {
  const [ready, setReady] = useState(false);
  const [desktopVersion, setDesktopVersion] = useState(null);
  useEffect(() => {
    if (!window.desktop?.onUpdateReady) return;
    window.desktop.getUpdateReady?.().then(version => { if (version) setDesktopVersion(version); });
    return window.desktop.onUpdateReady(version => setDesktopVersion(version));
  }, []);
  useEffect(() => {
    const build = currentBuild();
    if (window.desktop || !build || !/^https?:$/.test(location.protocol)) return;
    let stopped = false, checking = false;
    async function check() {
      if (stopped || checking || document.visibilityState === 'hidden' || !navigator.onLine) return;
      checking = true;
      try {
        const html = await fetch(`./index.html?v=${Date.now()}`, { cache: 'no-store' }).then(response => response.ok ? response.text() : '');
        const latest = html.match(/<script[^>]+type="module"[^>]+src="[^"]*\/assets\/([^"]+)"/)?.[1];
        if (latest && latest !== build) { setReady(true); stopped = true; }
      } catch { /* bağlantı yoksa sonra yeniden denenir */ }
      checking = false;
    }
    const first = setTimeout(check, 20_000);
    const timer = setInterval(check, 5 * 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    return () => { stopped = true; clearTimeout(first); clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', check); window.removeEventListener('online', check); };
  }, []);
  if (desktopVersion) return <div className="update-banner" role="status"><div><strong>{desktopVersion} sürümü hazır</strong><span>Kaydedilmemiş işinizi bitirip yeniden başlatın. Kapatınca da kurulur.</span></div><button className="primary" onClick={() => window.desktop.installUpdate()}>Yeniden Başlat</button><button className="icon-button" aria-label="Sonra" onClick={() => setDesktopVersion(null)}><X size={16} /></button></div>;
  if (!ready) return null;
  return <div className="update-banner" role="status"><div><strong>Yeni sürüm hazır</strong><span>Kaydedilmemiş bir işiniz yoksa yenileyin.</span></div><button className="primary" onClick={() => location.reload()}>Yenile</button><button className="icon-button" aria-label="Sonra" onClick={() => setReady(false)}><X size={16} /></button></div>;
}

createRoot(document.getElementById('root')).render(<>{SANDBOX && <div className="sandbox-banner">DENEME ORTAMI · Canlı verilere bağlı değil, yapılan değişiklikler yalnız bu bilgisayarda kalır</div>}<App /><UpdateBanner /></>);
