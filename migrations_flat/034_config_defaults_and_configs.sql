-- sql: db:config
PRAGMA foreign_keys=ON;

-- Typed JSON configs
CREATE TABLE IF NOT EXISTS configs (
  key TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('json','text','int','float','bool')),
  value_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

-- Seed default partitions if missing
INSERT OR IGNORE INTO partitions (id, name, role, file_path, version, created_at, updated_at)
VALUES
  ('default_media', 'default_media', 'media', 'media.db', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('default_image', 'default_image', 'image_search', 'image_search.db', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('default_av', 'default_av', 'av_search', 'av_search.db', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Seed default strategy flags (optional, idempotent)
INSERT OR IGNORE INTO configs (key, type, value_json)
VALUES ('strategy.flags', 'json', '{"dualWrite": true, "useNewCatalog": true, "useNewImageSearch": true, "useNewAVSearch": false}');
