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

async function recosFor(rep) {
  const weak = rep.focus.filter(o => o.score > 1.2).slice(0, 3);
  return Promise.all(weak.map(async o => {
    const target = o.my === '—' ? 'L1' : E.BANDS[Math.min(3, E.bandIdx(o.my) + 1)].id;
    const r = await getRecommendations(o.t.id, o.t.name, target);
    return { topic: o.t.id, topicName: o.t.name, ceiling: o.my, target, urgency: o.score > 3 ? 'urgent' : 'work on it',
      courses: r.courses, videos: r.videos, fetchedAt: r.fetchedAt, source: r.source, error: r.error || null };
  }));
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
      recommendations: recos.map(r => ({ topicName: r.topicName, ceiling: r.ceiling, target: r.target,
        items: [...r.courses, ...r.videos].map(v => ({ kind: v.kind, title: v.title, channel: v.channel, url: v.url, thumb: v.thumb })) })),
      surveyedAt: svs.get(sid) || null, final: exam.status === 'closed', updatedAt: new Date()
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

module.exports = { engineFor, bump, snapshot, recosFor, notifySurvey, load, MIN_READY };
