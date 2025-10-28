-- sql: db:config
PRAGMA foreign_keys=ON;

-- config.db schema
CREATE TABLE IF NOT EXISTS partitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('media','image_search','av_search','jobs','config')),
  file_path TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_partitions_role_name ON partitions(role, name);

CREATE TABLE IF NOT EXISTS migrations (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('media','image_search','av_search','jobs','config')),
  version INTEGER NOT NULL,
  applied_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_migrations_role ON migrations(role);
