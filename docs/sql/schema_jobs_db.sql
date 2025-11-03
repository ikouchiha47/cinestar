-- jobs.db schema
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS job_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  pipeline TEXT NOT NULL,
  config_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS job_runs (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES job_definitions(id) ON DELETE CASCADE,
  target_item_id TEXT,
  target_segment_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','failed','canceled')),
  progress INTEGER DEFAULT 0,
  error TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_job_runs_status ON job_runs(status);
CREATE INDEX IF NOT EXISTS idx_job_runs_target ON job_runs(target_item_id);

CREATE TABLE IF NOT EXISTS job_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','failed','canceled')),
  progress INTEGER DEFAULT 0,
  started_at TEXT,
  finished_at TEXT,
  log_offset INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_job_steps_run ON job_steps(run_id);

CREATE TABLE IF NOT EXISTS job_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES job_runs(id) ON DELETE CASCADE,
  step_id TEXT REFERENCES job_steps(id) ON DELETE CASCADE,
  ts TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_job_events_run ON job_events(run_id);
