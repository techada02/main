/**
 * Database setup for Labour Marketplace Platform
 * Creates all required tables in SQLite
 */
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = path.join(__dirname, 'marketplace.db');

function getDb() {
  return new sqlite3.Database(DB_PATH);
}

function setupDatabase() {
  return new Promise((resolve, reject) => {
    const db = getDb();

    db.serialize(() => {
      // Enable WAL mode for better performance
      db.run('PRAGMA journal_mode=WAL');
      db.run('PRAGMA foreign_keys=ON');

      // Users table (both workers and customers share this)
      db.run(`
        CREATE TABLE IF NOT EXISTS users (
          id            TEXT PRIMARY KEY,
          phone         TEXT UNIQUE NOT NULL,
          name          TEXT NOT NULL,
          role          TEXT NOT NULL CHECK(role IN ('worker','customer')),
          otp           TEXT,
          otp_expiry    INTEGER,
          is_verified   INTEGER DEFAULT 0,
          created_at    INTEGER DEFAULT (strftime('%s','now'))
        )
      `);

      // Worker profiles
      db.run(`
        CREATE TABLE IF NOT EXISTS workers (
          user_id         TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          category        TEXT NOT NULL,
          daily_rate      REAL NOT NULL,
          is_available    INTEGER DEFAULT 1,
          lat             REAL,
          lng             REAL,
          rank_level      TEXT DEFAULT 'Bronze' CHECK(rank_level IN ('Bronze','Silver','Gold','Platinum')),
          points          INTEGER DEFAULT 0,
          total_jobs      INTEGER DEFAULT 0,
          completion_rate REAL DEFAULT 100.0,
          aadhaar_verified INTEGER DEFAULT 0,
          bio             TEXT
        )
      `);

      // Jobs table
      db.run(`
        CREATE TABLE IF NOT EXISTS jobs (
          id              TEXT PRIMARY KEY,
          customer_id     TEXT NOT NULL REFERENCES users(id),
          title           TEXT NOT NULL,
          category        TEXT NOT NULL,
          job_type        TEXT NOT NULL CHECK(job_type IN ('hourly','per_unit','full_day','custom')),
          description     TEXT,
          lat             REAL NOT NULL,
          lng             REAL NOT NULL,
          address         TEXT,
          budget_min      REAL,
          budget_max      REAL,
          duration        TEXT,
          is_urgent       INTEGER DEFAULT 0,
          customer_type   TEXT DEFAULT 'individual' CHECK(customer_type IN ('individual','contractor','company','local_shop')),
          status          TEXT DEFAULT 'open' CHECK(status IN ('open','assigned','in_progress','completed','cancelled')),
          assigned_worker TEXT REFERENCES users(id),
          start_otp       TEXT,
          completion_otp  TEXT,
          created_at      INTEGER DEFAULT (strftime('%s','now')),
          started_at      INTEGER,
          completed_at    INTEGER
        )
      `);

      // Job applications / dispatch
      db.run(`
        CREATE TABLE IF NOT EXISTS job_applications (
          id          TEXT PRIMARY KEY,
          job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
          worker_id   TEXT NOT NULL REFERENCES users(id),
          status      TEXT DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','filled')),
          applied_at  INTEGER DEFAULT (strftime('%s','now')),
          UNIQUE(job_id, worker_id)
        )
      `);

      // Ratings & reviews
      db.run(`
        CREATE TABLE IF NOT EXISTS ratings (
          id          TEXT PRIMARY KEY,
          job_id      TEXT NOT NULL REFERENCES jobs(id),
          rater_id    TEXT NOT NULL REFERENCES users(id),
          rated_id    TEXT NOT NULL REFERENCES users(id),
          score       INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),
          review      TEXT,
          created_at  INTEGER DEFAULT (strftime('%s','now'))
        )
      `);

      // SMS / missed call confirmations (keypad phone support)
      db.run(`
        CREATE TABLE IF NOT EXISTS sms_confirmations (
          id            TEXT PRIMARY KEY,
          phone_number  TEXT NOT NULL,
          name          TEXT,
          job_id        TEXT REFERENCES jobs(id),
          confirmed     INTEGER DEFAULT 0,
          sender_phone  TEXT,
          created_at    INTEGER DEFAULT (strftime('%s','now')),
          confirmed_at  INTEGER
        )
      `);

      // Notifications log
      db.run(`
        CREATE TABLE IF NOT EXISTS notifications (
          id          TEXT PRIMARY KEY,
          user_id     TEXT REFERENCES users(id),
          phone       TEXT,
          message     TEXT NOT NULL,
          type        TEXT DEFAULT 'info',
          is_read     INTEGER DEFAULT 0,
          sent_at     INTEGER DEFAULT (strftime('%s','now'))
        )
      `, (err) => {
        if (err) {
          db.close();
          return reject(err);
        }
        db.close();
        console.log('✅ Database setup complete:', DB_PATH);
        resolve(DB_PATH);
      });
    });
  });
}

// Helper to promisify sqlite3 operations
function runQuery(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function getRow(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function getAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

module.exports = { getDb, setupDatabase, runQuery, getRow, getAll, DB_PATH };

// Run setup if called directly
if (require.main === module) {
  setupDatabase()
    .then(() => process.exit(0))
    .catch((err) => { console.error(err); process.exit(1); });
}
