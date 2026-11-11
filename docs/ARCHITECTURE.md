# Architecture / Mimari

## English

```text
Windows/Web UI (Electron + React)
        │ Firebase Auth + Firestore SDK
        ▼
Firebase Authentication ── Firestore Rules ── Firestore
        ▲                                      ▲
        │ USB serial                           │ HTTPS REST
        │                                      │
ESP32 + RC522 + TFT + RTC ── persistent offline queue
```

- The UI manages employees, permissions, attendance, cards and reports.
- Firestore rules are the authorization boundary.
- In USB mode, the ESP32 sends card UIDs to the desktop/web application.
- In Wi-Fi mode, the ESP32 uses a restricted terminal account and sends attendance events through Firebase REST endpoints.
- Offline scans are stored in LittleFS with monotonic sequence numbers and replayed after connectivity returns.
- Card ownership, employment state, timestamps and manual corrections are revalidated by Firestore rules.

## Türkçe

- Arayüz personel, yetki, puantaj, kart ve rapor yönetimini yapar.
- Asıl yetkilendirme sınırı Firestore kurallarıdır.
- USB modunda ESP32 kart UID'sini masaüstü/web uygulamasına gönderir.
- Wi-Fi modunda ESP32 yalnız Kart Okutma yetkisi olan cihaz hesabıyla Firebase REST uçlarına bağlanır.
- İnternetsiz okutmalar LittleFS içinde artan sıra numarasıyla saklanır ve bağlantı gelince gönderilir.
- Kart sahibi, personelin çalışma durumu, zaman ve elle düzeltme yarışları Firestore kurallarında yeniden denetlenir.

## Safety boundary / Güvenlik sınırı

This is an attendance terminal, not a physical motion controller. Credentials sent to the ESP32 are stored locally in NVS and are never returned in status output. Real deployments must use a dedicated least-privilege terminal account.
