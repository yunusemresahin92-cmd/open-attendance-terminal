// Wi-Fi kart okuyucunun (firmware 2.1) Firestore REST işlemi için başvuru uygulaması.
// Cihaz yazılımı (firmware/kart-okuyucu/kart-okuyucu.ino) aynı istekleri aynı sırayla gönderir:
//   1) :batchGet [cardUids/UID] -> kart sahibi
//   2) :batchGet [cardDirectory/EMP, entries/ID, clockIns/ID]
//   3) :commit (yazım varsa)
// Canlı Firestore, Firebase Auth kimliğiyle batchGet.newTransaction isteğini 403 reddeder.
// Commit atomiktir; kart sahipliği ve elle düzeltilmiş gün koruması ayrıca sunucu kurallarında doğrulanır.
// Bu dosya uygulamada kullanılmaz; emülatör testi (device-rest-flow.test.js) kuralların bu istekleri kabul ettiğini doğrular.
import { decideClock } from './clock.js';
import { isEmployeeLeaving } from './cards.js';

export const OFFLINE_AFTER_SECONDS = 90;   // bu süreden eski okutma çevrimdışı (scanAt ile) gönderilir
export const MAX_REPLAY_SECONDS = 7 * 86400 - 600; // kuralların 7 günlük sınırına 10 dk pay
export const BAD_COMMIT_CYCLES = 3; // aynı kayıtta commit 400/404 bu kadar kuyruk çevrimi sürerse "bad"

const pad = value => String(value).padStart(2, '0');
// Türkiye saati sabit UTC+3 (yaz saati yok); cihaz da aynı hesabı yapar.
export function turkeyParts(epochSeconds) {
  const local = new Date((epochSeconds + 3 * 3600) * 1000);
  return {
    date: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
  };
}
export const isoUtc = epochSeconds => new Date(epochSeconds * 1000).toISOString().replace('.000Z', 'Z');

const str = value => ({ stringValue: value });
function fieldValue(value) {
  if (value && typeof value === 'object') return value;
  return value === null ? { nullValue: null } : str(value);
}
function fieldsOf(record) { return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, fieldValue(value)])); }
function readField(document, key) {
  const value = document?.fields?.[key];
  if (!value) return undefined;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return value.timestampValue;
  return undefined;
}
const plain = (document, keys) => document ? Object.fromEntries(keys.map(key => [key, readField(document, key)]).filter(([, value]) => value !== undefined)) : null;

// Karar ve belge kayıtlarından commit yazımlarını üretir. offline: { scanAt: ISO } veya null.
export function deviceWrites({ docPrefix, id, employeeId, date, cardUid, decision, offline, clockInSource }) {
  const marks = offline ? { source: 'offline', scanAt: { timestampValue: offline.scanAt } } : {};
  const clockName = `${docPrefix}/clockIns/${id}`;
  const entryName = `${docPrefix}/entries/${id}`;
  if (decision.action === 'in') {
    return [{
      update: { name: clockName, fields: fieldsOf({ id, employeeId, date, cardUid, start: decision.start, ...marks }) },
      updateTransforms: [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }],
      currentDocument: { exists: false },
    }];
  }
  if (decision.action === 'out') {
    const inherit = !offline && clockInSource === 'offline' ? { source: 'offline' } : {};
    return [
      { update: { name: entryName, fields: fieldsOf({ id, employeeId, date, status: 'present', start: decision.start, end: decision.end, rate: null, cardUid, ...marks, ...inherit }) }, currentDocument: { exists: false } },
      { delete: clockName },
    ];
  }
  if (decision.action === 'extend') {
    const fields = { end: decision.end, cardUid, ...marks };
    return [{ update: { name: entryName, fields: fieldsOf(fields) }, updateMask: { fieldPaths: Object.keys(fields) }, currentDocument: { exists: true } }];
  }
  return [];
}

