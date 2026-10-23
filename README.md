# Athena Examination & Integrity Platform

Athena is a centrally managed, multi-student desktop examination and proctoring platform designed for secure institutional assessments. It combines an **Electron + React** desktop application with a shared **Express + PostgreSQL** backend orchestrated with **Prisma ORM**.

---

## 1. Architecture and Data Flow

Athena is architected as a centralized client-server platform where all students and administrators connect to a shared, authoritative hosted backend:

```
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│     Student Desktop App         │       │    Administrator Desktop App    │
│   (Electron + React Client)     │       │    (Electron + React Client)    │
│  - Zero configuration install   │       │  - Exam & Question Management   │
│  - Secure proctored exam runner │       │  - Student Provisioning         │
│  - Autosave with server sync    │       │  - Live Proctoring & Review     │
└────────────────┬────────────────┘       └────────────────┬────────────────┘
                 │                                         │
                 │ HTTPS (JWT Authenticated)               │ HTTPS (JWT Authenticated)
                 ▼                                         ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                     Central Backend API (Node / Express)                  │
│                     Hosted on Render (Render Web Service)                 │
│                                                                           │
│  - Role-Based Access Control (ADMIN / STUDENT)                            │
│  - Server-Authoritative Deadlines & Anti-Tamper State Machine             │
│  - Objective Grading Engine (MCQ, MSQ, True/False, Short Answer)          │
│  - Authenticated Proctoring Evidence Ingestion & Streaming                │
└─────────────────────────────────────┬─────────────────────────────────────┘
                                      │
                                      ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                 Hosted PostgreSQL Database (Prisma Postgres)              │
│                                                                           │
│  - Tables: Users, Exams, Questions, Attempts, SubmittedAnswers,           │
│    ActivityEvents, Evidence, AttemptExtensions, AuditLogs                 │
│  - Full SQL Migrations & ACID Transactions                                │
└───────────────────────────────────────────────────────────────────────────┘
```

### Key Architectural Tenets:
- **Zero-Configuration Client**: Students download the packaged macOS DMG, install it, log in with their credentials, and take exams. They never configure databases, run local servers, or install development tools.
- **Server Authority**: The backend is the sole source of truth for clocks, deadlines, attempt states (`IN_PROGRESS`, `LOCKED`, `SUBMITTED`, `EXPIRED`), scoring, and integrity audit trails.
- **Role-Based Access Control**: Server-verified JWT tokens guarantee that students can only read authorized published exams and submit their own attempts, while administrators manage exams, provision student accounts, unlock attempts, and grade submissions.
- **Privacy-Led Proctoring**: Monitoring begins only after explicit student consent. Evidence (camera and screen snapshots) is encrypted in transit and stored privately, accessible solely to authenticated administrators.

---

## 2. Core Features

### Student Experience
- **Zero-configuration**: Open the DMG, sign in with provisioned credentials.
- **Authorized Exam Catalog**: View active and upcoming examinations assigned to the student.
- **4-Step Readiness Check**:
  1. Welcome with exam facts (time limit, questions, policies).
  2. Verified identification.
  3. System check: Live camera preview, macOS screen recording permission check, and disallowed application scan (Discord, Slack, TeamViewer, Zoom, etc.).
  4. Explicit consent outlining captured data and privacy boundaries.
- **Multi-Type Question Answering**:
  - Single Choice (MCQ) with keyboard shortcuts (`1`–`9`, `A`–`D`).
  - Multiple Select (MSQ) with multi-option checkboxes.
  - True / False objective selection.
  - Short Answer / Essay input with real-time character counters.
- **Resilient Exam Taking**:
  - Server-synced countdown timer escalating urgency at 5 minutes and 1 minute.
  - Filterable question navigator (All, Unanswered, Flagged for review).
  - Autosave with instant local persistence and server-confirmed sync timestamps.
  - Resilient restart recovery: If the computer restarts or app crashes, saved work is recovered.
  - Submission confirmation modal and verifiable submission receipt.

### Administrator Command Center
- **Exam Management**:
  - Create, configure, preview, publish, unpublish, and archive exams.
  - Set titles, descriptions, instructions, durations, passing scores, and total marks.
  - Add, reorder, and remove questions of all four types (MCQ, MSQ, True/False, Short Answer).
  - Safe publishing: Exams cannot be modified while students have active attempts.
- **Student Provisioning**:
  - Provision student accounts with usernames and temporary passwords.
  - Manage enrollments and view account status.
- **Real-Time Proctoring & Attempt Monitoring**:
  - Live table of all attempts with status badges (`In progress`, `Locked`, `Submitted`, `Expired`).
  - Auto-refreshing countdowns and critical violation counters.
  - Detailed activity timeline showing fullscreen exits, focus losses, and app detections.
  - Remote proctoring evidence viewer with thumbnail grid and full-size modal viewer.
  - One-click audited actions: **Unlock attempt** and **Extend deadline** (+1 to 120 minutes).
- **Grading & Results**:
  - Automatic scoring for objective questions.
  - Manual review and score overrides for short answers with instructor audit notes.
  - **One-click CSV Export** of full exam results.

---

## 3. Quick Start (Local Development)

### Prerequisites
- Node.js 20+ and npm
- macOS 11+ (Apple Silicon or Intel)

### 1. Install Dependencies
```bash
# Root and workspace dependencies
npm install
npm --prefix backend install
npm --prefix frontend install

# Generate Prisma Client
npm --prefix backend run db:generate
```

### 2. Run in Development Mode
```bash
# Terminal 1: Vite Renderer (http://localhost:5173)
npm run dev

# Terminal 2: Desktop Electron App
npm run electron
```

