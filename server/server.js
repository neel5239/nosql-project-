/* ANUMAAN server — Express + MongoDB (the only datastore).
   Auth: bcrypt passwords, opaque session token in an httpOnly SameSite=Strict
   cookie; only its SHA-256 hash is stored (Mongo `sessions`, TTL-expired).
   Every route re-checks role and data scope on the server. */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
require('../public/engine.js');
const { connect, col, close, DB_NAME } = require('./db');
const { getRecommendations } = require('./youtube');
const X = require('./exams');
const E = globalThis.ANUMAAN_ENGINE;

const PORT = +process.env.PORT || 8907;
const ROOT = 'allen.edu.in';
const SESSION_HOURS = 8;
const EMAIL_RE = /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,120}$/;
const BRANCH_SUBS = ['kota', 'jaipur', 'patna', 'nagpur', 'indore'];

const app = express();
app.disable('x-powered-by');
// behind a hosting proxy (Railway, Render…) the real client address and https come from X-Forwarded-*
app.set('trust proxy', process.env.TRUST_PROXY ? +process.env.TRUST_PROXY || 1 : (process.env.RAILWAY_ENVIRONMENT ? 1 : false));
app.use(helmet({
  contentSecurityPolicy: { useDefaults: false, directives: {
    'default-src': ["'self'"], 'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com'],
    'img-src': ["'self'", 'data:', 'blob:', 'https://i.ytimg.com'],
    'connect-src': ["'self'"], 'object-src': ["'none'"], 'base-uri': ["'none'"],
    'form-action': ["'self'"], 'frame-ancestors': ["'none'"]
  } },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));

/* ---------- helpers ---------- */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status } }
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const str = (v, max = 200) => (typeof v === 'string' && v.length <= max) ? v : null;   // blocks {$gt:...} operator injection
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()) } catch (e) { /* malformed cookie: ignore it */ } } });
  return out;
}
function setSid(req, res, token, maxAgeS) {
  const secure = req.secure || process.env.NODE_ENV === 'production';
  res.setHeader('Set-Cookie', `sid=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeS}${secure ? '; Secure' : ''}`);
}
async function audit(user, action, detail = {}) {
  await col('audit_log').insertOne({ at: new Date(), email: user?.email || null, role: user?.role || null, action, detail });
}

/* role from domain — same rule the UI explains; the user must ALSO exist in Mongo */
function routeFor(email) {
  if (!EMAIL_RE.test(email)) return { err: 'Enter a valid institute e-mail address.' };
  const dom = email.slice(email.lastIndexOf('@') + 1);
  if (dom !== ROOT && !dom.endsWith('.' + ROOT)) return { err: `“${dom}” is not registered to any institute on Anumaan.` };
  if (dom === 'student.' + ROOT) return { role: 'student' };
  if (dom === 'faculty.' + ROOT) return { role: 'teacher' };
  if (dom === ROOT) return { role: 'company' };
  const sub = dom.slice(0, -ROOT.length - 1);
  if (BRANCH_SUBS.includes(sub)) return { role: 'branch' };
  return { err: `“${sub}” is not a registered branch domain for this institute.` };
}

/* ---------- middleware ---------- */
// until MongoDB is connected every API call except the health check answers 503 instead of crashing
let dbReady = false;
app.use('/api', (req, res, next) => (dbReady || req.path === '/health') ? next() : res.status(503).json({ error: 'Starting up — try again in a few seconds.' }));
app.use('/api', express.json({ limit: '1200kb', strict: true }));
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    // CSRF: SameSite=Strict cookie + same-origin check + JSON-only bodies
    const origin = req.headers.origin;
    if (origin && origin !== `${req.protocol}://${req.headers.host}`) return res.status(403).json({ error: 'Cross-origin request blocked.' });
    if (req.method !== 'DELETE' && !req.is('application/json')) return res.status(415).json({ error: 'JSON body required.' });
  }
  next();
});
const auth = (...roles) => wrap(async (req, res, next) => {
  const t = cookies(req).sid;
  if (!t || !/^[a-f0-9]{64}$/.test(t)) throw new HttpError(401, 'Please sign in.');
  const s = await col('sessions').findOne({ tokenHash: sha(t), expiresAt: { $gt: new Date() } });
  if (!s) throw new HttpError(401, 'Session expired — please sign in again.');
  const u = await col('users').findOne({ email: s.email }, { projection: { passHash: 0 } });
  if (!u) throw new HttpError(401, 'Account no longer exists.');
  if (roles.length && !roles.includes(u.role)) throw new HttpError(403, 'Your role cannot access this.');
  if (u.role === 'student') u.batchId = (await col('students').findOne({ _id: u.studentId }, { projection: { batchId: 1 } }))?.batchId || null;
  req.user = u; req.tokenHash = s.tokenHash;
  next();
});

/* ---------- auth ---------- */
// per network address; LOGIN_RATE_LIMIT only exists so the test suite can sign in many times
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: +process.env.LOGIN_RATE_LIMIT || 30, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many sign-in attempts from this network. Try again in 15 minutes.' } });
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 10);