// Tek okutmayı işler. fetch: global fetch benzeri; baseUrl: .../v1/projects/P/databases/(default)/documents
// Sonuç: { action, name, start, end, ... } veya { error: 'denied' | 'readDenied' | 'http', status }.
export async function deviceClockScan({ fetch, baseUrl, docPrefix, token, cardUid, scanEpoch, nowEpoch, forceOffline = false, beforeCommit = null, retryCount = 0, expectedEmployeeId = '', ownerState = null }) {
  expectedEmployeeId = ownerState?.employeeId || expectedEmployeeId;
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  const post = async (path, body) => {
    const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const text = await response.text();
    let json = null; try { json = JSON.parse(text); } catch { json = null; }
    return { status: response.status, json };
  };
  const age = nowEpoch - scanEpoch;
  if (age > MAX_REPLAY_SECONDS) return { error: 'old' };
  const offline = forceOffline || age > OFFLINE_AFTER_SECONDS ? { scanAt: isoUtc(scanEpoch) } : null;
  const first = await post(':batchGet', { documents: [`${docPrefix}/cardUids/${cardUid}`] });
  if (first.status === 403) return { error: 'readDenied', status: 403 };
  if (first.status !== 200) return { error: 'http', status: first.status };
  const mappingDoc = first.json.find(item => item.found)?.found;
  if (!mappingDoc) {
    if (expectedEmployeeId) return { error: 'moved', cardUid, employeeId: expectedEmployeeId };
    return { action: 'unknown', cardUid };
  }
  const employeeId = readField(mappingDoc, 'employeeId');
  if (expectedEmployeeId && employeeId !== expectedEmployeeId) return { error: 'moved', cardUid, employeeId: expectedEmployeeId };
  const stableEmployeeId = expectedEmployeeId || employeeId;
  if (ownerState && !ownerState.employeeId) ownerState.employeeId = stableEmployeeId;
  // Kart okutmadan sonra başkasına verildiyse okutma yeni sahibine yazılmaz (kurallar da reddeder): başarısız listesine.
  const assignedAt = readField(mappingDoc, 'assignedAt');
  if (offline && (!assignedAt || scanEpoch * 1000 < Date.parse(assignedAt))) return { error: 'moved', cardUid, employeeId };
  const now = turkeyParts(scanEpoch);
  const id = `${employeeId}_${now.date}`;
  const second = await post(':batchGet', {
    documents: [`${docPrefix}/cardDirectory/${employeeId}`, `${docPrefix}/entries/${id}`, `${docPrefix}/clockIns/${id}`],
  });
  if (second.status === 403) return { error: 'denied', status: 403, stage: 'read' };
  if (second.status !== 200) return { error: 'http', status: second.status };
  const found = Object.fromEntries(second.json.filter(item => item.found).map(item => [item.found.name.split('/').at(-2), item.found]));
  const person = plain(found.cardDirectory, ['name', 'active', 'endDate']);
  const name = person?.name || '';
  if (!person || isEmployeeLeaving(person, now.date)) return { action: 'left', cardUid, employeeId, name };
  const entry = plain(found.entries, ['status', 'start', 'end', 'source', 'cardUid', 'editedAt']);
  const clockIn = plain(found.clockIns, ['start', 'source']);
  const decision = decideClock({ entry, clockIn, now });
  // Gün okutmadan sonra elle düzeltilmiş ya da elle (kartsız) girilmişse çevrimdışı okutma üstüne yazılmaz.
  if (offline && decision.action === 'extend' && (entry.source !== 'offline' || !entry.cardUid || (entry.editedAt && scanEpoch * 1000 <= Date.parse(entry.editedAt)))) {
    return { error: 'edited', cardUid, employeeId, name };
  }
  const writes = deviceWrites({ docPrefix, id, employeeId, date: now.date, cardUid, decision, offline, clockInSource: clockIn?.source });
  if (!writes.length) return { ...decision, cardUid, employeeId, name, date: now.date, offline: Boolean(offline) };
  if (beforeCommit) await beforeCommit({ retryCount, cardUid, employeeId, date: now.date, decision });
  const commit = await post(':commit', { writes });
  if ([400, 403, 404, 409].includes(commit.status) && retryCount < 2) {
    return deviceClockScan({
      fetch, baseUrl, docPrefix, token, cardUid, scanEpoch, nowEpoch,
      forceOffline: forceOffline || commit.status === 403,
      beforeCommit, retryCount: retryCount + 1, expectedEmployeeId: stableEmployeeId, ownerState,
    });
  }
  if ([400, 404, 409].includes(commit.status)) {
    // 400/404 her kuyruk çevriminde tekrarlıyorsa kayda özgü kalıcı hatadır; kuyruğu günlerce tıkamasın.
    if (ownerState && commit.status !== 409) {
      ownerState.badCommitCycles = (ownerState.badCommitCycles || 0) + 1;
      if (ownerState.badCommitCycles >= BAD_COMMIT_CYCLES) return { error: 'bad', status: commit.status, stage: 'commit' };
    }
    return { error: 'retry', status: commit.status, stage: 'commit' };
  }
  if (commit.status === 403) return { error: 'denied', status: 403, stage: 'commit' };
  if (commit.status !== 200) return { error: 'http', status: commit.status };
  return { ...decision, cardUid, employeeId, name, date: now.date, offline: Boolean(offline) };
}
