// Kart okuyucu yazılımı (2.x) için kaynak denetimleri: donanım olmadan doğrulanabilen inceleme düzeltmeleri.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const firmware = await readFile(new URL('../firmware/kart-okuyucu/kart-okuyucu.ino', import.meta.url), 'utf8');
const code = firmware.replace(/\/\/.*$/gm, '');   // yorumlar hariç
const fn = name => {
  const start = code.indexOf(name);
  assert.ok(start >= 0, `${name} bulunamadı`);
  let depth = 0, i = code.indexOf('{', start);
  for (let j = i; j < code.length; j++) {
    if (code[j] === '{') depth++;
    if (code[j] === '}' && --depth === 0) return code.slice(start, j + 1);
  }
  return code.slice(start);
};

test('C/D/E: no absolute millis() deadlines — every timeout is a wrap-safe elapsed-time comparison', () => {
  // millis() + X ile hesaplanan son tarih ve millis() ile doğrudan büyük/küçük karşılaştırması yok.
  assert.doesNotMatch(code, /millis\(\)\s*\+/);
  assert.doesNotMatch(code, /millis\(\)\s*(<|>|<=|>=)\s*\w/);
  assert.doesNotMatch(code, /\w\s*(<|>|<=|>=)\s*millis\(\)/);
  assert.doesNotMatch(code, /nextAt|assignUntil/);
  // Ağ bekleme süresi başlangıç + süre olarak tutulur.
  assert.match(fn('bool netReady()'), /millis\(\) - net->waitFrom >= net->waitMs/);
  // Kart Atama penceresi: başlangıç + etkin bayrağı, süre dolunca kapanır.
  assert.match(code, /assignActive && millis\(\) - assignAt < ASSIGN_HOLD_MS/);
  assert.match(code, /if \(assignActive && now - assignAt >= ASSIGN_HOLD_MS\) assignActive = false;/);
  assert.match(code, /portalSavePending && now - portalSaveAt >= 2500/);
});

test('E: setup AP retries the saved Wi-Fi, closes as soon as it connects (auto mode) and has idle + hard limits', () => {
  const setup = fn('case WS_SETUP:');
  assert.match(fn('void startSetupAP(bool manual)'), /WiFi\.mode\(WIFI_AP_STA\)/);
  assert.match(setup, /!setupManual && cfg\.ssid\.length\(\) && WiFi\.status\(\) == WL_CONNECTED/);
  assert.match(setup, /now - setupRetryAt >= SETUP_STA_RETRY_MS/);
  assert.match(setup, /now - setupSince >= \(setupManual \? SETUP_MANUAL_MAX_MS : SETUP_AUTO_MAX_MS\)/);
  // Boşta kalma telefonun bağlı olmasına değil sayfa isteklerine göre ölçülür.
  assert.doesNotMatch(code, /softAPgetStationNum/);
  assert.match(code, /constexpr unsigned long SETUP_AUTO_MAX_MS = 600000;/);
  // Kurulum ağı şifresi yalnız kurulum ekranında çizilir.
  assert.equal((code.match(/cfg\.apPass, 86/g) || []).length, 1);
  assert.match(fn('case SCR_SETUP:'), /cfg\.apGenerated/);
});