app.post('/api/auth/login', loginLimiter, wrap(async (req, res) => {
  const email = str(req.body?.email, 190)?.trim().toLowerCase();
  const password = str(req.body?.password, 128);
  if (!email || !password) throw new HttpError(400, 'E-mail and password are required.');
  const r = routeFor(email);
  if (r.err) throw new HttpError(400, r.err);
  const key = 'acct:' + email;
  const fails = await col('login_attempts').countDocuments({ key });
  if (fails >= 5) throw new HttpError(429, 'Too many wrong passwords for this account. Try again in 15 minutes.');
  const u = await col('users').findOne({ email });
  const ok = await bcrypt.compare(password, u ? u.passHash : DUMMY_HASH);   // same work whether or not the user exists
  if (!u || !ok || u.role !== r.role) {
    await col('login_attempts').insertOne({ key, at: new Date() });
    await audit({ email }, 'login.fail');
    throw new HttpError(401, 'E-mail or password is incorrect.');   // same message either way: no account enumeration
  }
  await col('login_attempts').deleteMany({ key });
  await col('users').updateOne({ _id: u._id }, { $set: { lastLoginAt: new Date() }, $push: { logins: { $each: [{ at: new Date() }], $slice: -5 } } });
  const token = crypto.randomBytes(32).toString('hex');
  await col('sessions').insertOne({ tokenHash: sha(token), email: u.email, role: u.role, createdAt: new Date(), expiresAt: new Date(Date.now() + SESSION_HOURS * 3600e3), ua: String(req.headers['user-agent'] || '').slice(0, 160) });
  setSid(req, res, token, SESSION_HOURS * 3600);
  await audit(u, 'login.ok');
  res.json({ user: publicUser(u) });
}));

app.post('/api/auth/logout', auth(), wrap(async (req, res) => {
  await col('sessions').deleteOne({ tokenHash: req.tokenHash });
  setSid(req, res, '', 0);
  res.json({ ok: true });
}));

const THEMES = ['light', 'dark', 'system'];
function prefsOf(u) {
  const p = u.prefs || {};
  return { theme: THEMES.includes(u.theme) ? u.theme : 'light', reduceMotion: p.reduceMotion === true, sidebarCollapsed: p.sidebarCollapsed === true, surveyBanner: p.surveyBanner !== false };
}
function publicUser(u) {
  const pr = prefsOf(u);
  return { email: u.email, name: u.name, role: u.role, theme: pr.theme, prefs: pr, studentId: u.studentId || null, branch: u.branch || null, branchName: u.branchName || null };
}
/* boot probe: 200 with user:null when signed out, so a fresh visit logs no error */
app.get('/api/session', wrap(async (req, res, next) => {
  const t = cookies(req).sid;
  if (!t || !/^[a-f0-9]{64}$/.test(t) || !(await col('sessions').findOne({ tokenHash: sha(t), expiresAt: { $gt: new Date() } }))) return res.json({ user: null });
  next();
}), auth(), wrap(meHandler));
async function meHandler(req, res) {
  let scope = '';
  if (req.user.role === 'student') { const s = await col('students').findOne({ _id: req.user.studentId }); const b = s && await col('batches').findOne({ _id: s.batchId }); scope = `Roll ${s?.roll || '—'} · ${b?.name || ''}` }
  else if (req.user.role === 'teacher') { const bs = await col('batches').find({ _id: { $in: req.user.batchIds || [] } }).toArray(); scope = bs.map(b => b.name).join(', ') }
  else if (req.user.role === 'branch') scope = `Allen · ${req.user.branchName}`;
  else scope = 'Allen Career Institute · 5 branches';
  res.json({ user: { ...publicUser(req.user), scope } });
}
app.get('/api/me', auth(), wrap(meHandler));
app.patch('/api/me/theme', auth(), wrap(async (req, res) => {
  const theme = req.body?.theme;
  if (!THEMES.includes(theme)) throw new HttpError(400, 'theme must be light, dark or system');
  await col('users').updateOne({ email: req.user.email }, { $set: { theme } });
  res.json({ theme });
}));

