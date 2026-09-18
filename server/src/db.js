"use strict";
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

// Uses Node's built-in SQLite (stable API in Node 22.5+, still flagged
// "experimental" by Node itself) instead of a native-compiled dependency
// like better-sqlite3 — keeps `npm install` fast and portable for a pilot
// this size. Swap for Postgres (or better-sqlite3) if this grows past a
// single small deployment or needs concurrent writers.
let db = null;

function getDb() {
  if (db) return db;
  const dbPath = process.env.DB_PATH || path.join(__dirname, "..", "data", "app.db");
  db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

function migrate(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      diagnosis_subtype TEXT NOT NULL,
      sessions_per_week INTEGER NOT NULL,
      target_rpe_min REAL NOT NULL,
      target_rpe_max REAL NOT NULL,
      cleared_for_exercise INTEGER NOT NULL DEFAULT 1,
      in_flare INTEGER NOT NULL DEFAULT 0,
      sharing_enabled INTEGER NOT NULL DEFAULT 0,
      local_pt_name TEXT
    );

    CREATE TABLE IF NOT EXISTS program_exercises (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL REFERENCES patients(id),
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      prescription TEXT NOT NULL,
      progression_json TEXT,
      history_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS daily_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT NOT NULL REFERENCES patients(id),
      date TEXT NOT NULL,
      logged INTEGER NOT NULL DEFAULT 1,
      completed INTEGER NOT NULL DEFAULT 0,
      rpe REAL,
      pain REAL,
      fatigue REAL,
      recovery TEXT,
      progressive INTEGER,
      adl_impact INTEGER,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS fom_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT NOT NULL REFERENCES patients(id),
      date TEXT NOT NULL,
      gait_speed REAL,
      tug REAL,
      sts30 REAL,
      sts5x REAL,
      mwt2 REAL,
      mwt6 REAL,
      fi2 REAL,
      fi3 REAL,
      ibmfrs_items_json TEXT,
      ibmfrs_total INTEGER
    );

    CREATE TABLE IF NOT EXISTS mmt_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT NOT NULL REFERENCES patients(id),
      date TEXT NOT NULL,
      hip_flexors REAL,
      knee_extensors REAL,
      shoulder_abductors REAL,
      ankle_dorsiflexors REAL
    );

    CREATE TABLE IF NOT EXISTS sharing_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT UNIQUE NOT NULL,
      patient_id TEXT NOT NULL REFERENCES patients(id),
      pt_email TEXT NOT NULL,
      pt_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      last_accessed_at TEXT,
      access_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_sharing_links_token ON sharing_links(token);
    CREATE INDEX IF NOT EXISTS idx_sharing_links_patient ON sharing_links(patient_id);
  `);
}

// Test helper: fresh isolated in-memory DB per call, so tests never share
// state with each other or with the on-disk dev/demo database.
function createTestDb() {
  const testDb = new DatabaseSync(":memory:");
  migrate(testDb);
  return testDb;
}

function resetForTests() {
  db = null;
}

module.exports = { getDb, migrate, createTestDb, resetForTests };
