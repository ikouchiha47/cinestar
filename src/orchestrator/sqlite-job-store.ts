import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { Job, JobEvent, JobStatus, JobStore } from './types';

export class SQLiteJobStore implements JobStore {
  private db: Database.Database;

  constructor(dbPath = path.resolve(process.cwd(), 'data', 'jobs.db')) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        video_path TEXT NOT NULL,
        video_id TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS job_dependencies (
        job_id TEXT NOT NULL,
        depends_on_job_id TEXT NOT NULL,
        PRIMARY KEY (job_id, depends_on_job_id)
      );
      CREATE TABLE IF NOT EXISTS job_events (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL,
        payload_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      CREATE INDEX IF NOT EXISTS idx_events_job ON job_events(job_id, ts);
    `);
  }

  create(job: Omit<Job, 'status' | 'createdAt'>): Job {
    const full: Job = {
      ...job,
      status: 'pending',
      createdAt: new Date(),
    };
    const stmt = this.db.prepare(`INSERT INTO jobs (id, video_path, video_id, status, created_at) VALUES (?, ?, ?, ?, ?)`);
    stmt.run(full.id, full.videoPath, full.videoId ?? null, full.status, +full.createdAt);
    return full;
  }

  get(id: string): Job | undefined {
    const row = this.db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as any;
    if (!row) return undefined;
    return this.rowToJob(row);
  }

  update(id: string, patch: Partial<Job>): Job | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    const updated: Job = { ...existing, ...patch } as Job;
    const stmt = this.db.prepare(`
      UPDATE jobs SET
        video_path = COALESCE(?, video_path),
        video_id = COALESCE(?, video_id),
        status = COALESCE(?, status),
        created_at = COALESCE(?, created_at),
        started_at = COALESCE(?, started_at),
        completed_at = COALESCE(?, completed_at),
        error = COALESCE(?, error)
      WHERE id = ?
    `);
    stmt.run(
      updated.videoPath ?? null,
      updated.videoId ?? null,
      updated.status ?? null,
      updated.createdAt ? +updated.createdAt : null,
      updated.startedAt ? +updated.startedAt : null,
      updated.completedAt ? +updated.completedAt : null,
      updated.error ?? null,
      id
    );
    return this.get(id);
  }

  list(status?: JobStatus): Job[] {
    const rows = status
      ? this.db.prepare(`SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC`).all(status)
      : this.db.prepare(`SELECT * FROM jobs ORDER BY created_at DESC`).all();
    return (rows as any[]).map(r => this.rowToJob(r));
  }

  addEvent(event: JobEvent): void {
    const id = event.id ?? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const stmt = this.db.prepare(`
      INSERT INTO job_events (id, job_id, ts, level, message, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, event.jobId, +event.ts, event.level, event.message, event.payloadJson ?? null);
  }

  private rowToJob(row: any): Job {
    return {
      id: row.id,
      videoPath: row.video_path,
      videoId: row.video_id ?? undefined,
      status: row.status as JobStatus,
      createdAt: new Date(row.created_at),
      startedAt: row.started_at ? new Date(row.started_at) : undefined,
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
      error: row.error ?? undefined,
    };
  }
}