### 3. Run Test Suites & Linter
```bash
# Run all tests (38 backend integration & rule tests + 30 frontend & Electron tests)
npm test

# Run ESLint across frontend and main process
npm run lint

# Build frontend production bundle
npm run build:frontend
```

---

## 4. Production Deployment on Render

The Athena backend is configured for deployment on [Render](https://render.com) using Infrastructure-as-Code via `render.yaml`.

### Automated Deployment via Render Blueprint
1. Fork or push the Athena repository to your GitHub account.
2. Log in to your [Render Dashboard](https://dashboard.render.com).
3. Click **New** → **Blueprint**.
4. Connect your Athena repository. Render automatically reads `render.yaml` and provisions:
   - A Node.js Web Service running the Express API.
   - A hosted PostgreSQL Database (`athena-db`).
   - Connection strings and environment variables.
5. Click **Apply**. Render will run:
   ```bash
   npm install && npx prisma generate && npx prisma migrate deploy
   ```
   and start the server with `node server.js`.
6. Once deployed, note your service URL (e.g., `https://athena-backend-xxxx.onrender.com`).

### Manual Web Service Configuration on Render (Alternative)
If not using Blueprints:
1. Create a **PostgreSQL** database on Render or Prisma Postgres. Copy the `Internal Database URL`.
2. Create a **Web Service** on Render:
   - **Root Directory**: `backend`
   - **Build Command**: `npm install && npx prisma generate && npx prisma migrate deploy`
   - **Start Command**: `node server.js`
   - **Health Check Path**: `/health`
3. Configure the Environment Variables listed below.

---

## 5. Database Schema & Prisma Migrations

Athena uses Prisma ORM with PostgreSQL. The schema is located in `backend/prisma/schema.prisma`.

### Models
- `User`: User accounts with bcrypt hashed passwords and `ADMIN` / `STUDENT` roles.
- `Exam`: Examinations with durations, statuses (`DRAFT`, `PUBLISHED`, `ARCHIVED`), and passing criteria.
- `Question`: Question items (`MCQ`, `MSQ`, `TRUE_FALSE`, `SHORT_ANSWER`) with options and correct answers.
- `Attempt`: Student attempts with server deadlines, statuses (`IN_PROGRESS`, `LOCKED`, `SUBMITTED`, `EXPIRED`), and scores.
- `SubmittedAnswer`: Answers submitted per question, supporting objective and manual grading.
- `ActivityEvent`: Timestamped proctoring events with severity levels (`INFO`, `WARNING`, `CRITICAL`).
- `Evidence`: Metadata and storage references for periodic camera and screen capture snapshots.
- `AttemptExtension`: Audit log of instructor time extensions.
- `AuditLog`: Security audit log recording administrative actions.

### Running Migrations
```bash
# Apply migrations to production database (Render / Hosted PostgreSQL)
cd backend
npx prisma migrate deploy

# Generate Prisma Client after schema changes
npx prisma generate
```

---

## 6. Environment Variables Reference

| Variable | Scope | Description | Default / Example |
| :--- | :--- | :--- | :--- |
| `PORT` | Backend | Port the Express server listens on | `3000` (Local) / `10000` (Render) |
| `HOST` | Backend | Network interface binding | `0.0.0.0` |
| `NODE_ENV` | Backend | Application environment | `production` / `development` |
| `DATABASE_URL` | Backend | PostgreSQL connection string | `postgresql://user:pass@host:5432/athena?schema=public` |
| `ATHENA_JWT_SECRET` | Backend | Secret key for signing session JWTs | *Must be 32+ random characters in production* |
| `ATHENA_ADMIN_USERNAME`| Backend | Initial bootstrap administrator username | `admin` |
| `ATHENA_ADMIN_PASSWORD`| Backend | Initial bootstrap administrator password | `AdminPass123!` (Set your own) |
| `VITE_ATHENA_API_URL` | Frontend | Hosted API URL baked into release DMG | `https://athena-exam-backend.onrender.com` |
| `ATHENA_EVIDENCE_DIR` | Backend | Storage folder for proctoring snapshots | `backend/data/evidence` |

---

## 7. Packaging the macOS DMG

To produce the official release DMG for distribution to students:

```bash
# 1. Ensure production API URL is set (or baked in):
export VITE_ATHENA_API_URL="https://your-athena-backend.onrender.com"

# 2. Build frontend and package macOS DMG:
npm run dist
```

- Output DMG artifact: `release/Athena-1.0.0-arm64.dmg` (~123 MB).
- Architecture: Apple Silicon (`arm64`).
- Minimum Supported macOS: macOS 11.0 (Big Sur) through macOS 15+ (Sequoia) and macOS 26+.
- Code Signing & Notarization: Configured in `package.json` under `mac`. When Apple Developer credentials (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `CSC_LINK`) are provided in CI, electron-builder signs and notarizes the DMG automatically.

---

## 8. Proctoring Security & Privacy Architecture

- **Sandbox & Isolation**: Electron runs with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. DevTools and prohibited hotkeys are disabled in packaged builds.
- **Validated Preload**: The preload script exposes only explicit IPC handlers with sender origin checks.
- **Camera & Screen Recording**: Snapshots are taken approximately every 30 seconds. On macOS, screen recording requires explicit user approval in System Settings.
- **Private Evidence Storage**: Snaps are streamed securely over HTTPS to the backend, stored in access-controlled directories or private object storage, and served strictly through authenticated administrator routes (`/api/admin/evidence/:id`).
- **Best-Effort Integrity**: Athena honestly records window focus changes, fullscreen exits, and background processes. It acknowledges that OS-level shortcuts (e.g. Cmd+Tab, Mission Control) cannot be completely blocked by any desktop application.

---

## 9. AI Assistance Disclosure

Parts of this project were developed with assistance from advanced AI coding models under developer direction and review. Authorship and responsibility remain with the project maintainer.
