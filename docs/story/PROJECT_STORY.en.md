# Project Story

## Beginning

The project started as a need for a single system where employees could clock in and out with RFID cards while attendance and payroll reports were managed from one application.

## Evolution

1. An Electron + React desktop interface and Firebase data model were created.
2. Employee records, salary history, overtime, missing-hour calculations and XLSX reports were added.
3. Firestore rules implemented menu-level and operation-level authorization.
4. An ESP32 + RC522 USB reader was integrated with the desktop application.
5. Card inventory, assignment, return, lost-card handling and immutable history were added.
6. The terminal gained ST7735S display and DS3231 clock support.
7. The ESP32 was upgraded to submit attendance without a connected computer over Wi-Fi.
8. A power-loss-resistant offline queue was added for internet outages.
9. Fail-closed handling was developed for card return, reassignment, manual corrections and concurrent-write races.
10. Wi-Fi, trusted time, Firebase connectivity and an empty queue were verified on the real device.

## Current status

- Desktop and web applications are working.
- The ESP32 operates in USB or standalone Wi-Fi mode.
- Scans are retained while offline and submitted after connectivity returns.
- The test suite covers unit logic, Firestore authorization and realistic flow simulations.
- The buzzer is optional and remains a later physical assembly step.

## Public edition

No company name, employee record, card UID, Firebase identifier or password was copied from the production system. The public edition uses a new clean Git history, generic branding, example configuration and synthetic emulator data.
