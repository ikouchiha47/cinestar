-- sql: db:jobs
-- sql: attach:vector

-- Create indexing_jobs table in jobs.db if it doesn't exist
CREATE TABLE IF NOT EXISTS indexing_jobs (
  id TEXT PRIMARY KEY,
  source_id TEXT,
  status TEXT,
  progress INTEGER,
  started_at TEXT,
  completed_at TEXT,
  job_title TEXT,
  job_description TEXT,
  operation_type TEXT,
  target_file TEXT,
  total_items INTEGER,
  processed_items INTEGER,
  job_type TEXT,
  file_path TEXT,
  file_name TEXT,
  file_size INTEGER,
  retry_count INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  priority INTEGER DEFAULT 0
);

-- Helpful indexes (idempotent)
CREATE INDEX IF NOT EXISTS idx_indexing_jobs_status ON indexing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_indexing_jobs_job_type ON indexing_jobs(job_type);
CREATE INDEX IF NOT EXISTS idx_indexing_jobs_created_at ON indexing_jobs(created_at);

-- Copy minimal columns from legacy vector.indexing_jobs if present
-- New columns will take defaults on insert
INSERT INTO indexing_jobs (
  id, source_id, status, job_type, file_path, file_name, file_size, retry_count, created_at
)
SELECT 
  v.id,
  v.source_id,
  v.status,
  v.job_type,
  v.file_path,
  v.file_name,
  v.file_size,
  COALESCE(v.retry_count, 0),
  COALESCE(v.created_at, CURRENT_TIMESTAMP)
FROM vector.indexing_jobs v
WHERE NOT EXISTS (
  SELECT 1 FROM indexing_jobs j WHERE j.id = v.id
);
