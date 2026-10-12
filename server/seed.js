/* Seeds MongoDB (default DB "anumaan_v4") — no marks, one rating per question.
     E1  Unit Test 3 · Physics      closed, 40/40 surveys              → history
     E2  Unit Test 4 · Physics      closed, 40/40 surveys              → history + default report
     E3  Chapter test · Rotational  OPEN, 30/40 surveys; S1–S10 (incl. Aarav) still have a pending notification
   Teacher difficulty per question comes from the item's calibrated band (E1/E2) or the teacher's mark (E3).
   Student ratings come from the deterministic synthetic batch in engine.js.
   node server/seed.js | --no-reco | --reco-only */
require('../public/engine.js');
const bcrypt = require('bcryptjs');
const { MongoClient } = require('mongodb');
const { connect, col, close, URI } = require('./db');
const { getRecommendations } = require('./youtube');
const { snapshot, notifySurvey } = require('./exams');
const E = globalThis.ANUMAAN_ENGINE;

const DEMO_PASS = process.env.DEMO_PASSWORD || 'anumaan';
const ROOT = 'allen.edu.in';
const BRANCHES = { kota: 'Kota — Centre 3', jaipur: 'Jaipur — Malviya', patna: 'Patna — Boring Rd', nagpur: 'Nagpur — Dharampeth', indore: 'Indore — Vijay Nagar' };
const slug = n => n.toLowerCase().replace(/[^a-z]+/g, '.');
const day = d => new Date(d + 'T09:00:00+05:30');

async function copyRecommendations() {
  if (await col('recommendations').estimatedDocumentCount()) return;
  const c = await MongoClient.connect(URI);
  try {
    for (const src of [process.env.RECO_SOURCE_DB, 'anumaan_v2', 'anumaan'].filter(Boolean)) {
      const docs = await c.db(src).collection('recommendations').find({}).toArray();
      if (docs.length) { await col('recommendations').insertMany(docs); console.log(`recommendations: reused ${docs.length} from ${src}`); return }
    }
  } finally { await c.close() }
}
async function prefetch(onlyMissing) {
  let ok = 0;
  for (const t of E.TOPICS) for (const b of E.BANDS) {
    const r = await getRecommendations(t.id, t.name, b.id, { force: !onlyMissing });
    if (r.videos.length || r.courses.length) ok++;
    if (r.source === 'youtube') await new Promise(res => setTimeout(res, 700));
  }
  console.log(`recommendations cached: ${ok}/16`);
}