test('F: queue records carry increasing sequence numbers; progress (qdone) is persisted only after commit/fail; compaction never writes NVS', () => {
  assert.match(code, /constexpr uint8_t QMAGIC_V2 = 0xA5;/);
  assert.match(code, /constexpr uint8_t QMAGIC = 0xA6;/);
  assert.doesNotMatch(fn('bool qCompact()'), /prefs\.|qSaveDone|qhead/);
  assert.match(fn('bool qCompact()'), /r\.id <= qDone\) continue/);
  // Kuyruk yeniden yazımı her kaydı ve dosya boyutunu doğrular; hata olursa eski kuyruk korunur.
  assert.match(fn('bool qCompact()'), /out\.write\(\(const uint8_t \*\)&r, sizeof\(r\)\) != sizeof\(r\)\) \{ ok = false; break; \}/);
  assert.match(fn('bool qCompact()'), /if \(!ok\) \{ LittleFS\.remove\("\/queue\.tmp"\); return false; \}/);
  assert.match(fn('bool qMigrateV2()'), /out\.write\(\(const uint8_t \*\)&r, sizeof\(r\)\) != sizeof\(r\)\) \{ ok = false; break; \}/);
  assert.match(fn('bool qMigrateV2()'), /if \(!qReplaceQueue\(n\)\) return false;\s*prefs\.remove\("qhead"\)/);
  const replace = fn('bool qReplaceQueue(');
  assert.match(replace, /size != expectedRecords \* sizeof\(QRec\)/);
  assert.match(replace, /!LittleFS\.remove\("\/queue\.bin"\)\) \{ LittleFS\.remove\("\/queue\.tmp"\); return false; \}/);
  assert.match(replace, /fsOk = false; return false;/);
  assert.match(fn('void qInit()'), /if \(!qMigrateV2\(\)\) \{ fsOk = false; return; \}/);
  assert.match(fn('void qInit()'), /size % sizeof\(QRec\) && !qCompact\(\)\) fsOk = false/);
  assert.match(fn('bool qPeek(QRec &r)'), /qValid\(r\) && r\.id > qDone/);
  const pop = fn('bool qPop(uint32_t seq)');
  assert.match(pop, /if \(seq > qDone && !qSaveDone\(seq\)\).*return false/);
  assert.match(pop, /if \(qHead < qTotal\) qHead\+\+/);
  // queue.bin silinemezse sayaçlar sıfırlanmaz; aksi halde yeni kayıtlar kayar ve gönderilmeden silinir.
  assert.match(pop, /if \(qHead >= qTotal && LittleFS\.remove\("\/queue\.bin"\)\) \{ qHead = 0; qTotal = 0; \}/);
  assert.match(fn('bool qPush(QRec &r)'), /size % sizeof\(QRec\) && !qCompact\(\)\) fsOk = false/);
  const recover = fn('bool failedRecover()');
  assert.match(recover, /LittleFS\.exists\("\/failed\.txt"\) \|\| !LittleFS\.exists\("\/failed\.tmp"\)\) return true/);
  assert.match(fn('bool addFailed('), /if \(!failedRecover\(\)\) \{ xSemaphoreGive\(qMutex\); return false; \}/);
  assert.match(fn('void countFailed()'), /failedRecover\(\);/);
  // Açılışta tek kopya olan queue.tmp geri adlandırılamazsa kuyruk yazmaya kapatılır.
  assert.match(fn('void qInit()'), /if \(!LittleFS\.rename\("\/queue\.tmp", "\/queue\.bin"\)\) \{ fsOk = false; return; \}/);
  // Geçici okuma hatası geçerli kaydı atlatmaz.
  assert.match(fn('bool qPeek(QRec &r)'), /if \(!readOk\) \{ ok = false; break; \}/);
  assert.match(fn('bool qPush(QRec &r)'), /r\.id = qNextSeq/);
  assert.match(fn('void qInit()'), /qMigrateV2\(\)/);
  assert.match(fn('void qInit()'), /qNextSeq = maxSeq \+ 1/);
  // Başarısız listesine alınan kayıt da ilerlemeyi kalıcı yazar.
  // Başarısız listesine kalıcı yazılamayan kayıt kuyruktan düşürülmez.
  assert.match(code, /if \(!addFailed\(r, failReason\)\) \{ netState = NET_OFFLINE; netBackoff\(\); continue; \}[\s\S]{0,120}qPop\(r\.id\)/);
  assert.match(code, /if \(!addFailed\(r, "denied"\)\) \{ netState = NET_OFFLINE; netBackoff\(\); break; \}[\s\S]{0,120}qPop\(r\.id\)/);
  const failed = fn('bool addFailed(');
  assert.match(failed, /f\.write\(\(const uint8_t \*\)line, len\) == \(size_t\)len/);
  assert.match(failed, /if \(ok\) failedCount = failedCount \+ 1;/);
  assert.match(failed, /return ok;/);
});