/* ---------- account: profile, settings, password, sessions, data export ---------- */
const cleanName = v => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim() : '';
app.get('/api/me/profile', auth(), wrap(async (req, res) => {
  const u = req.user, out = { ...publicUser(u), createdAt: u.createdAt || null, lastLoginAt: u.lastLoginAt || null, logins: (u.logins || []).map(l => l.at) };
  if (u.role === 'student') {
    const st = await col('students').findOne({ _id: u.studentId });
    const b = st && await col('batches').findOne({ _id: st.batchId });
    Object.assign(out, { roll: st?.roll || null, officialName: st?.name || null, batch: b?.name || null, branchName: b?.branch || null,
      surveys: await col('surveys').countDocuments({ studentId: u.studentId }), exams: await col('student_history').countDocuments({ studentId: u.studentId }) });
  } else if (u.role === 'teacher') {
    const bs = await col('batches').find({ _id: { $in: Array.isArray(u.batchIds) ? u.batchIds : [] } }).toArray();
    Object.assign(out, { batches: bs.map(b => b.name), exams: await col('exams').countDocuments({ createdBy: u.email }) });
  }
  res.json({ profile: out });
}));
app.patch('/api/me/profile', auth(), wrap(async (req, res) => {
  const name = cleanName(req.body?.name);
  if (name.length < 2 || name.length > 60) throw new HttpError(400, 'Name must be 2 to 60 characters.');
  await col('users').updateOne({ _id: req.user._id }, { $set: { name } });
  await audit(req.user, 'profile.update');
  res.json({ name });
}));
app.patch('/api/me/prefs', auth(), wrap(async (req, res) => {
  const b = req.body || {}, set = {};
  if (b.theme !== undefined) { if (!THEMES.includes(b.theme)) throw new HttpError(400, 'theme must be light, dark or system'); set.theme = b.theme }
  for (const k of ['reduceMotion', 'sidebarCollapsed', 'surveyBanner'])
    if (b[k] !== undefined) { if (typeof b[k] !== 'boolean') throw new HttpError(400, `${k} must be true or false`); set['prefs.' + k] = b[k] }
  if (!Object.keys(set).length) throw new HttpError(400, 'Nothing to update.');
  await col('users').updateOne({ _id: req.user._id }, { $set: set });
  const u = await col('users').findOne({ _id: req.user._id }, { projection: { passHash: 0 } });
  res.json({ prefs: prefsOf(u), theme: prefsOf(u).theme });
}));
const pwLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many password attempts. Try again in 15 minutes.' } });
app.post('/api/me/password', pwLimiter, auth(), wrap(async (req, res) => {
  const current = str(req.body?.current, 128), next = str(req.body?.next, 128);
  if (!current || !next) throw new HttpError(400, 'Enter your current and new password.');
  if (next.length < 8 || !/[a-z]/i.test(next) || !/\d/.test(next)) throw new HttpError(400, 'New password needs at least 8 characters, with a letter and a number.');
  if (next === current) throw new HttpError(400, 'The new password must be different.');
  const u = await col('users').findOne({ _id: req.user._id });
  if (!(await bcrypt.compare(current, u.passHash))) { await audit(req.user, 'password.fail'); throw new HttpError(400, 'Current password is incorrect.') }
  await col('users').updateOne({ _id: u._id }, { $set: { passHash: await bcrypt.hash(next, 10), passwordChangedAt: new Date() } });
  const { deletedCount } = await col('sessions').deleteMany({ email: u.email, tokenHash: { $ne: req.tokenHash } });   // everyone else is signed out
  await audit(req.user, 'password.change', { otherSessionsEnded: deletedCount });
  res.json({ ok: true, otherSessionsEnded: deletedCount });
}));
const shortUA = ua => { ua = String(ua || ''); const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const o = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'device'; return `${b} on ${o}` };
app.get('/api/me/sessions', auth(), wrap(async (req, res) => {
  const ss = await col('sessions').find({ email: req.user.email, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).toArray();
  res.json({ sessions: ss.map((x, i) => ({ id: i, current: x.tokenHash === req.tokenHash, device: shortUA(x.ua), createdAt: x.createdAt, expiresAt: x.expiresAt })) });
}));
app.delete('/api/me/sessions/others', auth(), wrap(async (req, res) => {
  const { deletedCount } = await col('sessions').deleteMany({ email: req.user.email, tokenHash: { $ne: req.tokenHash } });
  await audit(req.user, 'sessions.revoke', { count: deletedCount });
  res.json({ ended: deletedCount });
}));
/* "download my data": everything we hold about this person, as JSON */
app.get('/api/me/export', auth(), wrap(async (req, res) => {
  const u = req.user, out = { exportedAt: new Date(), account: { ...publicUser(u), createdAt: u.createdAt || null, lastLoginAt: u.lastLoginAt || null } };
  if (u.role === 'student') {
    const sid = u.studentId;
    out.student = await col('students').findOne({ _id: sid }, { projection: { _id: 0 } });
    out.surveys = await col('surveys').find({ studentId: sid }, { projection: { _id: 0 } }).toArray();
    out.history = await col('student_history').find({ studentId: sid }, { projection: { _id: 0 } }).toArray();
    out.notifications = await col('notifications').find({ studentId: sid }, { projection: { _id: 0 } }).toArray();
  }
  out.activity = await col('audit_log').find({ email: u.email }, { projection: { _id: 0 } }).sort({ at: -1 }).limit(200).toArray();
  await audit(u, 'data.export');
  res.setHeader('Content-Disposition', 'attachment; filename="anumaan-my-data.json"');
  res.json(out);
}));

/* ---------- exams (shared) ---------- */
const EXAM_ID = /^E[0-9]{1,6}$/;
const examParam = v => (typeof v === 'string' && EXAM_ID.test(v)) ? v : null;
async function examOr404(id, filter = {}) {
  const ex = examParam(id) && await col('exams').findOne({ _id: id, ...filter });
  if (!ex) throw new HttpError(404, 'Exam not found.');
  return ex;
}
const examCard = ex => ({ id: ex._id, title: ex.title, subject: ex.subject, status: ex.status, surveyOpen: !!ex.surveyOpen,
  ready: !!ex.ready, examDate: ex.examDate || ex.createdAt, questions: ex.questionCount ?? null, surveyCount: ex.surveyQids?.length || 0 });
/* teachers only touch exams of batches they teach; company admin sees all */
const scopeFilter = req => req.user.role === 'teacher' ? { batchId: { $in: Array.isArray(req.user.batchIds) ? req.user.batchIds : [] } } : {};
/* a student only ever sees exams of their own batch */
const mine = req => ({ batchId: req.user.batchId || '__none__' });
const hasSurvey = async (ex, sid) => !!(await col('surveys').findOne({ studentId: sid, examId: ex._id }, { projection: { _id: 1 } }));
async function latestReady(filter = {}) { return col('exams').find({ ready: true, status: { $ne: 'draft' }, ...filter }).sort({ examDate: -1 }).limit(1).next() }

/* ---------- student (studentId always from the session) ----------
   v3 has no marks: a student's report exists only once they have rated the
   paper, and batch comparisons appear once MIN_READY classmates have. */
const qLite = x => ({ ...x, q: { id: x.q.id, topic: x.q.topic, text: x.q.text } });
/* batch figures shown to a student are rounded to half steps, so a newcomer's exact ratings cannot be
   recovered by diffing the batch average before and after they submit */
const half = v => Math.round(v * 2) / 2;
function studentPayload(A, sid) {
  const rep = A.studentReport(sid);
  for (const k of ['harderThanBatch', 'easierThanBatch', 'harderThanTeacher', 'confidentOnHard'])
    rep[k] = rep[k].map(qLite).map(d => ({ ...d, felt: half(d.felt), vsBatch: half(d.vsBatch) }));
  rep.topics = rep.topics.map(o => ({ ...o, vsBatch: half(o.vsBatch) }));
  return { rep, batchSize: A.NS };
}
async function studentView(req, ex) {
  const sid = req.user.studentId;
  if (!(await hasSurvey(ex, sid))) return { exam: examCard(ex), rep: null, locked: ex.surveyOpen ? 'survey' : 'missed' };
  const { A, ready } = await X.engineFor(ex._id);
  if (!A || !ready) return { exam: examCard(ex), rep: null, waiting: { have: A ? A.NS : 0, need: X.MIN_READY } };
  return { exam: examCard(ex), A };
}
app.get('/api/student/exams', auth('student'), wrap(async (req, res) => {
  const sid = req.user.studentId;
  const exams = await col('exams').find({ status: { $in: ['published', 'closed'] }, ...mine(req) }).sort({ examDate: -1 }).toArray();
  const surveyed = new Set((await col('surveys').find({ studentId: sid }, { projection: { examId: 1 } }).toArray()).map(s => s.examId));
  res.json({ exams: exams.map(ex => ({ ...examCard(ex), surveyed: surveyed.has(ex._id), hasReport: surveyed.has(ex._id) })) });
}));
app.get('/api/student/report', auth('student'), wrap(async (req, res) => {
  let ex = req.query.exam ? await examOr404(req.query.exam, { status: { $ne: 'draft' }, ...mine(req) }) : null;
  if (!ex) {   // default: the newest exam this student has rated
    const rated = (await col('surveys').find({ studentId: req.user.studentId }, { projection: { examId: 1 } }).toArray()).map(s => s.examId);
    ex = await col('exams').find({ _id: { $in: rated }, ...mine(req) }).sort({ examDate: -1 }).limit(1).next() || await latestReady(mine(req));
  }
  if (!ex) return res.json({ exam: null });
  const v = await studentView(req, ex);
  if (!v.A) return res.json(v);
  const { rep, batchSize } = studentPayload(v.A, req.user.studentId);
  const survey = await col('surveys').findOne({ studentId: req.user.studentId, examId: ex._id }, { projection: { _id: 0, answers: 0 } });
  res.json({ exam: v.exam, rep, batchSize, survey, student: v.A.STUDENTS.find(s => s.id === req.user.studentId) });
}));
app.get('/api/student/recommendations', auth('student'), wrap(async (req, res) => {
  const ex = req.query.exam ? await examOr404(req.query.exam, { status: { $ne: 'draft' }, ...mine(req) }) : null;
  if (!ex) return res.json({ items: [] });
  const v = await studentView(req, ex);
  if (!v.A) return res.json({ exam: v.exam, items: [], locked: v.locked, waiting: v.waiting });
  res.json({ exam: v.exam, items: await X.recosFor(v.A.studentReport(req.user.studentId)) });
}));
app.get('/api/student/history', auth('student'), wrap(async (req, res) => {
  const sid = req.user.studentId;
  const [rows, surveys, exams] = await Promise.all([
    col('student_history').find({ studentId: sid }, { projection: { _id: 0 } }).sort({ examDate: -1 }).toArray(),
    col('surveys').find({ studentId: sid }, { projection: { _id: 0, answers: 0 } }).toArray(),
    col('exams').find({ status: { $in: ['published', 'closed'] }, ...mine(req) }).sort({ examDate: -1 }).toArray()
  ]);
  const byExam = new Map(rows.map(r => [r.examId, r]));
  const sv = new Map(surveys.map(s => [s.examId, s]));
  res.json({ items: exams.map(ex => ({ exam: examCard(ex), history: sv.has(ex._id) ? (byExam.get(ex._id) || null) : null, survey: sv.get(ex._id) || null, locked: !sv.has(ex._id) })) });
}));
app.get('/api/student/notifications', auth('student'), wrap(async (req, res) => {
  const items = await col('notifications').find({ studentId: req.user.studentId }, { projection: { _id: 0 } }).sort({ createdAt: -1 }).limit(30).toArray();
  const open = new Map((await col('exams').find({ _id: { $in: items.map(i => i.examId) } }).toArray()).map(e => [e._id, e.surveyOpen]));
  res.json({ items: items.map(n => ({ ...n, surveyOpen: !!open.get(n.examId) })), unread: items.filter(n => !n.readAt).length, pending: items.filter(n => !n.doneAt && open.get(n.examId)).length });
}));
app.post('/api/student/notifications/read', auth('student'), wrap(async (req, res) => {
  await col('notifications').updateMany({ studentId: req.user.studentId, readAt: null }, { $set: { readAt: new Date() } });
  res.json({ ok: true });
}));

function cleanAnswers(raw, qids) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const qid of qids) {
    const a = Object.hasOwn(raw, qid) ? raw[qid] : null; if (!a || typeof a !== 'object') continue;
    if (Number.isInteger(a.self) && a.self >= 1 && a.self <= 4) out[qid] = { self: a.self };   // one tap per question
  }
  return out;
}
app.get('/api/student/survey', auth('student'), wrap(async (req, res) => {
  const sid = req.user.studentId;
  const ex = await examOr404(req.query.exam, { status: { $in: ['published', 'closed'] }, ...mine(req) });
  const qs = await col('questions').find({ examId: ex._id, qid: { $in: ex.surveyQids } }, { projection: { _id: 0, qid: 1, topic: 1, text: 1, n: 1 } }).sort({ n: 1 }).toArray();
  const draft = await col('survey_drafts').findOne({ studentId: sid, examId: ex._id });
  const done = await col('surveys').findOne({ studentId: sid, examId: ex._id }, { projection: { _id: 0, answers: 0 } });
  await col('notifications').updateOne({ studentId: sid, examId: ex._id, kind: 'survey', readAt: null }, { $set: { readAt: new Date() } });
  res.json({ exam: examCard(ex), questions: qs.map(q => ({ id: q.qid, topic: q.topic, text: q.text })), answers: draft?.answers || {}, done, open: !!ex.surveyOpen });
}));
app.put('/api/student/survey/draft', auth('student'), wrap(async (req, res) => {
  const ex = await examOr404(req.body?.exam, { status: 'published', surveyOpen: true, ...mine(req) });
  if (await col('surveys').findOne({ studentId: req.user.studentId, examId: ex._id })) throw new HttpError(409, 'You already submitted this survey.');
  const answers = cleanAnswers(req.body?.answers, ex.surveyQids);
  await col('survey_drafts').updateOne({ studentId: req.user.studentId, examId: ex._id }, { $set: { answers, updatedAt: new Date() } }, { upsert: true });
  res.json({ saved: Object.keys(answers).length });
}));
/* one-time: the unique index on surveys {studentId, examId} makes a second submit impossible, even under a race */
app.post('/api/student/survey/submit', auth('student'), wrap(async (req, res) => {
  const sid = req.user.studentId;
  const ex = await examOr404(req.body?.exam, { status: { $in: ['published', 'closed'] }, ...mine(req) });
  if (await col('surveys').findOne({ studentId: sid, examId: ex._id })) throw new HttpError(409, 'You already submitted this survey — it can only be taken once.');
  if (!ex.surveyOpen) throw new HttpError(423, 'This survey is closed.');
  const answers = cleanAnswers(req.body?.answers, ex.surveyQids);
  if (ex.surveyQids.some(q => !answers[q]?.self)) throw new HttpError(400, `Rate all ${ex.surveyQids.length} questions before submitting.`);
  const secs = Number.isInteger(req.body?.secs) && req.body.secs > 0 && req.body.secs < 7200 ? req.body.secs : null;
  try {
    await col('surveys').insertOne({ studentId: sid, examId: ex._id, answers, secs, count: ex.surveyQids.length, at: new Date() });
  } catch (e) { if (e.code === 11000) throw new HttpError(409, 'You already submitted this survey — it can only be taken once.'); throw e }
  X.bump(ex._id);
  const { ready, A } = await X.engineFor(ex._id);
  if (ready && !ex.ready) await col('exams').updateOne({ _id: ex._id }, { $set: { ready: true, readyAt: new Date() } });
  if (ready) await X.snapshot(ex._id);           // every classmate's comparison moves when the batch grows
  await col('survey_drafts').deleteOne({ studentId: sid, examId: ex._id });
  await col('notifications').updateOne({ studentId: sid, examId: ex._id, kind: 'survey' }, { $set: { doneAt: new Date(), readAt: new Date() } });
  await audit(req.user, 'survey.submit', { exam: ex._id });
  res.json({ survey: { examId: ex._id, secs, count: ex.surveyQids.length, at: new Date(), comfortPct: ready ? A.studentReport(sid).comfortPct : null },
    ready, batchSize: A ? A.NS : 0, need: X.MIN_READY });
}));

