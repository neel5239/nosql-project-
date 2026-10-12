# ANUMAAN version 4 — one tap, no marks, account sidebar (Express + MongoDB)

v4 needs no answer sheets and asks each student **one** question per item. Every number comes from two inputs:

1. **The teacher's difficulty rating** of each question (L1 Basic … L4 Elite), given when the exam is uploaded.
2. **Each student's one tap** per question: how hard it felt *for me* (Normal / Medium / Hard / Very Hard). The batch view is the average of everyone's tap — nobody guesses it.

MongoDB is the only storage (DB `anumaan_v4`). Earlier versions are untouched in `D:\Anumaan-app`, `D:\Anumaan-version-2`, `D:\Anumaan-version-3`.

## What is computed (all in `public/perception.js`)

| Metric | Definition |
|---|---|
| **Comfortable** | the student rated the question Normal or Medium |
| **Comfort ceiling** (student, per topic) | highest teacher level where ≥ 60 % of that level's questions felt comfortable (needs ≥ 2 questions) |
| **Batch ceiling** | median of the students' comfort ceilings |
| **Felt vs batch** | student rating − batch average for that question (+ = harder for me) |
| **Felt vs teacher** | student rating − teacher level (+ = harder than the teacher expects) |
| **Reads like the teacher** | correlation of the student's ratings with the teacher's levels (0–100) |
| **In step with batch** | correlation of the student's ratings with the class average per question (0–100) |
| **Comfort map** | % comfortable ratings per topic × teacher level |
| **Felt harder / easier than rated** | questions where the batch average is ≥ 1 step away from the teacher's level |

**Limit, stated in the UI:** this measures how hard the paper *felt*, not whether answers were right. Without marks there are no blind spots (easy-felt but wrong) — that needs v2.

## Flow

Teacher: **New exam** (questions CSV; answer column optional) → **rate difficulty** → **Approve** (students notified) → results appear at **5 ratings** and update live → **Close & finalise** (cannot re-open).
Student: 🔔 → one-time survey → comfort report immediately (once 5 classmates have rated) → courses for weak topics → **History** of every exam with comfort %, ceilings vs batch, and the recommendations given then.
**Account sidebar** (every role): dashboard pages, **Profile** (details, display name) and **Settings** (light/dark/system theme, reduced motion, compact sidebar, survey banner, change password — signs out other devices, signed-in devices, Download my data). Saved in MongoDB. On phones the sidebar is a drawer.
Branch head: aggregates only. Company: all exams + a review list of questions whose felt difficulty disagrees with the teacher, with "Mark reviewed".

## Deploy on Railway

1. **New Project → Deploy from GitHub repo** → pick this repository. Railway detects Node 22 from `package.json` / `.node-version` and uses `railway.json` (start `node server/server.js`, health check `/api/health`).
2. In the same project: **+ New → Database → MongoDB**.
3. Open the app service → **Variables** and add:

   | Variable | Value |
   |---|---|
   | `MONGO_URL` | `${{MongoDB.MONGO_URL}}` (reference to the MongoDB service) |
   | `MONGO_DB` | `anumaan_v4` |
   | `NODE_ENV` | `production` (makes the session cookie `Secure`) |
   | `DEMO_PASSWORD` | optional — password for the demo accounts (default `anumaan`) |

4. **Settings → Networking → Generate Domain.** Open it.

On the first boot the database is empty, so the server seeds the demo data (3 exams, 47 accounts) in the background and fetches the YouTube course lists — give it about a minute. Set `AUTO_SEED=false` to skip this. `PORT` is provided by Railway; the server binds `0.0.0.0` and trusts Railway's proxy for client IPs and HTTPS.

If the app is up but the deploy logs say `MongoDB not reachable … retrying`, the `MONGO_URL` variable is missing or points to the wrong service; the server keeps retrying (it does not crash) and answers 503 until the database is reachable.

> The demo accounts share one known password. Change `DEMO_PASSWORD` (before the first boot) or turn off `AUTO_SEED` for anything beyond a demo.

## Run

```bash
npm install
npm run seed      # E1/E2 closed (40/40 rated), E3 open (30/40 rated; Aarav and 9 others pending)
npm start         # http://localhost:8907
```
Restart the server after re-seeding (analysis is cached in memory).

Demo accounts (password `anumaan`): `aarav.sharma@student.allen.edu.in`, `r.menon@faculty.allen.edu.in`, `head@kota.allen.edu.in`, `admin@allen.edu.in`.

## Test

```bash
python tests/e2e_v4.py     # 101 checks on DB anumaan_v4_test
```
