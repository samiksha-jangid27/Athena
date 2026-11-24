# Athena backend

Express API with Prisma/PostgreSQL persistence in production. Without `DATABASE_URL`, development and tests use an in-memory repository; it resets when the process exits. Legacy `/exam`, `/practical`, and `/instructor` routes use the separate JSON store.

```sh
npm install
npm run db:generate
npm start
npm test
```

The current client signs in at `/api/auth/login`, lists `/api/student/exams`, and starts an attempt at `/api/student/exams/:id/start`. Subsequent `/api/student/attempt` requests use the issued attempt token. Admin routes under `/api/admin` require an administrator JWT. Passwords use bcrypt; attempt tokens are stored as SHA-256 hashes.

Autosaves enforce locks and server deadlines with a five-second network grace period. Late submission grades previously saved answers. Finalization persists totals and per-question marks together. A submitted attempt cannot be unlocked or extended. Expired attempts may be extended from the current time. Question sets are frozen once any attempt exists.

Set production configuration in the hosting environment (see the root README and `render.yaml`). Environment examples are documentation; this server does not automatically load `.env` files.