/* ---------- staff ---------- */
app.get('/api/exams', auth('teacher', 'company'), wrap(async (req, res) => {
  const exams = await col('exams').find(scopeFilter(req)).sort({ examDate: -1 }).toArray();
  const counts = await col('surveys').aggregate([{ $group: { _id: '$examId', n: { $sum: 1 } } }]).toArray();
  const cm = new Map(counts.map(c => [c._id, c.n]));
  const qc = new Map((await col('questions').aggregate([{ $group: { _id: '$examId', n: { $sum: 1 } } }]).toArray()).map(c => [c._id, c.n]));
  res.json({ exams: exams.map(ex => ({ ...examCard(ex), questions: qc.get(ex._id) || 0, surveys: cm.get(ex._id) || 0 })), students: await col('students').countDocuments({}), minReady: X.MIN_READY });
}));
/* branch heads: aggregates only, for exams of batches in their branch */
app.get('/api/branch/summary', auth('branch'), wrap(async (req, res) => {
  const batches = (await col('batches').find({ branch: req.user.branch }).toArray()).map(b => b._id);
  const exams = await col('exams').find({ batchId: { $in: batches }, status: { $ne: 'draft' } }).sort({ examDate: -1 }).toArray();
  const out = [];
  for (const ex of exams) {
    const { A, ready } = await X.engineFor(ex._id);
    const br = A && ready ? A.batchReport() : null;
    out.push({ exam: examCard(ex), surveys: await col('surveys').countDocuments({ examId: ex._id }), ready,
      ceilings: br ? A.BATCH_CEIL : null, prio: br ? br.prio.map(p => ({ topic: p.t.name, verdict: p.verdict, l1: p.l1, l2: p.l2, l3: p.l3, below: p.below })) : null,
      comfort: br ? br.comfort : null, rTeacher: br ? br.rTeacher : null });
  }
  res.json({ branch: req.user.branchName, batches: batches.length, students: await col('students').countDocuments({ batchId: { $in: batches } }), exams: out });
}));
/* company: every exam + the questions whose felt difficulty disagrees with the teacher's rating */
app.get('/api/company/overview', auth('company'), wrap(async (req, res) => {
  const exams = await col('exams').find({ status: { $ne: 'draft' } }).sort({ examDate: -1 }).toArray();
  const rows = [], review = [];
  for (const ex of exams) {
    const { A, ready } = await X.engineFor(ex._id);
    const br = A && ready ? A.batchReport() : null;
    rows.push({ exam: examCard(ex), surveys: await col('surveys').countDocuments({ examId: ex._id }), ready, comfort: br?.comfort ?? null, rTeacher: br?.rTeacher ?? null, avgCalib: br?.avgCalib ?? null });
    if (br) for (const q of [...br.harder, ...br.easier]) review.push({ exam: ex.title, examId: ex._id, qid: q.id, topic: q.topic, text: q.text, teacherBand: q.teacherBand, felt: A.QF[q.id].felt, gap: A.QF[q.id].gap });
  }
  review.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  const reviewed = new Set((await col('review_flags').find({}).toArray()).map(r => r.key));
  res.json({ exams: rows, review: review.slice(0, 30).map(r => ({ ...r, reviewed: reviewed.has(r.examId + ':' + r.qid) })), students: await col('students').countDocuments({}) });
}));
app.post('/api/company/review', auth('company'), wrap(async (req, res) => {
  const examId = examParam(req.body?.exam), qid = typeof req.body?.qid === 'string' && /^Q\d{1,3}$/.test(req.body.qid) ? req.body.qid : null;
  if (!examId || !qid || !(await col('questions').findOne({ examId, qid }))) throw new HttpError(404, 'Unknown question.');
  const key = examId + ':' + qid;
  if (req.body?.done === false) await col('review_flags').deleteOne({ key });
  else await col('review_flags').updateOne({ key }, { $setOnInsert: { key, examId, qid, at: new Date(), by: req.user.email } }, { upsert: true });
  await audit(req.user, 'item.review', { key, done: req.body?.done !== false });
  res.json({ ok: true });
}));
/* individual named ratings: the teacher of that batch only — company and branch get aggregates */
app.get('/api/batch', auth('teacher'), wrap(async (req, res) => {
  const ex = req.query.exam ? await examOr404(req.query.exam, scopeFilter(req)) : await latestReady(scopeFilter(req));
  if (!ex) throw new HttpError(404, 'No exam with enough surveys yet.');
  const { data, ready } = await X.engineFor(ex._id);
  res.json({ exam: examCard(ex), ready, need: X.MIN_READY, ...data });
}));

