# Myositis Home Companion — sharing backend

A small Node/Express backend that implements magic-link PT sharing for the
main app (`../index.html`). It's a **separate deployment** from that file:
the frontend stays a single, dependency-free static page you can keep
serving from GitHub Pages exactly as before; this backend is the piece
GitHub Pages can't run (a server, a database, outbound email).

If you don't deploy this, the frontend's Sharing Settings screen falls back
to a local-only toggle (no email, no revocable link) — see `SHARING_API_BASE`
near the top of `index.html`'s `<script>`.

## What this is (and isn't)

This is a reference implementation: real token generation, real revocation,
real rate limiting, a real (pluggable) email integration, and tests —
written to be deployed, not just read. It is **not** currently deployed
anywhere; there's no live database, hosted instance, or email account behind
it. You provide those when you're ready (see below).

**Before this touches real patients:** the rest of this app has no
authentication system — a "patient" is just a name picked from a dropdown.
The sharing endpoints (`/api/patients/:id/sharing/*`) inherit that: they
trust the `:id` in the URL with no check that the caller actually is that
patient. That's fine for a local, seeded, no-PHI pilot demo. It is not fine
once real people's data is involved — add real patient authentication and
authorize against it in `src/routes/sharingApi.js` first.

## Data model

`SharingLink`: `token` (unique, indexed, 256-bit random hex — never a
sequential ID or anything derived from patient data), `patientId`,
`ptEmail`, `ptName`, `createdAt`, `expiresAt` (90 days out by default),
`revoked`, `lastAccessedAt`, `accessCount`. Stored in SQLite via Node's
built-in `node:sqlite` (no native-module dependency to compile — see
`src/db.js`), alongside a minimal copy of the demo patient/program/log/FOM/
MMT data needed to render the read-only PT view.

## Running locally

```
npm install
cp .env.example .env      # edit as needed; defaults work for local dev
npm start                 # http://localhost:3001
```

On first run it seeds the same four demo patients as the frontend, plus an
already-active, already-viewed sharing link for Jordan Blake so the whole
flow is demonstrable immediately:

```
curl http://localhost:3001/api/patients/p2/sharing/status
```

copy the `link.url` from the response and open it in a browser — no login
needed.

## Testing

```
npm test
```

Runs on Node's built-in test runner against an isolated in-memory database
per test (no shared state, nothing written to disk). Includes the explicit
security test this feature was built around: a token for one patient can
never be used to fetch another patient's data
(`test/sharing.test.js` → "pt-view for one patient's token never returns
another patient's data").

## Deploying

Pick a small Node host (Render, Railway, Fly.io, a plain VPS, etc — anything
that runs a long-lived Node 22.5+ process; `node:sqlite` needs it). Then:

1. Set `PUBLIC_BASE_URL` to that host's real HTTPS URL — it's what gets
   embedded in the emailed link.
2. Set `ALLOWED_ORIGIN` to your GitHub Pages origin (e.g.
   `https://your-username.github.io`) so the frontend's cross-origin
   `fetch()` calls are allowed.
3. Get a Postmark account (or swap `src/email.js` for SendGrid/SES — it's
   one small function) and set `POSTMARK_API_TOKEN` /
   `POSTMARK_FROM_EMAIL`. Without a token set, the app runs in "dev-log"
   mode: it logs that it *would* send an email instead of actually sending
   one, so the rest of the flow stays testable without a real account.
4. Set `NODE_ENV=production` — this turns on the HTTP→HTTPS redirect and
   HSTS header in `src/app.js`. Most PaaS platforms terminate TLS for you;
   this middleware trusts `X-Forwarded-Proto` from the first proxy hop
   (`app.set('trust proxy', 1)`).
5. In `index.html`, set `SHARING_API_BASE` to this backend's URL and
   redeploy the static frontend (GitHub Pages, unchanged otherwise).

`DB_PATH` defaults to `server/data/app.db` — on most PaaS platforms the
filesystem is ephemeral, so point it at a persistent volume/disk if one is
available, or swap SQLite for a hosted Postgres instance if you outgrow a
single small file (the `src/repo.js` layer is the only place that would need
to change).

## Rate limiting

In-memory, per-patient, 3 sends/hour by default
(`SHARING_LINK_MAX_SENDS_PER_HOUR`), covering both "turn sharing on" and
"resend." It's a single `Map` in `src/rateLimit.js` — fine for one process,
but a multi-instance deployment would need a shared store (Redis) instead,
since each instance would otherwise track its own count.

## Logging

Raw tokens are never logged — see `src/tokens.js`'s `redactToken()`, used
everywhere a token would otherwise appear in a log line (grep the codebase
for `console.log`/`console.error` if you add more logging; keep using
`redactToken`).
