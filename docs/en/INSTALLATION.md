# Installation

[Türkçe kurulum](../../KURULUM.md)

## Requirements

- Node.js 24.12+
- npm
- A Firebase project with Firestore and Email/Password Authentication
- Java 21 for Firestore Emulator rule tests
- Windows x64 to build the Windows installer

## Local demo

```bash
npm install
npm run deneme
```

This starts local Firebase Authentication and Firestore emulators, loads synthetic employees/cards and serves the application at `http://127.0.0.1:5174`. It does not contact a production Firebase project.

Demo account: `demo@example.local` / `deneme123`. Do not reuse this password in a real deployment.

## Configure your Firebase project

1. Create a Firebase project.
2. Enable Email/Password Authentication.
3. Create a Firestore database.
4. Register a Firebase Web App.
5. Copy `.env.example` to `.env.local`.
6. Fill the `VITE_FIREBASE_*` values with your Web App configuration.

Do not commit `.env.local`, service-account JSON or private keys.

## Verify

```bash
npm test
npm run build
npm run test:rules
```

## Deploy rules and hosting

Set `FIREBASE_PROJECT_ID` to your own project before running the deployment helpers. This value is read from the shell environment, not from `.env.local`.

```bash
# Git Bash / macOS / Linux
export FIREBASE_PROJECT_ID='your-project-id'
# Windows PowerShell
# $env:FIREBASE_PROJECT_ID = 'your-project-id'
npx firebase-tools@15.35.0 login
npm run firebase:rules
npm run firebase:deploy
```

## First administrator

Create the first account in the application, find its UID under Firebase Authentication, then set `admin: true` in the matching Firestore `users/{UID}` document. Manage later permissions through the application.

## Desktop package

```bash
npm run desktop
npm run dist:win
```

## ESP32 terminal

The detailed hardware guide is currently maintained in Turkish at [`firmware/kart-okuyucu/KURULUM.md`](../../firmware/kart-okuyucu/KURULUM.md). It includes the pin map, serial protocol, Wi-Fi provisioning and offline queue behavior.

The buzzer is optional. Never drive an active buzzer directly from a 3.3 V GPIO; use the documented protected transistor stage.
