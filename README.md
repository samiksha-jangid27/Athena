# Athena

A cross-platform desktop examination and proctoring platform featuring exam integrity monitoring, camera and screen capture, instructor controls, and practical assessment support.

Built with Electron, React (Vite) and a small Express backend.

## What works today

- **Readiness check**: exam instructions, monitoring consent, camera permission check with live preview, and exam-service status.
- **Exam**: multiple-choice questions, question navigation, review flags, a countdown synced to the server clock, confirm-before-submit, and auto-submit when time runs out.
- **Autosave and recovery**: answers are written to local storage immediately and saved to the backend with retries. After a crash, restart or network drop, the attempt resumes with unsaved answers restored.
- **Integrity events**: leaving fullscreen locks answering at once (the backend enforces the lock too). Window focus changes, camera loss and recovery, screen-capture failures and network changes are recorded as timestamped events.
- **Status indicators**: camera, screen snapshots, fullscreen and save state are always visible to the student.
- **Instructor monitor** (`#/instructor`): live attempt list, activity timeline, unlock and +5 minute extension. Extensions reach the student within about 10 seconds, without a reload and without losing answers.
- **Evidence capture (desktop app only)**: while an exam runs, a camera photo and a screenshot are saved about every 30 seconds to `<userData>/evidence/`. Students are told about this before they start.

## Getting started

```bash
cd backend && npm install && cd ../frontend && npm install && cd .. && npm install
```

Development uses two terminals:

```bash
npm run dev        # Vite renderer on http://localhost:5173
npm run electron   # Electron window (starts the backend if it isn't running)
```

You can also run the backend on its own with `npm run backend`. On startup it prints an instructor key for the session; set `ATHENA_INSTRUCTOR_KEY` to use a fixed key instead. Open **Instructor** in the top bar (or `http://localhost:5173/#/instructor`) and enter that key.

Optional backend settings: `PORT` (default 3000) and `ATHENA_EXAM_MINUTES` (default 10). Questions live in `backend/data/questions.json`.

```bash
npm test           # backend + frontend unit tests (node:test)
npm run lint       # ESLint
npm run dist       # production renderer build + electron-builder package
```

## Project layout

```
backend/
  server.js            Express API (student + instructor endpoints)
  lib/attempts.js      Attempt rules: deadlines, locking, validation, scoring
  test/                Backend unit tests
frontend/
  app/app.js           Electron main process (window, permissions, capture, backend launch)
  app/preload.cjs      Narrow, sandboxed preload API (window.athena)
  src/components/      Readiness, ExamScreen, ResultScreen, InstructorDashboard
  src/hooks/           useExamAttempt (autosave/recovery/heartbeat), useCamera
  src/lib/exam.js      Pure helpers for timers, retries and persistence, with tests
  src/services/api.js  Backend client
```

## Security model

- The renderer runs with `contextIsolation`, `sandbox` and no Node integration. It only reaches the main process through five validated IPC calls.
- Only camera (video) and fullscreen permissions are granted. Navigation and new windows are blocked.
- **The backend is the authority** on attempt status, deadlines, answer validity and locks. Each attempt has a random bearer token, and the server stores only its hash. React mirrors server state but does not enforce it.
- Instructor endpoints require the instructor key, compared in constant time.
- Runtime student data (`backend/data/sessions.json`) and evidence folders are git-ignored.

## Known limitations (not production-ready yet)

- **Local backend only.** The backend runs on the student's machine and stores data in JSON files, so a student with access to the machine could tamper with it. A real deployment needs a hosted backend, a database, real user accounts and HTTPS.
- **Shortcut blocking is best-effort.** In packaged builds, reload and devtools shortcuts are blocked inside the Athena window. OS-level shortcuts such as Cmd+Tab, Alt+Tab, Mission Control and Ctrl+Alt+Del cannot be blocked by a normal Electron app; Athena detects focus loss instead.
- **No background-app detection** yet.
- **Evidence stays on the device.** It is not uploaded, so instructors cannot review images yet. The timeline shows events only.
- On macOS, screen snapshots need Screen Recording permission. Without it, Athena shows "Screen capture blocked" and logs an event.
- **Practical assessment mode** (coding tasks, file submissions, checkpoints) is not implemented yet.
