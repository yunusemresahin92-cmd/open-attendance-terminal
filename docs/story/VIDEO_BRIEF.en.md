# Video Brief — English

## Goal

Produce a clear 2–3 minute technical introduction explaining the problem, the engineering journey and the working hardware/software result of Open Attendance Terminal.

## Story arc

1. **Problem:** Record employee entry/exit with RFID and manage attendance/payroll in one system.
2. **First solution:** Electron + React, Firebase and a USB RFID reader.
3. **Growth:** Card inventory, permissions, reports, display and real-time clock.
4. **Hard part:** Standalone Wi-Fi operation without losing scans during internet outages.
5. **Engineering:** Persistent queue, safe replay, reassignment races and manual-correction protection.
6. **Result:** USB/Wi-Fi ESP32 terminal, desktop/web UI and tested Firestore rules.
7. **Open source:** A company-neutral GPL edition available to everyone.
8. **Next:** Optional buzzer assembly and community contributions.

## Required footage

- Desktop application using synthetic demo data
- Employee, timesheet, card assignment and reporting screens
- ESP32 boot screen
- RFID scan with clock-in/clock-out feedback
- Wi-Fi and offline queue status
- A scan while offline followed by the queue draining after reconnection
- GitHub repository and verified test result

Never show a real employee, card UID, Wi-Fi credential, Firebase project identifier or company logo.

## Style

- 16:9, 1080p
- Clean dark background with blue accents
- English narration and subtitles
- Honest working footage, not fictional UI

## Claude/Remotion task

Use `PROJECT_STORY.en.md`, `ARCHITECTURE.md`, README and the supplied screen recordings. Preserve the original footage. First produce a time-coded storyboard and narration script; create the Remotion project only after approval. Mask any readable names or card values in demo footage.
