/* v3 exams: no marks. Each exam's analysis is built from the teacher's
   difficulty rating per question + every submitted survey (one rating per question).
   MongoDB only: questions, surveys, student_history, notifications. */
require('../public/engine.js');
require('../public/perception.js');
const { col } = require('./db');
const { getRecommendations } = require('./youtube');
const E = globalThis.ANUMAAN_ENGINE, F = globalThis.ANUMAAN_FELT;

const MIN_READY = 5;               // batch comparisons need at least this many surveys
const cache = new Map(), versions = new Map();
const bump = examId => { versions.set(examId, (versions.get(examId) || 0) + 1); cache.delete(examId) };

async function load(examId) {
  const exam = await col('exams').findOne({ _id: examId }, { projection: { batchId: 1 } });
  const [qs, sts, svs] = await Promise.all([
    col('questions').find({ examId }).sort({ n: 1 }).toArray(),
    col('students').find({ batchId: exam?.batchId ?? '__none__' }).sort({ roll: 1 }).toArray(),   // only this exam's batch counts
    col('surveys').find({ examId }, { projection: { _id: 0, studentId: 1, answers: 1 } }).toArray()
  ]);
  const R = {};
  svs.forEach(s => {
    const row = {};
    for (const q of qs) { const a = s.answers?.[q.qid]; if (a?.self) row[q.qid] = { self: a.self } }
    if (Object.keys(row).length === qs.length) R[s.studentId] = row;
  });
  return {
    questions: qs.filter(q => q.teacherBand).map(q => ({ id: q.qid, n: q.n, topic: q.topic, text: q.text, teacherBand: q.teacherBand })),
    students: sts.filter(s => R[s._id]).map(s => ({ id: s._id, roll: s.roll, name: s.name })), R
  };
}
async function engineFor(examId) {
  const v = versions.get(examId) || 0, hit = cache.get(examId);
  if (hit && hit.v === v) return hit;
  const data = await load(examId);
  const A = data.questions.length && data.students.length ? F.analyzeFelt(data) : null;
  const out = { v, A, data, ready: data.students.length >= MIN_READY };
  if ((versions.get(examId) || 0) === v) cache.set(examId, out);
  return out;
}

/* Courses for every paper a student rated, picked from their own result on that paper:
   - the share of the paper that felt comfortable decides how many topics (under 40% → 3, under 65% → 2, else 1)
   - topics are ranked by room above the comfort ceiling, the gap to the batch, questions that felt
     harder than the batch, and blind spots (felt 2+ levels harder than the teacher rated)
   - a topic with a clear problem is always included; each one gets courses one level above the ceiling */
