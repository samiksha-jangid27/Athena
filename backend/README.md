# Athena backend

A small Express server that stores attempts in JSON files. It is meant for local development; see the root README for production gaps.

```bash
npm install
npm start   # http://127.0.0.1:3000, prints the instructor key
npm test
```

## Student endpoints (Bearer token from `/exam/start`)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/exam/start` | `{ userId, name }` → `{ token, attempt, questions }` |
| GET | `/exam/attempt` | Current attempt + questions (recovery and heartbeat) |
| PUT | `/exam/answers` | `{ answers: { [questionId]: optionIndex }, flags: [] }`; idempotent full save |
| POST | `/exam/events` | `{ events: [{ type, at, detail? }] }`; whitelisted types only |
| POST | `/exam/submit` | Final save + submit; idempotent |

## Instructor endpoints (`x-instructor-key` header)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/instructor/attempts` | All attempts with scores and events |
| POST | `/instructor/attempts/:id/unlock` | Unlock after a fullscreen exit |
| POST | `/instructor/attempts/:id/extend` | `{ minutes }` (1–120); also reopens an expired attempt |

Answers are rejected after the deadline (plus a 5-second grace period) and while an attempt is locked.
