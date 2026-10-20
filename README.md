# Athena

A cross-platform desktop examination and proctoring platform featuring exam integrity monitoring, camera and screen capture, instructor controls, and practical assessment support.

Built with **Electron**, **React + Vite** and a small **Express** backend. It has no UI framework and no state library.

---

## What Athena does

### Student
- **Guided readiness flow** in four steps:
  1. Welcome, with the real exam details from the server.
  2. Validated identification.
  3. System check: exam service, camera with live preview, screen-capture permission and test capture, and a scan for disallowed apps.
  4. A consent step that lists exactly what is and isn't recorded.
- **Exam screen**:
  - Server-synced countdown that escalates at 5 and 1 minutes.
  - Question navigator with answered/flagged legend and filters.
  - Review flags and keyboard shortcuts (`←` `→`, `1`–`9`, `F`).
  - A save status that only says "Saved" after the server confirms it.
  - Live monitoring indicators.
- **Autosave and recovery**:
  - Answers are written to local storage first, then saved to the server with retries.
  - After a crash or restart, the attempt resumes. Unsaved local answers win over the older server copy.
  - Offline and stale sessions get their own recovery screens instead of a new attempt.
- **Integrity**:
  - Leaving fullscreen locks answering immediately on the client. The server also rejects answers while the attempt is locked.
  - Focus loss, camera and screen-capture interruptions and network changes are recorded as timestamped events.
  - Each event has a unique ID, so retries never duplicate it. Events the server rejects are reported as rejected, never as synced.
- **Submission**:
  - A confirmation dialog lists unanswered and flagged questions.
  - Automatic submission at the server deadline.
  - Duplicate-submit protection on both client and server.
  - A final screen shows the server-confirmed submission time and reference.
- **Practical tasks**: instructions, validated project-file uploads (type, size and count), file hashes and labelled checkpoints.

### Instructor (`Instructor` tab, or `#/instructor`)
- Attempts table with search, status filter, sorting, live time remaining and critical-event counts. All numbers come from real attempts.
- Attempt detail with:
  - Facts, extensions and attempt ID.
  - A newest-first activity timeline with severity and filter, plus references to the local evidence folders.
  - **Unlock** and **Extend time**, each behind a confirmation dialog.
- Practical review: download submitted files and record pass/fail for each instructor-defined check. **Athena never executes submitted code.**

---

## Getting started

Requirements: Node.js 20+ and npm.

```bash
npm install && npm --prefix frontend install && npm --prefix backend install
```

If npm skipped Electron's install script (`npm warn install-scripts`), download the binary once:

```bash
node frontend/node_modules/electron/install.js
```

### Development

```bash
npm run dev        # terminal 1: Vite renderer on http://localhost:5173
npm run electron   # terminal 2: desktop app (starts the backend if none is running)
```

The backend prints an **instructor key** at startup. Set `ATHENA_INSTRUCTOR_KEY` to use a fixed one. You can also run the backend alone with `npm run backend`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Backend port |
| `ATHENA_EXAM_MINUTES` | `10` | Exam duration |
| `ATHENA_EXAM_TITLE` | `Electron Fundamentals` | Title shown to students |
| `ATHENA_INSTRUCTOR_KEY` | random per run | Instructor authorisation |
| `VITE_ATHENA_API_URL` | `http://127.0.0.1:3000` | Backend URL baked into the renderer (also used in the CSP) |

Exam content lives in `backend/data/questions.json` (multiple choice) and `backend/data/practical.json` (practical tasks and instructor-defined checks).

### Checks and builds

```bash
npm test                     # backend + frontend + Electron helper tests (node:test)
npm run lint                 # ESLint
npm run build:frontend       # production renderer
npx electron-builder --dir   # unpacked desktop app in release/
npm run dist                 # installers (DMG on macOS, NSIS on Windows)
```

---

## Project layout

```
backend/
  server.js            Reads env, starts the server, exits if the desktop app dies
  app.js               Express routes (student, practical, instructor)
  lib/attempts.js      Attempt rules: deadlines, locks, events, scoring
  lib/practical.js     Upload validation, checkpoints, instructor results
  lib/store.js         Atomic JSON-file storage
  test/                Rule tests and HTTP API tests
frontend/
  app/app.js           Electron main: window, permissions, capture, backend process
  app/preload.cjs      The only bridge to the renderer (window.athena)
  app/ipc-validation.js, app/background-apps.js   Pure, tested helpers
  src/components/      Screens (Readiness, ExamScreen, LockedPanel, …) and ui/ primitives
  src/hooks/           useExamAttempt, useCamera, usePractical, useInstructorData, useTheme
  src/lib/             Pure logic with tests (timers, retries, navigation, instructor, files)
  src/styles/          tokens.css (design system), base, components, layout, screens
```

