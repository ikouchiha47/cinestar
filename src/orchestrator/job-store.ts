import { Job, JobEvent, JobStatus, JobStore } from './types';

/**
 * In-memory job store. Replace with a SQLite-backed store later.
 */
export class InMemoryJobStore implements JobStore {
  private jobs = new Map<string, Job>();
  private events: JobEvent[] = [];

  create(job: Omit<Job, 'status' | 'createdAt'>): Job {
    const full: Job = {
      ...job,
      status: 'pending',
      createdAt: new Date()
    };
    this.jobs.set(full.id, full);
    return full;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  update(id: string, patch: Partial<Job>): Job | undefined {
    const existing = this.jobs.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch } as Job;
    this.jobs.set(id, updated);
    return updated;
  }

  list(status?: JobStatus): Job[] {
    const all = Array.from(this.jobs.values());
    return status ? all.filter(j => j.status === status) : all;
  }

  addEvent(event: JobEvent): void {
    this.events.push({ ...event, id: event.id ?? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}` });
  }

  clear(): void {
    this.jobs.clear();
    this.events = [];
  }
}