test('production REST compatibility: firmware never starts or attaches a Firestore read-write transaction', () => {
  const scan = fn('Outcome processScan(');
  assert.doesNotMatch(scan, /newTransaction|transaction|rollback\(/);
  assert.match(scan, /httpPost\(net->base \+ ":batchGet"/);
  assert.match(scan, /httpPost\(net->base \+ ":commit"/);
});

test('production REST compatibility: firmware rereads stale state, retains precondition conflicts and never redirects a scan after reassignment', () => {
  const scan = fn('Outcome processScan(');
  const task = fn('void netTask(');
  assert.match(scan, /String &expectedOwner/);
  assert.match(scan, /qOwnerLoad\(r\.id\) != expectedOwner && !qOwnerSave\(r\.id, expectedOwner\)/);
  assert.ok(scan.indexOf('expectedOwner = employeeId') < scan.indexOf('qOwnerSave(r.id, employeeId)'));
  assert.match(scan, /qOwnerSave\(r\.id, employeeId\)/);
  assert.match(task, /retainedOwnerSeq == r\.id \? retainedOwner : qOwnerLoad\(r\.id\)/);
  assert.match(task, /if \(expectedOwner\.length\(\)\) retainedOwner = expectedOwner/);
  const pop = fn('bool qPop(uint32_t seq)');
  assert.match(pop, /if \(seq > qDone && !qSaveDone\(seq\)\).*return false/);
  assert.ok(pop.indexOf('qSaveDone(seq)') < pop.indexOf('qDone = seq'));
  assert.ok(pop.indexOf('qSaveDone(seq)') < pop.indexOf('prefs.remove("qowner")'));
  assert.match(pop, /prefs\.remove\("qowner"\)/);
  assert.match(fn('bool qSaveDone(uint32_t seq)'), /prefs\.putUInt\("qdone", seq\) == sizeof\(uint32_t\)/);
  assert.match(scan, /if \(!mapped \|\| !employeeId\.length\(\)\) \{ if \(expectedOwner\.length\(\)\) return OUT_MOVED;/);
  assert.match(scan, /expectedOwner\.length\(\) && employeeId != expectedOwner/);
  assert.match(scan, /if \(code == 400 \|\| code == 404 \|\| code == 409\) return OUT_RETRY;/);
  assert.match(scan, /lastCommitCode = code;/);
  assert.match(code, /constexpr uint8_t BAD_COMMIT_CYCLES = 3;/);
  assert.match(task, /o == OUT_RETRY && \(lastCommitCode == 400 \|\| lastCommitCode == 404\)/);
  assert.match(task, /\+\+badCommitCycles >= BAD_COMMIT_CYCLES\) o = OUT_BAD/);
  assert.match(task, /if \(failedAddedSeq != r\.id\) \{\s*if \(!addFailed\(r, failReason\)\)[^\n]*\n\s*failedAddedSeq = r\.id;/);
  assert.doesNotMatch(code, /:rollback/);
  assert.match(task, /for \(uint8_t attempt = 0; attempt < 3; attempt\+\+\)/);
  assert.match(task, /o == OUT_RETRY \|\| \(o == OUT_DENIED && !readStage\)/);
});

test('A/B: firmware moves replays of reassigned cards and hand-corrected days to the failed list with a clear reason', () => {
  const scan = fn('Outcome processScan(');
  assert.match(scan, /assignedAt = fsField\(s, f, "assignedAt", "timestampValue"\)/);
  assert.match(scan, /if \(offline && \(!assignedUtc \|\| r\.epoch < assignedUtc\)\) return OUT_MOVED;/);
  assert.match(scan, /if \(eSource != "offline" \|\| !eCard\.length\(\) \|\| \(editedUtc && r\.epoch <= editedUtc\)\) return OUT_EDITED;/);
  assert.match(code, /case OUT_MOVED: failReason = "moved"/);
  assert.match(code, /case OUT_EDITED: failReason = "edited"/);
});

test('G: config is applied through a two-slot NVS write flipped by a single pointer', () => {
  const save = fn('bool saveConfigAtomic(const Config &next)');
  assert.ok(save.indexOf('slot.putBool("ok", true)') < save.indexOf('prefs.putUChar("cslot", target)'));
  assert.doesNotMatch(code, /saveString\(/);
});
