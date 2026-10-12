/* MongoDB is the only storage this app uses — every collection lives here. */
const { MongoClient } = require('mongodb');

// MONGO_URI, or MONGO_URL as provided by Railway's MongoDB service
const URI = process.env.MONGO_URI || process.env.MONGO_URL || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.MONGO_DB || 'anumaan_v4';
let client, db;

async function connect() {
  if (db) return db;
  client = new MongoClient(URI, { serverSelectionTimeoutMS: 4000 });
  await client.connect();
  db = client.db(DB_NAME);
  try {
    await ensureIndexes(db);
  } catch (e) {
    if (!/disk space/i.test(e.message)) throw e;
    // MongoDB 7.1+ refuses index builds with < 500 MB free disk. Small hosted volumes
    // (Railway's trial volume is 0.5 GB in total) never have that much; this app's data is a few MB.
    console.log('Low free disk on the MongoDB volume — lowering indexBuildMinAvailableDiskSpaceMB to 50');
    await client.db('admin').command({ setParameter: 1, indexBuildMinAvailableDiskSpaceMB: 50 });
    await ensureIndexes(db);
  }
  return db;
}

async function ensureIndexes(d) {
  await Promise.all([
    d.collection('users').createIndex({ email: 1 }, { unique: true }),
    d.collection('sessions').createIndex({ tokenHash: 1 }, { unique: true }),
    d.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),   // TTL: Mongo deletes expired sessions
    d.collection('questions').createIndex({ examId: 1, n: 1 }),
    d.collection('survey_drafts').createIndex({ studentId: 1, examId: 1 }, { unique: true }),
    d.collection('surveys').createIndex({ studentId: 1, examId: 1 }, { unique: true }),      // one survey per student per exam — enforced by MongoDB
    d.collection('student_history').createIndex({ studentId: 1, examId: 1 }, { unique: true }),
    d.collection('notifications').createIndex({ studentId: 1, examId: 1, kind: 1 }, { unique: true }),
    d.collection('notifications').createIndex({ studentId: 1, createdAt: -1 }),
    d.collection('review_flags').createIndex({ key: 1 }, { unique: true }),
    d.collection('recommendations').createIndex({ topic: 1, band: 1 }, { unique: true }),
    d.collection('login_attempts').createIndex({ key: 1 }),
    d.collection('login_attempts').createIndex({ at: 1 }, { expireAfterSeconds: 900 })
  ]);
}

const col = name => db.collection(name);
const dbHandle = () => db;
async function close() { if (client) await client.close(); client = db = null; }

module.exports = { connect, col, close, db: dbHandle, URI, DB_NAME };
