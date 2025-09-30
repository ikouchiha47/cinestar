-- Migration 006: Create separate database for scene reconstruction jobs
-- Isolated from main video database to prevent inference disruption

-- Scene reconstruction jobs database
CREATE TABLE IF NOT EXISTS scene_reconstruction_jobs (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  video_path TEXT NOT NULL,
  start_time REAL NOT NULL,
  end_time REAL NOT NULL,
  
  -- Job metadata
  job_type TEXT NOT NULL CHECK (job_type IN ('coarse', 'fine')), -- coarse or fine pass
  priority INTEGER NOT NULL DEFAULT 100, -- lower = higher priority
  weight INTEGER NOT NULL DEFAULT 1, -- for weighted fair queueing
  
  -- Processing state
  status TEXT NOT NULL CHECK (status IN ('pending', 'queued', 'processing', 'completed', 'failed', 'delayed')),
  
  -- Content data
  transcription TEXT,
  caption TEXT,
  ocr_text TEXT,
  temporal_context TEXT, -- JSON array of previous scenes
  
  -- Scheduling
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  scheduled_at DATETIME,
  started_at DATETIME,
  completed_at DATETIME,
  
  -- Retry logic
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  last_error TEXT,
  
  -- Results
  reconstructed_scene TEXT,
  processing_time_ms INTEGER,
  
  -- Fair scheduling metadata
  video_length_seconds REAL,
  segment_index INTEGER
  
  -- Note: video_id references video_files(id) in the video database
);

-- Queue management tables
CREATE TABLE IF NOT EXISTS reconstruction_queues (
  id TEXT PRIMARY KEY,
  queue_type TEXT NOT NULL CHECK (queue_type IN ('coarse', 'fine')),
  max_concurrent INTEGER DEFAULT 2,
  batch_size INTEGER DEFAULT 5,
  priority_weight INTEGER DEFAULT 1
);

-- Scheduling configuration
CREATE TABLE IF NOT EXISTS scheduling_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Insert default scheduling configuration
INSERT OR IGNORE INTO scheduling_config (key, value) VALUES
('coarse_queue_batch_size', '5'),
('fine_queue_batch_size', '3'),
('coarse_priority', '10'),
('fine_priority', '100'),
('check_interval_seconds', '300'),
('max_coarse_concurrent', '2'),
('max_fine_concurrent', '1'),
('time_based_check_enabled', 'true'),
('fine_delay_minutes', '15');

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_scene_jobs_video_id ON scene_reconstruction_jobs(video_id);
CREATE INDEX IF NOT EXISTS idx_scene_jobs_status ON scene_reconstruction_jobs(status);
CREATE INDEX IF NOT EXISTS idx_scene_jobs_priority ON scene_reconstruction_jobs(priority, created_at);
CREATE INDEX IF NOT EXISTS idx_scene_jobs_type_status ON scene_reconstruction_jobs(job_type, status);
CREATE INDEX IF NOT EXISTS idx_scene_jobs_scheduled ON scene_reconstruction_jobs(scheduled_at) WHERE status = 'delayed';

-- Queue management indexes
CREATE INDEX IF NOT EXISTS idx_scene_jobs_queued ON scene_reconstruction_jobs(job_type, priority, created_at) WHERE status = 'queued';

-- Update schema version
PRAGMA user_version = 6;