async function recosFor(rep) {
  const blindBy = {};
  rep.harderThanTeacher.forEach(d => { blindBy[d.q.topic] = (blindBy[d.q.topic] || 0) + 1 });
  const ranked = rep.focus.map(o => {
    const mi = o.my === '—' ? -1 : E.bandIdx(o.my), blind = blindBy[o.t.id] || 0;
    return { o, mi, blind, need: o.score + (3 - mi) * 0.9 + blind * 1.2 };
  }).sort((a, b) => b.need - a.need);
  const n = rep.comfortPct < 40 ? 3 : rep.comfortPct < 65 ? 2 : 1;
  const must = ranked.filter(x => x.o.score > 1.2 || x.blind > 0 || x.mi < 0);
  const pick = [...must, ...ranked.filter(x => !must.includes(x))].slice(0, Math.min(3, Math.max(n, must.length)));
  return Promise.all(pick.map(async ({ o, mi, blind }) => {
    const target = mi < 0 ? 'L1' : E.BANDS[Math.min(3, mi + 1)].id;
    const why = [];
    if (mi < 0) why.push('No level of this topic felt comfortable yet');
    else why.push(`Comfortable up to ${o.my}${o.bt !== '—' && o.delta < 0 ? ` — your batch is comfortable up to ${o.bt}` : ''}`);
    if (o.nHard) why.push(`${o.nHard} question${o.nHard === 1 ? '' : 's'} felt harder to you than to your batch`);
    if (blind) why.push(`${blind} blind spot${blind === 1 ? '' : 's'} — felt 2+ levels harder than the teacher rated`);
    if (!o.nHard && !blind && mi >= 0) why.push(mi >= 3 ? 'Keep practising at Elite level' : `Next step: move from ${o.my} to ${target}`);
    // what these courses are meant to fix: the exact questions, and the level they move the student to
    const qref = d => ({ n: d.q.n, text: String(d.q.text || '').slice(0, 110), teacher: E.BANDS[d.t - 1].name,
      you: E.RATING[d.self - 1], batch: E.RATING[Math.min(3, Math.max(0, Math.round(Math.round(d.felt * 2) / 2) - 1))] });
    const blindQs = rep.harderThanTeacher.filter(d => d.q.topic === o.t.id);
    const blindN = new Set(blindQs.map(d => d.q.n));
    const tb = o.bands.find(x => x.b.id === target);
    const solves = [
      ...blindQs.slice(0, 3).map(d => ({ kind: 'blind', ...qref(d) })),
      ...rep.harderThanBatch.filter(d => d.q.topic === o.t.id && !blindN.has(d.q.n)).slice(0, 3).map(d => ({ kind: 'harder', ...qref(d) })),
      { kind: 'level', from: mi < 0 ? 'none yet' : E.BANDS[mi].name, to: E.BANDS[E.bandIdx(target)].name,
        comfortable: tb && tb.r ? Math.round(tb.r.acc * tb.r.n) : null, of: tb && tb.r ? tb.r.n : null }];
    const r = await getRecommendations(o.t.id, o.t.name, target);
    // YouTube search sometimes mixes in other subjects: keep items that name the topic, when there are any
    const kw = o.t.name.toLowerCase().replace(/'s/, '').split(/\s+/)[0].slice(0, 6);
    const rel = list => { const m = (list || []).filter(v => String(v.title).toLowerCase().includes(kw)); return m.length ? m : (list || []) };
    r.courses = (r.courses || []).filter(v => String(v.title).toLowerCase().includes(kw)); r.videos = rel(r.videos);   // a course from another subject is worse than none
    return { topic: o.t.id, topicName: o.t.name, ceiling: o.my, batchCeiling: o.bt, target, why, solves, blindSpots: blind, harderThanBatch: o.nHard,
      urgency: o.score > 3 || mi < 0 ? 'urgent' : (o.score > 1.2 || blind) ? 'work on it' : 'next step',
      courses: r.courses, videos: r.videos, fetchedAt: r.fetchedAt, source: r.source, error: r.error || null };
  }));
}

/* history rows written before RECO_V lack the per-exam picks: rebuild them once at start-up */
const RECO_V = 3;
async function refreshHistory() {
  for (const ex of await col('exams').find({ status: { $ne: 'draft' } }, { projection: { _id: 1 } }).toArray()) {
    if (await col('student_history').findOne({ examId: ex._id, recoV: { $ne: RECO_V } }, { projection: { _id: 1 } })) await snapshot(ex._id);
  }
}

/* history = what the student saw for this exam, kept even after the batch moves on */
async function snapshot(examId, studentIds) {
  const exam = await col('exams').findOne({ _id: examId });
  const { A, ready } = await engineFor(examId);
  if (!exam || !A || !ready) return 0;
  const ids = studentIds || A.STUDENTS.map(s => s.id);
  const svs = new Map((await col('surveys').find({ examId, studentId: { $in: ids } }, { projection: { studentId: 1, at: 1 } }).toArray()).map(s => [s.studentId, s.at]));
  let n = 0;
  for (const sid of ids) {
    if (!A.STUDENTS.some(s => s.id === sid)) continue;
    const rep = A.studentReport(sid), recos = await recosFor(rep);
    await col('student_history').updateOne({ studentId: sid, examId }, { $set: {
      studentId: sid, examId, title: exam.title, subject: exam.subject, examDate: exam.examDate || exam.createdAt,
      comfortPct: rep.comfortPct, calib: rep.calib, match: rep.match, batchSize: A.NS,
      harderThanBatch: rep.harderThanBatch.length, harderThanTeacher: rep.harderThanTeacher.length,
      ceilings: Object.fromEntries(rep.topics.map(o => [o.t.id, o.my])),
      batchCeilings: Object.fromEntries(rep.topics.map(o => [o.t.id, o.bt])),
      weak: rep.focus.filter(o => o.score > 1.2).map(o => ({ topic: o.t.id, topicName: o.t.name, ceiling: o.my })),
      recommendations: recos.map(r => ({ topicName: r.topicName, ceiling: r.ceiling, target: r.target, urgency: r.urgency, why: r.why,
        items: [...r.courses, ...r.videos].map(v => ({ kind: v.kind, title: v.title, channel: v.channel, url: v.url, thumb: v.thumb })) })),
      surveyedAt: svs.get(sid) || null, final: exam.status === 'closed', recoV: RECO_V, updatedAt: new Date()
    } }, { upsert: true });
    n++;
  }
  return n;
}

async function notifySurvey(exam, studentIds) {
  if (!studentIds.length) return 0;
  await col('notifications').bulkWrite(studentIds.map(sid => ({ updateOne: {
    filter: { studentId: sid, examId: exam._id, kind: 'survey' },
    update: { $setOnInsert: { studentId: sid, examId: exam._id, kind: 'survey', title: exam.title, count: exam.surveyQids.length, createdAt: new Date(), readAt: null, doneAt: null } },
    upsert: true } })));
  return studentIds.length;
}

module.exports = { engineFor, bump, snapshot, recosFor, refreshHistory, notifySurvey, load, MIN_READY };