/* teacher: create exam → rate difficulty → approve (notifies students) → students rate → close & finalise. No marks. */
const TOPIC_BY = new Map(E.TOPICS.flatMap(t => [[t.id, t.id], [t.name.toLowerCase(), t.id]]));
function parseCsvLine(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ } else if (c === '"') q = false; else cur += c }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = '' } else cur += c;
  }
  out.push(cur); return out.map(s => s.trim());
}
app.post('/api/teacher/exams', auth('teacher'), wrap(async (req, res) => {
  const title = str(req.body?.title, 80)?.trim(), text = str(req.body?.csv, 200 * 1024);
  if (!title || title.length < 3) throw new HttpError(400, 'Give the exam a title (3–80 characters).');
  if (text == null) throw new HttpError(400, 'Questions CSV missing or larger than 200 KB.');
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  const head = parseCsvLine(lines[0] || '').map(h => h.toLowerCase());
  const want = ['topic', 'question', 'a', 'b', 'c', 'd', 'answer'];
  if (want.some((w, i) => head[i] !== w)) throw new HttpError(400, 'Header must be: topic,question,A,B,C,D,answer (answer may be blank)');
  const qs = [], errors = [];
  lines.slice(1, 61).forEach((l, i) => {
    const c = parseCsvLine(l), row = i + 2;
    const topic = TOPIC_BY.get((c[0] || '').toLowerCase());
    const ans = 'ABCD'.indexOf((c[6] || '').toUpperCase());
    if (!topic) return errors.push(`Row ${row}: topic must be one of ${E.TOPICS.map(t => t.name).join(', ')}`);
    if (!c[1] || c[1].length > 400) return errors.push(`Row ${row}: question text missing or longer than 400 characters`);
    if (c.slice(2, 6).some(o => !o || o.length > 120)) return errors.push(`Row ${row}: all four options A–D are required (≤120 characters)`);
    if (c[6] && (ans < 0 || c[6].length !== 1)) return errors.push(`Row ${row}: answer, if given, must be A, B, C or D`);
    qs.push({ topic, text: c[1], options: c.slice(2, 6), answer: ans >= 0 ? ans : null });   // v3 never needs the key; kept for the teacher only
  });
  if (lines.length > 61) errors.push('Only the first 60 questions are read.');
  if (errors.length || qs.length < 4) throw new HttpError(400, (qs.length < 4 && !errors.length ? 'Add at least 4 questions.' : errors.slice(0, 6).join(' · ')));
  const last = await col('exams').find({}).sort({ createdAt: -1 }).toArray();
  const nextN = Math.max(0, ...last.map(e => +e._id.slice(1))) + 1, id = 'E' + nextN;
  const now = new Date();
  const batchId = (Array.isArray(req.user.batchIds) && req.user.batchIds[0]) || null;
  if (!batchId) throw new HttpError(403, 'You are not assigned to a batch.');
  await col('exams').insertOne({ _id: id, title, subject: 'Physics', batchId, createdBy: req.user.email, createdAt: now, examDate: now,
    status: 'draft', surveyOpen: false, ready: false, surveyQids: qs.map((_, i) => 'Q' + (i + 1)) });
  await col('questions').insertMany(qs.map((q, i) => ({ _id: `${id}:Q${i + 1}`, examId: id, qid: 'Q' + (i + 1), n: i + 1, ...q, teacherBand: null, poolP: null })));
  await audit(req.user, 'exam.create', { exam: id, questions: qs.length });
  res.json({ exam: { id, title, questions: qs.length } });
}));
app.get('/api/teacher/exams/:id', auth('teacher'), wrap(async (req, res) => {
  const ex = await examOr404(req.params.id, scopeFilter(req));
  const qs = await col('questions').find({ examId: ex._id }, { projection: { _id: 0 } }).sort({ n: 1 }).toArray();
  res.json({ exam: examCard(ex), questions: qs.map(q => ({ id: q.qid, topic: q.topic, text: q.text, options: q.options, answer: q.answer, teacherBand: q.teacherBand })) });
}));
app.put('/api/teacher/exams/:id/difficulty', auth('teacher'), wrap(async (req, res) => {
  const ex = await examOr404(req.params.id, { status: 'draft' , ...scopeFilter(req) });
  const marks = req.body?.bands;
  if (!marks || typeof marks !== 'object' || Array.isArray(marks)) throw new HttpError(400, 'bands must be an object of question → L1..L4');
  const BAND_P = { L1: 0.87, L2: 0.62, L3: 0.37, L4: 0.12 };
  const ops = ex.surveyQids.filter(q => Object.hasOwn(marks, q) && typeof marks[q] === 'string' && Object.hasOwn(BAND_P, marks[q]))
    .map(q => ({ updateOne: { filter: { examId: ex._id, qid: q }, update: { $set: { teacherBand: marks[q], poolP: BAND_P[marks[q]] } } } }));
  if (ops.length) await col('questions').bulkWrite(ops);
  const missing = await col('questions').countDocuments({ examId: ex._id, teacherBand: null });
  res.json({ saved: ops.length, missing });
}));
app.post('/api/teacher/exams/:id/approve', auth('teacher'), wrap(async (req, res) => {
  const ex = await examOr404(req.params.id, { status: 'draft' , ...scopeFilter(req) });
  const missing = await col('questions').countDocuments({ examId: ex._id, teacherBand: null });
  if (missing) throw new HttpError(400, `Mark the difficulty of every question first — ${missing} left.`);
  const upd = await col('exams').findOneAndUpdate({ _id: ex._id, status: 'draft' }, { $set: { status: 'published', surveyOpen: true, approvedAt: new Date() } }, { returnDocument: 'after' });
  const students = (await col('students').find({ batchId: ex.batchId }, { projection: { _id: 1 } }).toArray()).map(s => s._id);
  const n = await X.notifySurvey(upd, students);
  await audit(req.user, 'exam.approve', { exam: ex._id, notified: n });
  res.json({ exam: examCard(upd), notified: n });
}));
app.delete('/api/teacher/exams/:id', auth('teacher'), wrap(async (req, res) => {
  const ex = await examOr404(req.params.id, { status: 'draft' , ...scopeFilter(req) });
  await col('questions').deleteMany({ examId: ex._id }); await col('exams').deleteOne({ _id: ex._id, status: 'draft' });
  await audit(req.user, 'exam.delete', { exam: ex._id });
  res.json({ ok: true });
}));
app.get('/api/teacher/survey-status', auth('teacher'), wrap(async (req, res) => {
  const ex = await examOr404(req.query.exam, scopeFilter(req));
  res.json({ exam: examCard(ex), open: !!ex.surveyOpen, submitted: await col('surveys').countDocuments({ examId: ex._id }), total: await col('students').countDocuments({ batchId: ex.batchId }) });
}));
app.post('/api/teacher/exams/:id/survey/:action', auth('teacher'), wrap(async (req, res) => {
  const a = req.params.action;
  if (a !== 'open' && a !== 'close') throw new HttpError(404, 'Unknown action.');
  const ex = await examOr404(req.params.id, { status: { $in: ['published', 'closed'] } , ...scopeFilter(req) });
  // closing finalises the exam: history snapshots are frozen as final, and it cannot re-open
  if (a === 'open' && ex.status === 'closed') throw new HttpError(409, 'This survey is closed and final — it cannot re-open.');
  await col('exams').updateOne({ _id: ex._id }, { $set: a === 'open' ? { surveyOpen: true, status: 'published' } : { surveyOpen: false, status: 'closed', closedAt: new Date() } });
  if (a === 'close') { X.bump(ex._id); await X.snapshot(ex._id) }
  await audit(req.user, 'survey.' + a, { exam: ex._id });
  res.json({ open: a === 'open' });
}));
app.get('/api/recommendations/:topic/:band', auth(), wrap(async (req, res) => {
  const t = E.TOPICS.find(x => x.id === req.params.topic), b = E.BANDS.find(x => x.id === req.params.band);
  if (!t || !b) throw new HttpError(404, 'Unknown topic or band.');
  res.json(await getRecommendations(t.id, t.name, b.id));
}));