async function main() {
  await connect();
  if (process.argv.includes('--reco-only')) { await prefetch(true); return close() }
  for (const c of ['users', 'sessions', 'exams', 'questions', 'students', 'survey_drafts', 'surveys',
                   'review_flags', 'batches', 'audit_log', 'login_attempts', 'notifications', 'student_history'])
    await col(c).deleteMany({});
  // v3 keeps no marks: drop collections that older versions used, if they exist
  const { db: dbHandle } = require('./db');
  for (const old of ['responses', 'uploads', 'retired_items'])
    if ((await dbHandle().listCollections({ name: old }).toArray()).length) await dbHandle().collection(old).drop();
  const hash = await bcrypt.hash(DEMO_PASS, 10);
  const teacher = 'r.menon@faculty.' + ROOT;
  const base = E.generateSample();
  await col('batches').insertOne({ _id: 'b1', name: 'JEE-2027-Alpha', branch: 'kota', teacherEmail: teacher });
  await col('students').insertMany(base.students.map(st => ({ _id: st.id, roll: st.roll, name: st.name, batchId: 'b1', email: `${slug(st.name)}@student.${ROOT}` })));

  const addExam = async (ex, questions, ratings, who, status) => {
    const qids = questions.map(q => q.qid);
    await col('exams').insertOne({ ...ex, batchId: 'b1', createdBy: teacher, createdAt: ex.examDate, approvedAt: ex.examDate,
      status, surveyOpen: status === 'published', ready: who.length >= 5, surveyQids: qids, ...(status === 'closed' ? { closedAt: new Date(ex.examDate.getTime() + 2 * 864e5) } : {}) });
    await col('questions').insertMany(questions.map(q => ({ _id: `${ex._id}:${q.qid}`, examId: ex._id, ...q })));
    await col('surveys').insertMany(who.map((sid, i) => ({ studentId: sid, examId: ex._id, count: qids.length, secs: 80 + (i * 37) % 140,
      at: new Date(ex.examDate.getTime() + 3 * 3600e3 + i * 60e3), answers: Object.fromEntries(qids.map(q => [q, ratings(sid, q)])) })));
  };

  for (const [id, title, seed, date] of [['E1', 'Unit Test 3 · Physics', 20260601, '2026-09-18'], ['E2', 'Unit Test 4 · Physics', 20260825, '2026-10-02']]) {
    const s = E.generateSample(seed);
    const qs = s.questions.map(q => ({ qid: q.id, n: q.n, topic: q.topic, text: q.text, options: q.options, answer: q.answer, teacherBand: E.bandOf(q.poolP).id }));
    const ex = { _id: id, title, subject: 'Physics', examDate: day(date) };
    await addExam(ex, qs, (sid, qid) => ({ self: s.R[sid][qid].selfR }), s.students.map(x => x.id), 'closed');
    await col('notifications').insertMany(s.students.map(st => ({ studentId: st.id, examId: id, kind: 'survey', title, count: qs.length, createdAt: ex.examDate, readAt: ex.examDate, doneAt: ex.examDate })));
  }

  /* E3: 12 rotation items, teacher-rated; 30 of 40 students have rated, survey still open */
  const rot = base.questions.filter(q => q.topic === 'rot');
  const qs3 = rot.map((q, i) => ({ qid: 'Q' + (i + 1), n: i + 1, topic: q.topic, text: q.text, options: q.options, answer: q.answer, teacherBand: 'L' + q.targetBand }));
  const done3 = base.students.slice(10).map(s => s.id);
  const e3 = { _id: 'E3', title: 'Chapter test · Rotational Motion', subject: 'Physics', examDate: day('2026-10-10') };
  await addExam(e3, qs3, (sid, qid) => { const r = base.R[sid][rot[+qid.slice(1) - 1].id]; return { self: r.selfR } }, done3, 'published');
  const exam3 = await col('exams').findOne({ _id: 'E3' });
  await notifySurvey(exam3, base.students.map(s => s.id));
  await col('notifications').updateMany({ examId: 'E3', studentId: { $in: done3 } }, { $set: { readAt: e3.examDate, doneAt: e3.examDate } });

  const users = base.students.map(st => ({ email: `${slug(st.name)}@student.${ROOT}`, name: st.name, role: 'student', studentId: st.id }));
  users.push({ email: teacher, name: 'R. Menon', role: 'teacher', batchIds: ['b1'] });
  for (const [k, v] of Object.entries(BRANCHES)) users.push({ email: `head@${k}.${ROOT}`, name: `Branch Head · ${v}`, role: 'branch', branch: k, branchName: v });
  users.push({ email: 'admin@' + ROOT, name: 'Company Admin', role: 'company' });
  await col('users').insertMany(users.map(u => ({ ...u, passHash: hash, theme: 'light', createdAt: new Date() })));

  await copyRecommendations();
  if (!process.argv.includes('--no-reco')) await prefetch(true);
  let h = 0; for (const id of ['E1', 'E2', 'E3']) h += await snapshot(id);
  console.log(`seeded: 3 exams, ${users.length} users, history ${h} rows, ${await col('notifications').countDocuments({ doneAt: null })} pending survey notifications`);
  await close();
}
main().catch(async e => { console.error(e); await close(); process.exit(1); });
