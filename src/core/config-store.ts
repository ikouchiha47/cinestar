import Database from 'better-sqlite3';
import path from 'path';

export type StrategyFlags = {
  dualWrite: boolean;
  useNewCatalog: boolean;
  useNewImageSearch: boolean;
  useNewAVSearch: boolean;
};

export type Partition = {
  id: string;
  role: 'media' | 'image_search' | 'av_search' | 'jobs' | 'config';
  file_path: string;
};

export type SourcePartitionMap = {
  [sourceId: string]: {
    catalog_partition_id: string;
    image_partition_id: string;
    av_partition_id: string;
  };
};

export class ConfigStore {
  private db: Database.Database;
  private dataDir: string;

  constructor(configDbPath: string, dataDir: string) {
    this.db = new Database(configDbPath);
    this.db.pragma('journal_mode = wal');
    this.db.pragma('foreign_keys = ON');
    this.dataDir = dataDir;
  }

  loadFlags(): StrategyFlags {
    try {
      const row = this.db.prepare(`SELECT value_json FROM configs WHERE key = 'strategy.flags'`).get() as any;
      if (row && row.value_json) {
        const val = JSON.parse(row.value_json);
        return {
          dualWrite: !!val.dualWrite,
          useNewCatalog: !!val.useNewCatalog,
          useNewImageSearch: !!val.useNewImageSearch,
          useNewAVSearch: !!val.useNewAVSearch,
        };
      }
    } catch {}
    return { dualWrite: false, useNewCatalog: false, useNewImageSearch: false, useNewAVSearch: false };
  }

  loadPartitions(): Record<string, Partition> {
    const map: Record<string, Partition> = {};
    try {
      const rows = this.db.prepare(`SELECT id, role, file_path FROM partitions`).all() as any[];
      for (const r of rows) {
        // Resolve path relative to dataDir when necessary
        const p = path.isAbsolute(r.file_path) ? r.file_path : path.resolve(this.dataDir, r.file_path);
        map[r.id] = { id: r.id, role: r.role, file_path: p } as Partition;
      }
    } catch {}
    return map;
  }

  loadSourcePartitionMap(): SourcePartitionMap {
    const res: SourcePartitionMap = {};
    try {
      const rows = this.db.prepare(`SELECT source_id, catalog_partition_id, image_partition_id, av_partition_id FROM source_partition_map`).all() as any[];
      for (const r of rows) {
        res[r.source_id] = {
          catalog_partition_id: r.catalog_partition_id,
          image_partition_id: r.image_partition_id,
          av_partition_id: r.av_partition_id,
        };
      }
    } catch {}
    return res;
  }
}
