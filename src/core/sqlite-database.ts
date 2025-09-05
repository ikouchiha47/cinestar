import * as fs from 'fs';
import * as path from 'path';
import { MediaItem, MediaSource, IndexingJob } from './types';

// Simple in-memory SQLite implementation without native dependencies
interface SQLiteRow {
  [key: string]: any;
}

class InMemorySQLite {
  private sources: Map<string, any> = new Map();
  private items: Map<string, any> = new Map();
  private jobs: Map<string, any> = new Map();
  
  exec(sql: string) {
    console.log(`[SQLite] Executing: ${sql}`);
  }
  
  prepare(sql: string) {
    return {
      run: (params: any[], callback: (err: any) => void) => {
        callback(null);
      },
      finalize: () => {}
    };
  }
  
  run(sql: string, params: any[], callback: (err: any) => void) {
    callback(null);
  }
  
  get(sql: string, params: any[], callback: (err: any, row: any) => void) {
    callback(null, null);
  }
  
  all(sql: string, params: any[], callback: (err: any, rows: any[]) => void) {
    callback(null, []);
  }
  
  close() {}
}

export class SQLiteDatabase {
  private db: any;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.initializeDatabase();
  }

  private initializeDatabase(): void {
    // Ensure directory exists
    const dbDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new InMemorySQLite();
    
    // Enable WAL mode
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA cache_size = 1000000;');
    this.db.exec('PRAGMA temp_store = memory;');

    this.createTables();
  }

  private createTables(): void {
    const createSourcesTable = `
      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        path TEXT NOT NULL,
        enabled BOOLEAN DEFAULT 1,
        config TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_indexed DATETIME
      )
    `;

    const createItemsTable = `
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        path TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        mime_type TEXT,
        size INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        modified_at DATETIME,
        indexed_at DATETIME,
        description TEXT,
        embedding BLOB,
        metadata TEXT,
        FOREIGN KEY (source_id) REFERENCES sources (id)
      )
    `;

    const createJobsTable = `
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER DEFAULT 0,
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        error TEXT,
        FOREIGN KEY (source_id) REFERENCES sources (id)
      )
    `;

    // Create indexes for better performance
    const createIndexes = `
      CREATE INDEX IF NOT EXISTS idx_items_source_id ON items(source_id);
      CREATE INDEX IF NOT EXISTS idx_items_type ON items(type);
      CREATE INDEX IF NOT EXISTS idx_jobs_source_id ON jobs(source_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    `;

    this.db.exec(createSourcesTable);
    this.db.exec(createItemsTable);
    this.db.exec(createJobsTable);
    this.db.exec(createIndexes);

    console.log('SQLite database initialized with WAL mode');
  }

  // Sources
  async getSources(): Promise<MediaSource[]> {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM sources ORDER BY created_at DESC', (err: any, rows: any[]) => {
        if (err) {
          reject(err);
          return;
        }
        
        const sources = rows.map(row => ({
          id: row.id,
          name: row.name,
          type: row.type,
          path: row.path,
          enabled: Boolean(row.enabled),
          config: row.config ? JSON.parse(row.config) : {},
          createdAt: new Date(row.created_at),
          lastIndexed: row.last_indexed ? new Date(row.last_indexed) : undefined
        }));
        
        resolve(sources);
      });
    });
  }

  async getSource(id: string): Promise<MediaSource | null> {
    return new Promise((resolve, reject) => {
      this.db.get('SELECT * FROM sources WHERE id = ?', [id], (err: any, row: any) => {
        if (err) {
          reject(err);
          return;
        }
        
        if (!row) {
          resolve(null);
          return;
        }
        
        const source: MediaSource = {
          id: row.id,
          name: row.name,
          type: row.type,
          path: row.path,
          enabled: Boolean(row.enabled),
          config: row.config ? JSON.parse(row.config) : {},
          createdAt: new Date(row.created_at),
          lastIndexed: row.last_indexed ? new Date(row.last_indexed) : undefined
        };
        
        resolve(source);
      });
    });
  }

  async addSource(source: Omit<MediaSource, 'id'>): Promise<string> {
    const id = `source_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO sources (id, name, type, path, enabled, config, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      stmt.run([
        id,
        source.name,
        source.type,
        source.path,
        source.enabled ? 1 : 0,
        JSON.stringify(source.config || {}),
        source.createdAt.toISOString()
      ], function(err: any) {
        if (err) {
          reject(err);
          return;
        }
        resolve(id);
      });
      
      stmt.finalize();
    });
  }

  async updateSource(id: string, updates: Partial<MediaSource>): Promise<void> {
    const fields = [];
    const values = [];
    
    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(updates.enabled ? 1 : 0);
    }
    if (updates.lastIndexed !== undefined) {
      fields.push('last_indexed = ?');
      values.push(updates.lastIndexed.toISOString());
    }
    
    if (fields.length === 0) return;
    
    values.push(id);
    
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE sources SET ${fields.join(', ')} WHERE id = ?`,
        values,
        (err: any) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  // Media Items
  async addMediaItem(item: Omit<MediaItem, 'id'>): Promise<string> {
    const id = `item_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO items (
          id, source_id, path, name, type, mime_type, size, 
          created_at, modified_at, indexed_at, description, 
          embedding, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      // Convert embedding to Buffer if it exists
      const embeddingBuffer = item.embedding ? Buffer.from(item.embedding.buffer) : null;
      
      stmt.run([
        id,
        item.sourceId,
        item.path,
        item.name,
        item.type,
        item.mimeType,
        item.size,
        item.createdAt.toISOString(),
        item.modifiedAt.toISOString(),
        item.indexedAt ? item.indexedAt.toISOString() : new Date().toISOString(),
        item.description || null,
        embeddingBuffer,
        JSON.stringify(item.metadata || {})
      ], function(err: any) {
        if (err) {
          reject(err);
          return;
        }
        console.log(`[SQLite] Added media item: ${item.name} with ID: ${id}`);
        resolve(id);
      });
      
      stmt.finalize();
    });
  }

  async getMediaItems(sourceId?: string): Promise<MediaItem[]> {
    const query = sourceId 
      ? 'SELECT * FROM items WHERE source_id = ? ORDER BY created_at DESC'
      : 'SELECT * FROM items ORDER BY created_at DESC';
    
    const params = sourceId ? [sourceId] : [];
    
    return new Promise((resolve, reject) => {
      this.db.all(query, params, (err: any, rows: any[]) => {
        if (err) {
          reject(err);
          return;
        }
        
        const items = rows.map(row => {
          // Convert Buffer back to Float32Array if embedding exists
          let embedding: Float32Array | undefined;
          if (row.embedding) {
            const buffer = Buffer.from(row.embedding);
            embedding = new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
          }
          
          return {
            id: row.id,
            sourceId: row.source_id,
            path: row.path,
            name: row.name,
            type: row.type,
            mimeType: row.mime_type,
            size: row.size,
            createdAt: new Date(row.created_at),
            modifiedAt: new Date(row.modified_at),
            indexedAt: row.indexed_at ? new Date(row.indexed_at) : undefined,
            description: row.description,
            embedding,
            metadata: row.metadata ? JSON.parse(row.metadata) : {}
          } as MediaItem;
        });
        
        resolve(items);
      });
    });
  }

  // Vector similarity search
  async vectorSearch(queryEmbedding: Float32Array, limit: number = 10): Promise<MediaItem[]> {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT * FROM items WHERE embedding IS NOT NULL', (err: any, rows: any[]) => {
        if (err) {
          reject(err);
          return;
        }
        
        const itemsWithSimilarity = rows.map(row => {
          // Convert Buffer back to Float32Array
          const buffer = Buffer.from(row.embedding);
          const embedding = new Float32Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
          
          // Calculate cosine similarity
          const similarity = this.cosineSimilarity(queryEmbedding, embedding);
          
          return {
            item: {
              id: row.id,
              sourceId: row.source_id,
              path: row.path,
              name: row.name,
              type: row.type,
              mimeType: row.mime_type,
              size: row.size,
              createdAt: new Date(row.created_at),
              modifiedAt: new Date(row.modified_at),
              indexedAt: row.indexed_at ? new Date(row.indexed_at) : undefined,
              description: row.description,
              embedding,
              metadata: row.metadata ? JSON.parse(row.metadata) : {}
            } as MediaItem,
            similarity
          };
        });
        
        // Sort by similarity (highest first) and take top results
        const sortedItems = itemsWithSimilarity
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, limit)
          .map(item => item.item);
        
        console.log(`[SQLite] Vector search found ${sortedItems.length} results`);
        resolve(sortedItems);
      });
    });
  }

  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // Jobs
  async addJob(job: Omit<IndexingJob, 'id'>): Promise<string> {
    const id = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return new Promise((resolve, reject) => {
      const stmt = this.db.prepare(`
        INSERT INTO jobs (id, source_id, status, progress, started_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      
      stmt.run([
        id,
        job.sourceId,
        job.status,
        job.progress || 0,
        job.startedAt.toISOString()
      ], function(err: any) {
        if (err) {
          reject(err);
          return;
        }
        resolve(id);
      });
      
      stmt.finalize();
    });
  }

  async updateJobStatus(jobId: string, status: string, progress?: number): Promise<void> {
    const fields = ['status = ?'];
    const values = [status];
    
    if (progress !== undefined) {
      fields.push('progress = ?');
      values.push(progress);
    }
    
    if (status === 'completed' || status === 'failed') {
      fields.push('completed_at = ?');
      values.push(new Date().toISOString());
    }
    
    values.push(jobId);
    
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`,
        values,
        (err: any) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async getStats(): Promise<{ totalSources: number; totalItems: number; activeJobs: number }> {
    return new Promise((resolve, reject) => {
      const queries = [
        'SELECT COUNT(*) as count FROM sources',
        'SELECT COUNT(*) as count FROM items',
        'SELECT COUNT(*) as count FROM jobs WHERE status IN ("pending", "running")'
      ];
      
      let completed = 0;
      const results: number[] = [];
      
      queries.forEach((query, index) => {
        this.db.get(query, (err: any, row: any) => {
          if (err) {
            reject(err);
            return;
          }
          
          results[index] = row.count;
          completed++;
          
          if (completed === queries.length) {
            resolve({
              totalSources: results[0],
              totalItems: results[1],
              activeJobs: results[2]
            });
          }
        });
      });
    });
  }

  close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}
