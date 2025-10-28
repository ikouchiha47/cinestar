-- sql: db:media
-- sql: attach:vector
PRAGMA foreign_keys=ON;

-- Backfill sources from legacy vector.media_sources into media.sources (idempotent)
-- Insert missing rows
INSERT OR IGNORE INTO sources (id, name, type, root_path, status, created_at, updated_at)
SELECT 
  id,
  name,
  type,
  path AS root_path,
  CASE COALESCE(enabled,1) WHEN 1 THEN 'active' ELSE 'disabled' END AS status,
  COALESCE(created_at, CURRENT_TIMESTAMP) AS created_at,
  COALESCE(updated_at, CURRENT_TIMESTAMP) AS updated_at
FROM vector.media_sources;

-- Update existing rows to match source
UPDATE sources SET
  name = (SELECT name FROM vector.media_sources WHERE id = sources.id),
  type = (SELECT type FROM vector.media_sources WHERE id = sources.id),
  root_path = (SELECT path FROM vector.media_sources WHERE id = sources.id),
  status = (SELECT CASE COALESCE(enabled,1) WHEN 1 THEN 'active' ELSE 'disabled' END FROM vector.media_sources WHERE id = sources.id),
  created_at = COALESCE((SELECT created_at FROM vector.media_sources WHERE id = sources.id), created_at),
  updated_at = COALESCE((SELECT updated_at FROM vector.media_sources WHERE id = sources.id), CURRENT_TIMESTAMP)
WHERE EXISTS (SELECT 1 FROM vector.media_sources WHERE id = sources.id);
