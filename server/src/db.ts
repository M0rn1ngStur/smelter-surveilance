import path from 'path';
import Database from 'better-sqlite3';

const DB_PATH = path.join(__dirname, '..', 'data.db');

let db: Database.Database;

export function initDb(): void {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS recordings (
      filename TEXT PRIMARY KEY,
      inputId TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      durationMs INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS camera_names (
      inputId TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      subscription TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS segments (
      filename TEXT PRIMARY KEY,
      inputId TEXT NOT NULL,
      startTimestamp INTEGER NOT NULL,
      endTimestamp INTEGER,
      durationMs INTEGER,
      hasMotion INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Recreate analyses table without FK constraint (analyses now reference segments, not recordings)
  const hasOldFk = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='analyses'`).get() as { sql: string } | undefined;
  if (hasOldFk && hasOldFk.sql.includes('REFERENCES')) {
    db.exec(`
      ALTER TABLE analyses RENAME TO analyses_old;
      CREATE TABLE analyses (
        filename TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        severity TEXT NOT NULL,
        analyzedAt INTEGER NOT NULL
      );
      INSERT INTO analyses SELECT * FROM analyses_old;
      DROP TABLE analyses_old;
    `);
  } else {
    db.exec(`
      CREATE TABLE IF NOT EXISTS analyses (
        filename TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        severity TEXT NOT NULL,
        analyzedAt INTEGER NOT NULL
      );
    `);
  }
}

// --- Recordings ---

const insertRecordingSQL = `INSERT OR REPLACE INTO recordings (filename, inputId, timestamp, durationMs) VALUES (?, ?, ?, ?)`;
const loadRecordingsSQL = `
  SELECT r.filename, r.inputId, r.timestamp, r.durationMs,
         a.description, a.severity, a.analyzedAt
  FROM recordings r
  LEFT JOIN analyses a ON r.filename = a.filename
  ORDER BY r.timestamp DESC
`;
const deleteRecordingSQL = `DELETE FROM recordings WHERE filename = ?`;
const deleteAnalysisForRecordingSQL = `DELETE FROM analyses WHERE filename = ?`;

export interface DbRecordingRow {
  filename: string;
  inputId: string;
  timestamp: number;
  durationMs: number;
  description: string | null;
  severity: string | null;
  analyzedAt: number | null;
}

export function dbInsertRecording(rec: { filename: string; inputId: string; timestamp: number; durationMs: number }): void {
  db.prepare(insertRecordingSQL).run(rec.filename, rec.inputId, rec.timestamp, rec.durationMs);
}

export function dbLoadRecordings(): DbRecordingRow[] {
  return db.prepare(loadRecordingsSQL).all() as DbRecordingRow[];
}

export function dbDeleteRecording(filename: string): void {
  db.prepare(deleteAnalysisForRecordingSQL).run(filename);
  db.prepare(deleteRecordingSQL).run(filename);
}

// --- Analyses ---

const insertAnalysisSQL = `INSERT OR REPLACE INTO analyses (filename, description, severity, analyzedAt) VALUES (?, ?, ?, ?)`;
const loadAnalysesSQL = `SELECT filename, description, severity, analyzedAt FROM analyses`;

export interface DbAnalysisRow {
  filename: string;
  description: string;
  severity: string;
  analyzedAt: number;
}

export function dbInsertAnalysis(filename: string, analysis: { description: string; severity: string; analyzedAt: number }): void {
  db.prepare(insertAnalysisSQL).run(filename, analysis.description, analysis.severity, analysis.analyzedAt);
}

export function dbLoadAnalyses(): Map<string, { description: string; severity: string; analyzedAt: number }> {
  const rows = db.prepare(loadAnalysesSQL).all() as DbAnalysisRow[];
  const map = new Map<string, { description: string; severity: string; analyzedAt: number }>();
  for (const row of rows) {
    map.set(row.filename, { description: row.description, severity: row.severity, analyzedAt: row.analyzedAt });
  }
  return map;
}

// --- Settings ---

const getSettingSQL = `SELECT value FROM settings WHERE key = ?`;
const setSettingSQL = `INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`;

export function dbGetSetting(key: string): string | undefined {
  const row = db.prepare(getSettingSQL).get(key) as { value: string } | undefined;
  return row?.value;
}

export function dbSetSetting(key: string, value: string): void {
  db.prepare(setSettingSQL).run(key, value);
}

// --- Camera Names ---

const setCameraNameSQL = `INSERT OR REPLACE INTO camera_names (inputId, name) VALUES (?, ?)`;
const deleteCameraNameSQL = `DELETE FROM camera_names WHERE inputId = ?`;
const loadCameraNamesSQL = `SELECT inputId, name FROM camera_names`;

export function dbSetCameraName(inputId: string, name: string): void {
  db.prepare(setCameraNameSQL).run(inputId, name);
}

export function dbDeleteCameraName(inputId: string): void {
  db.prepare(deleteCameraNameSQL).run(inputId);
}

export function dbLoadCameraNames(): Map<string, string> {
  const rows = db.prepare(loadCameraNamesSQL).all() as { inputId: string; name: string }[];
  const map = new Map<string, string>();
  for (const row of rows) {
    map.set(row.inputId, row.name);
  }
  return map;
}

// --- Push Subscriptions ---

const insertPushSubSQL = `INSERT OR REPLACE INTO push_subscriptions (endpoint, subscription) VALUES (?, ?)`;
const deletePushSubSQL = `DELETE FROM push_subscriptions WHERE endpoint = ?`;
const loadPushSubsSQL = `SELECT subscription FROM push_subscriptions`;

export function dbSavePushSubscription(subscription: { endpoint: string }): void {
  db.prepare(insertPushSubSQL).run(subscription.endpoint, JSON.stringify(subscription));
}

export function dbDeletePushSubscription(endpoint: string): void {
  db.prepare(deletePushSubSQL).run(endpoint);
}

export function dbLoadPushSubscriptions(): string[] {
  const rows = db.prepare(loadPushSubsSQL).all() as { subscription: string }[];
  return rows.map((r) => r.subscription);
}

// --- Segments ---

const insertSegmentSQL = `INSERT OR REPLACE INTO segments (filename, inputId, startTimestamp, hasMotion) VALUES (?, ?, ?, 0)`;
const updateSegmentEndSQL = `UPDATE segments SET endTimestamp = ?, durationMs = ? WHERE filename = ?`;
const markSegmentMotionSQL = `UPDATE segments SET hasMotion = 1 WHERE filename = ?`;
const loadSegmentsSQL = `
  SELECT s.filename, s.inputId, s.startTimestamp, s.endTimestamp, s.durationMs, s.hasMotion,
         a.description, a.severity, a.analyzedAt
  FROM segments s
  LEFT JOIN analyses a ON s.filename = a.filename
  ORDER BY s.startTimestamp DESC
`;
const deleteSegmentSQL = `DELETE FROM segments WHERE filename = ?`;

export interface DbSegmentRow {
  filename: string;
  inputId: string;
  startTimestamp: number;
  endTimestamp: number | null;
  durationMs: number | null;
  hasMotion: number;
  description: string | null;
  severity: string | null;
  analyzedAt: number | null;
}

export function dbInsertSegment(seg: { filename: string; inputId: string; startTimestamp: number }): void {
  db.prepare(insertSegmentSQL).run(seg.filename, seg.inputId, seg.startTimestamp);
}

export function dbUpdateSegmentEnd(filename: string, endTimestamp: number, durationMs: number): void {
  db.prepare(updateSegmentEndSQL).run(endTimestamp, durationMs, filename);
}

export function dbMarkSegmentMotion(filename: string): void {
  db.prepare(markSegmentMotionSQL).run(filename);
}

export function dbLoadSegments(): DbSegmentRow[] {
  return db.prepare(loadSegmentsSQL).all() as DbSegmentRow[];
}

export function dbDeleteSegment(filename: string): void {
  db.prepare(deleteAnalysisForRecordingSQL).run(filename);
  db.prepare(deleteSegmentSQL).run(filename);
}
