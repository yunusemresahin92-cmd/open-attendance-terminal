# Open Attendance Terminal

[Türkçe](README.tr.md) · **English**

A free and open-source attendance, payroll and RFID terminal project built with **Electron + React**, **Firebase** and an optional **ESP32/RC522 Wi-Fi terminal**.

> This repository is a clean, company-neutral public edition. It contains no production database, employee record, Wi-Fi password, service account, private key or company branding.

## Features

- Employee and company management
- Daily attendance and working-hour records
- Payroll, overtime and missing-hour calculations
- XLSX reports
- Role-based access control enforced by Firestore rules
- RFID card inventory, assignment and immutable card history
- USB RFID reader mode
- Standalone ESP32 Wi-Fi terminal mode
- Persistent offline scan queue with power-loss recovery
- Safe replay of delayed scans after connectivity returns
- Firebase Emulator demo environment
- Windows desktop application and installable web/PWA interface

## Hardware

The optional terminal uses:

- ESP32 Dev Module
- RC522 RFID reader
- ST7735S 1.8-inch TFT
- DS3231 RTC
- Optional protected buzzer stage

See [`docs/en/INSTALLATION.md`](docs/en/INSTALLATION.md) and [`firmware/kart-okuyucu/KURULUM.md`](firmware/kart-okuyucu/KURULUM.md).

## Quick start — local demo

Requirements: Node.js 24.12+ and Java 21 for Firebase Emulator tests.

```bash
npm install
npm run deneme
```

The demo uses only local Firebase emulators and synthetic people/cards. It does not connect to a production Firebase project.

## Use your own Firebase project

1. Copy `.env.example` to `.env.local`.
2. Enter your own Firebase **Web App** configuration.
3. Enable Email/Password Authentication and Firestore.
4. Deploy `firestore.rules` to your project.
5. Run `npm run build` or `npm run desktop`.

Never commit service-account JSON, private keys, real employee data or device passwords.

## Development

```bash
npm install
npm test
npm run build
npm run test:rules
npm run dist:win
```

## Project status

The software and ESP32 firmware originated from a real deployed attendance terminal and include extensive unit, rules and flow tests. This public edition was independently separated from the production repository and uses a clean Git history. Hardware installation still requires normal electrical checks and safe buzzer driver wiring.

The buzzer is optional and documented as a later assembly stage; the core reader works without it.

## Security

Read [`SECURITY.md`](SECURITY.md). Firestore Web App identifiers are not private credentials, but access still depends on Authentication and the included Firestore rules. Never place Firebase Admin credentials in the desktop app or firmware.

## License

Public desktop builds do not contact an update server. Automatic updates are disabled by default and can be enabled by maintainers only after packaging with a trusted provider and setting `OPEN_ATTENDANCE_UPDATES=1`.

GNU GPL v3. You may use, study, modify and redistribute the project under the same license. See [`LICENSE`](LICENSE).

## Project story

Bilingual project history and video-production material are available under [`docs/story`](docs/story).