## Design system

- **Palette**: a monochrome base (ink, graphite, paper) with a single blue accent for interaction and focus. Red, amber and green appear only for status.
- **Themes**: light and dark follow the OS, with a manual override in the header.
- **Type**: a system sans stack, tabular numbers for times and counts, and monospace for IDs and hashes.
- **Shapes**: small radii and border-led surfaces instead of floating cards.
- **Primitives**: `Button`, `Field`, `Badge`, `Callout`, `Modal` (native `<dialog>`), `Toast`, `Icon`, plus tables and timelines.
- **Accessibility**: a visible focus ring everywhere, a skip link, focus moves to the heading on each readiness step, and live regions for status. Reduced motion is respected.

---

## Security model

**Electron**
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. DevTools are disabled in packaged builds.
- The preload exposes seven functions. Every IPC handler checks the sender's **exact origin**: the Vite origin in development, `file://` when packaged. Camera snapshots must be JPEG bytes under 2 MB.
- Only `media` (video only) and `fullscreen` permissions are granted. Navigation and new windows are blocked.
- Production builds ship a strict Content-Security-Policy.
- Evidence is written only to `<userData>/evidence/{camera,screen}` with server-generated names. The renderer never chooses paths.

**Backend**
- Each attempt gets a random 192-bit bearer token. Only its SHA-256 hash is stored.
- Instructor routes need the instructor key, compared in constant time.
- The server is the authority on status (`in-progress → locked → in-progress`, `→ submitted`, `→ expired`), deadlines (with a 5-second grace period), answer validity, event types and IDs, extensions (1–120 minutes) and upload rules.
- Malformed JSON and oversized bodies get JSON errors. Practical file names are sanitised and stored under server-generated IDs.

## Known limitations

These matter, so they are stated plainly:

- **The backend is not a trusted authority yet.** In this version it runs on the student's own machine and stores data in JSON files. A determined student could edit those files or the clock. A real deployment needs a hosted backend (HTTPS, a database, real student and instructor accounts) before results can be trusted. `VITE_ATHENA_API_URL` is the first step towards that.
- **Shortcuts.** Packaged builds block reload and devtools shortcuts inside the Athena window. Electron **cannot** block OS-level shortcuts such as Cmd+Tab, Alt+Tab, Mission Control, Ctrl+Alt+Del or the Windows key. Athena detects that it has lost focus or left fullscreen and records it instead.
- **Disallowed-app check** reads process names only, matches a fixed list and only **warns**. Renamed or hidden apps, browser tabs and second devices are not detected.
- **Evidence stays on the student's device.** The instructor timeline points to where it is stored, but images are not uploaded yet.
- **Screen capture on macOS** needs Screen Recording permission, which only the student can grant in System Settings. Without it, the readiness check shows "Blocked" and capture failures are logged.
- **Practical checks are reviewed by the instructor.** There is no automated test runner. Running untrusted code would need an isolated sandbox (for example a container with no network), which Athena does not have.
- Packaged builds are **unsigned**. macOS Gatekeeper will warn until the app is signed and notarised.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| "Exam service is offline" | Start the backend (`npm run backend`) or check that nothing else uses port 3000. |
| `Port 3000 is already in use` | Another Athena backend is running. Stop it, or set `PORT`. |
| Camera "Blocked" | macOS: System Settings → Privacy & Security → Camera → allow Athena (or Electron in dev). |
| Screen capture "Blocked" | macOS: Privacy & Security → Screen Recording → allow, then restart Athena. |
| Electron fails with "Electron failed to install correctly" | Run `node frontend/node_modules/electron/install.js`. |
| Instructor key rejected | Use the key printed by the current backend run. A new random key is created on every start unless `ATHENA_INSTRUCTOR_KEY` is set. |
| Student sees "Session not recognised" | The backend data was reset. Ask the student to start again. |

## Development notes and AI disclosure

Parts of this project were developed with help from an AI coding assistant (Claude). The repository owner directed, reviewed and is responsible for the work. If your course has an AI-use policy, follow its disclosure requirements when you submit this project.