app.get('/api/health', wrap(async (req, res) => {
  if (!dbReady) return res.status(503).json({ ok: false, db: 'connecting' });
  await col('users').estimatedDocumentCount(); res.json({ ok: true, db: 'mongodb' });
}));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

/* static frontend */
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', extensions: ['html'], maxAge: 0 }));

/* errors: message for expected ones, nothing internal for the rest */
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON.' });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side.' });
});

/* first boot on an empty database (e.g. a fresh Railway deploy): load the demo data in the background */
async function autoSeed() {
  if (process.env.AUTO_SEED === 'false') return;
  if (await col('users').estimatedDocumentCount()) return;
  console.log('Empty database — seeding demo data in the background…');
  const child = require('child_process').spawn(process.execPath, [path.join(__dirname, 'seed.js')], { stdio: 'inherit', env: process.env });
  child.on('exit', code => console.log(code === 0 ? 'Demo data ready.' : 'Seeding failed with code ' + code));
}

if (require.main === module) {
  const HOST = process.env.HOST || '0.0.0.0';
  // listen first, then keep retrying MongoDB: a slow or missing database must not crash-loop the container
  app.listen(PORT, HOST, () => console.log(`ANUMAAN listening on ${HOST}:${PORT}`));
  if (process.env.RAILWAY_ENVIRONMENT && !process.env.MONGO_URL && !process.env.MONGO_URI)
    console.error('MONGO_URL is not set. In Railway add a MongoDB service and set MONGO_URL=${{MongoDB.MONGO_URL}} on this service.');
  process.on('unhandledRejection', e => console.error('Unhandled rejection:', e));
  (async function start(attempt = 1) {
    try {
      await connect();
      dbReady = true;
      console.log('MongoDB connected (database ' + DB_NAME + ')');
      await autoSeed();
    } catch (e) {
      await close().catch(() => {});
      const wait = Math.min(30, 2 * attempt);
      console.error(`MongoDB not reachable (attempt ${attempt}): ${e.message} — retrying in ${wait}s`);
      setTimeout(() => start(attempt + 1), wait * 1000);
    }
  })();
}
module.exports = { app, routeFor };
