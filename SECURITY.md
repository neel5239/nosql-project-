# Security — ANUMAAN v2 (Express + MongoDB)

MongoDB is the only datastore. The browser keeps nothing: no localStorage, no
sessionStorage; the session is an httpOnly cookie.

| Area | Control | Proof (`tests/e2e_app.py`) |
|---|---|---|
| Passwords | bcrypt (cost 10); dummy-hash compare when the user does not exist; one generic error for unknown user / wrong password | "same message (no enumeration)" |
| Brute force | 30 logins / 15 min per IP (express-rate-limit) + 5 failures → 15-min account lock (`login_attempts`, TTL) | "account locked (429)" |
| Sessions | 32-byte random token, `HttpOnly; SameSite=Strict` (`Secure` in production); only its SHA-256 is stored, TTL 8 h; logout deletes it server-side | cookie-flag, hash, logout checks |
| Authorisation | every route re-checks role; student routes take `studentId` from the session, never from the request; branch heads get aggregates only; the answer key is withheld from students until the survey is locked | 403 checks per role, "answer key withheld", "branch head … 403" |
| NoSQL injection | every body field type-checked (`str()`, integer ranges, fixed id lists) before it reaches a query | operator-injection login → 400; draft sanitiser |
| CSRF | SameSite=Strict + Origin must match host + state-changing requests must be JSON | cross-origin → 403, form POST → 415 |
| XSS | strict CSP (`script-src 'self'`, no inline handlers, `frame-ancestors 'none'`); all untrusted text (typed input, CSV, **YouTube titles/channels**) escaped; YouTube links and thumbnails rebuilt server-side from regex-validated ids | XSS probes in e-mail, search, CSV; link/thumbnail origin checks |
| SSRF | YouTube host is fixed; search text built from fixed topic/band names | — |
| Uploads | `.csv` only, ≤ 1 MB, header must be known item ids, cells A–D, unknown rolls reported; apply only when clean | upload checks |
| CSV export | formula-injection prefix for cells starting `= + - @` | — |
| Errors | generic 500, no stack traces; malformed JSON → 400 | — |
| Audit | logins, survey submits, uploads, retirements → `audit_log` | "audit log written" |

## Still needed before real production

- HTTPS + `NODE_ENV=production` (turns on the `Secure` cookie flag); set `TRUST_PROXY` behind a proxy.
- Replace the shared demo password with institute SSO; remove the demo-account list from the login page.
- MongoDB auth (user/password, least-privilege role) and `MONGO_URI` from a secret store — the local dev instance runs without auth.
- Student data is minors' data (DPDP Act 2023): consent, retention limits, export/delete on request.

## v2 additions (multi-exam)

| Area | Control | Proof (`tests/e2e_v2.py`) |
|---|---|---|
| One-time survey | unique MongoDB index `surveys{studentId,examId}` + duplicate-key → 409; drafts refused after submit; confirm step in UI | "first 200, second 409, draft after submit 409" |
| Honest ratings | a student's result, ceilings, history row and courses for an exam stay locked until they submit that exam's survey (while it is open) | "result locked until they rate" |
| Answer key | never in survey payloads; in reports only after the teacher releases the key; never stored in history | "answer key withheld", "after key release … visible" |
| Exam ids | `^E[0-9]{1,6}$` on every query/param/body id — objects and arrays → 404 | "operator as exam id → 404" |
| Teacher scope | every teacher route filters by the teacher's `batchIds`; drafts invisible to students | role/scope checks |
| Question upload | 4–60 rows, known topics only, A–D answer, ≤400/120-char text, 200 KB; titles and question text are escaped everywhere (an HTML title renders as text) | "bad topic/answer rejected", `<b>Pulse</b>` title test |
| Difficulty marks | only plain `"L1".."L4"` strings for this exam's own question ids | "plain 'L1'..'L4' strings" |
| Marks upload | header must be exactly this exam's item ids — marks cannot land in the wrong exam; survey ratings merged with `$setOnInsert` (never overwritten) | "marks for exam A cannot be uploaded into exam B" |

## v3 (no marks) additions

| Area | Control | Proof (`tests/e2e_v3.py`) |
|---|---|---|
| No answer data | marks/upload/sample-marks/retire endpoints removed (404); `responses` stays empty; the optional answer column is never sent to students | "marks/retire endpoint gone", "no answer key" |
| Batch isolation | every student route filters by the student's own `batchId`; analysis only counts students of the exam's batch | "other-batch student … 404" |
| Rating privacy | batch figures shown to students are rounded to half steps, so diffing the average before/after a classmate submits cannot reveal their exact taps; comparisons need ≥ 5 raters | "rounded to half steps" |
| Individual ratings | named per-student ratings (`/api/batch`) for the batch's teacher only; branch and company get aggregates | "company cannot pull individual named ratings" |
| Finality | closing a survey freezes reports as final; a closed survey cannot re-open; late submits → 423 | "close → late submit 423, cannot re-open" |

## v4 additions (one tap, account sidebar)

| Area | Control | Proof (`tests/e2e_v4.py`) |
|---|---|---|
| One rating | surveys store only `self` 1–4 per question; anything else is dropped by the server | "one tap per question" |
| Profile | only `name` is written, cleaned of `< >` and control characters, 2–60 chars | "name is cleaned", "object as name → 400" |
| Preferences | whitelisted keys only, booleans / theme enum checked; role/batch cannot be touched | "operator body → 400, role untouched" |
| Password change | needs the current password, 10 tries / 15 min, policy ≥ 8 chars with letter + number, ends every other session | "other device signed out", "old password no longer works" |
| Devices | list/revoke scoped to the signed-in user; no token hashes returned | "sessions list…", "sign out other devices" |
| Data export | only the requester's records; no password hash, no session tokens | "data export has no password hash…" |
| Review fixes | rate-limiter options restored (were swallowed by a comment); malformed cookies ignored instead of a 500 | "RateLimit headers", "malformed cookie → 401" |
