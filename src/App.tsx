import { useState, useEffect, useRef, Suspense, lazy } from 'react';
const DrillerV2 = lazy(() => import('./components/v2/DrillerV2'));

// Icon components (only what's used in this file)
const Icon = {
  Spinner: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  ),
  Close: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
};

function App() {
  const [indexDrawerOpen, setIndexDrawerOpen] = useState(false);
  const [activeJobs, setActiveJobs] = useState<string[]>([]);
  const [indexLogs, setIndexLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  // Track whether the indexing drawer is open to avoid log spam when closed
  const indexOpenRef = useRef<boolean>(false);
  useEffect(() => { indexOpenRef.current = indexDrawerOpen; }, [indexDrawerOpen]);
  type JobInfo = { id: string; sourceId: string; status: string; progress: number; totalItems?: number; processedItems?: number; startedAt?: string | Date; completedAt?: string | Date };
  const [jobDetails, setJobDetails] = useState<JobInfo[]>([]);
  const [overallProgress, setOverallProgress] = useState<number>(-1); // percent 0-100, -1 hidden

  // Apply Catppuccin theme (swappable via data-theme)
  useEffect(() => {
    try { document.documentElement.setAttribute('data-theme', 'catppuccin-mocha'); } catch {}
  }, []);

  // Poll indexing status and push log lines to a console-like buffer
  useEffect(() => {
    let mounted = true;
    let prevJobs: string[] = [];
    const appendLog = (line: string) => {
      // Only record logs when the drawer is open to prevent unnecessary re-renders
      if (!indexOpenRef.current) return;
      setIndexLogs(prev => {
        const next = [...prev, `${new Date().toLocaleTimeString()}  ${line}`];
        // keep last 500 lines
        return next.slice(-500);
      });
    };

    const tick = async () => {
      try {
        const res = await window.mediaAPI.getIndexingStatus();
        if (!mounted) return;
        if (res.success && Array.isArray(res.activeJobs)) {
          // Diff jobs to emit start/stop events and avoid redundant state updates
          const started: string[] = res.activeJobs.filter((j: string) => !prevJobs.includes(j));
          const finished: string[] = prevJobs.filter((j: string) => !res.activeJobs.includes(j));

          if (started.length > 0 || finished.length > 0) {
            setActiveJobs(res.activeJobs);
            started.forEach((j: string) => appendLog(`▶︎ Job started: ${j}`));
            finished.forEach((j: string) => appendLog(`✓ Job finished: ${j}`));
            prevJobs = res.activeJobs;
          }

          // Update job details if changed
          if (Array.isArray(res.jobs)) {
            const nextJobs: JobInfo[] = res.jobs.map((j: any) => ({
              id: j.id,
              sourceId: j.sourceId,
              status: j.status,
              progress: j.progress,
              totalItems: j.totalItems,
              processedItems: j.processedItems,
              startedAt: j.startedAt,
              completedAt: j.completedAt,
            }));
            const changed = (
              nextJobs.length !== jobDetails.length ||
              nextJobs.some((nj, i) => {
                const pj = jobDetails[i];
                if (!pj) return true;
                return nj.id !== pj.id || nj.progress !== pj.progress || nj.status !== pj.status || (nj.processedItems||0) !== (pj.processedItems||0) || (nj.totalItems||0)!==(pj.totalItems||0);
              })
            );
            if (changed) setJobDetails(nextJobs);
          }

          // If there are no active jobs, clear any stale job details so UI doesn't show stuck progress bars
          if (res.activeJobs.length === 0) {
            setJobDetails([]);
          }
        }
      } catch (e) {
        if (!mounted) return;
        appendLog(`⚠︎ Failed to fetch indexing status`);
      }
    };

    // initial tick immediately, then every second
    tick();
    const id = setInterval(tick, 2500);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  // Auto-scroll console to bottom when new logs arrive
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [indexLogs.length, indexDrawerOpen]);

  // Compute overall progress across active jobs and reflect in OS title bar (taskbar/dock) and a top bar
  useEffect(() => {
    // Only when there are active jobs
    if (activeJobs.length > 0 && jobDetails.length > 0) {
      const activeSet = new Set(activeJobs);
      const activeOnly = jobDetails.filter(j => activeSet.has(j.id) || j.status === 'running' || j.status === 'pending');
      const pct = (j: typeof jobDetails[number]) => {
        if (j.status === 'completed') return 100;
        if (typeof j.totalItems === 'number' && typeof j.processedItems === 'number' && j.totalItems > 0) {
          return Math.min(100, Math.round((j.processedItems / j.totalItems) * 100));
        }
        return Math.round(j.progress || 0);
      };
      const avg = activeOnly.length > 0
        ? activeOnly.reduce((sum, j) => sum + pct(j), 0) / activeOnly.length
        : 0;
      setOverallProgress(Math.max(0, Math.min(100, Math.round(avg))));
      // Also set OS-level progress bar (0..1); clear when none
      try {
        // @ts-ignore - exposed by preload
        window.ipcRenderer?.invoke('app:setProgress', avg / 100);
      } catch {}
    } else {
      setOverallProgress(-1);
      try {
        // @ts-ignore
        window.ipcRenderer?.invoke('app:setProgress', -1);
      } catch {}
    }
  }, [activeJobs.join(','), jobDetails.length, jobDetails.map(j => j.progress).join(',')]);

  // removed old browse/search handlers; DrillerV2 owns main UI now

  console.log('[APP] Rendering main UI at:', new Date().toISOString());

  return (
    <div className="min-h-screen">
      {/* Top progress bar (subtle) */}
      {overallProgress >= 0 && (
        <div className="fixed top-0 left-0 right-0 z-50">
          <div className="h-1 bg-neutral-900/60 backdrop-blur-sm">
            <div
              className="h-1 transition-all duration-300 shadow-[0_0_10px_rgba(59,130,246,0.45)]"
              style={{
                width: `${overallProgress}%`,
                background: 'linear-gradient(90deg, rgba(59,130,246,0.95) 0%, rgba(59,130,246,0.65) 100%)'
              }}
            />
          </div>
        </div>
      )}

      {/* V2 Main UI with Suspense (compact fallback to avoid covering the whole app) */}
      <Suspense fallback={
        <div className="px-4 py-6">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6 text-center text-neutral-400">
            <Icon.Spinner className="w-6 h-6 animate-spin mx-auto mb-3" />
            <div className="text-sm">Loading media library…</div>
          </div>
        </div>
      }>
        <DrillerV2
          overallProgress={overallProgress}
          onOpenIndexing={() => setIndexDrawerOpen(true)}
        />
      </Suspense>

      {/* Indexing Drawer */}
      {indexDrawerOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setIndexDrawerOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-full sm:w-[520px] bg-neutral-900 border-l border-neutral-800 shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
              <div className="flex items-center gap-2">
                <Icon.Spinner className="w-5 h-5 animate-spin" />
                <div className="font-semibold">Indexing Center</div>
              </div>
              <button 
                onClick={() => setIndexDrawerOpen(false)} 
                className="rounded-lg border border-neutral-700 p-2 hover:bg-neutral-800"
              >
                <Icon.Close className="w-4 h-4" />
              </button>
            </div>
            {/* Content scroll area */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {/* Active jobs summary + dev tools */}
              <div className="px-4 py-2 border-b border-neutral-800 text-xs text-neutral-400 flex items-center justify-between">
                <div>
                  {activeJobs.length === 0 ? (
                    <span>No active jobs</span>
                  ) : (
                    <span>{activeJobs.length} active job(s): {activeJobs.map(j => j.slice(0,8)).join(', ')}</span>
                  )}
                </div>
              </div>

              {/* Active jobs list with progress */}
              {jobDetails.length > 0 && (
                <div className="px-4 py-3 border-b border-neutral-800 space-y-2">
                  {jobDetails
                    .filter(job => activeJobs.includes(job.id) || job.status === 'running' || job.status === 'pending')
                    .map(job => {
                    const calcPercent = () => {
                      if (job.status === 'completed') return 100;
                      if ((job.totalItems || 0) > 0 && (job.processedItems || 0) >= 0) {
                        return Math.min(100, Math.round(((job.processedItems || 0) / (job.totalItems || 1)) * 100));
                      }
                      return Math.round(job.progress || 0);
                    };
                    const percent = calcPercent();
                    const isVideo = (job as any).type === 'video';
                    const refinementPass = (job as any).refinementPass;
                    const threshold = (job as any).threshold;
                    
                    const getPhase = () => {
                      if (job.status === 'pending') return 'Queued';
                      if (job.status === 'completed') return 'Completed';
                      if (isVideo) {
                        if (refinementPass === 1) return 'Video Processing (Pass 1)';
                        if (refinementPass === 2) return `Refinement (Pass 2, ${threshold})`;
                        if (refinementPass === 3) return `Refinement (Pass 3, ${threshold})`;
                        return `Video Processing (Pass ${refinementPass})`;
                      }
                      return percent < 50 ? 'Scanning' : 'Processing';
                    };
                    
                    const phase = getPhase();
                    const barColor = isVideo ? 'bg-purple-500' : 'bg-blue-500';
                    
                    return (
                      <div key={job.id} className="text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <div className="font-mono">{job.id.slice(0,8)}…</div>
                            {isVideo && (
                              <div className="px-1.5 py-0.5 bg-purple-900/50 text-purple-300 rounded text-[10px]">
                                VIDEO
                              </div>
                            )}
                          </div>
                          <div className="text-neutral-400">{percent}%</div>
                        </div>
                        <div className="text-[10px] text-neutral-500 mb-1 truncate" title={phase}>
                          {phase}
                        </div>
                        <div className="h-2 w-full bg-neutral-800 rounded">
                          <div className={`h-2 rounded ${barColor}`} style={{ width: `${percent}%` }} />
                        </div>
                        {(job.totalItems || job.processedItems) && (
                          <div className="mt-1 text-[10px] text-neutral-500">
                            {job.processedItems ?? 0}/{job.totalItems ?? '?'} {isVideo ? 'segments' : 'items'}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Scrollable console-like log */}
              <div className="p-3 font-mono text-xs text-neutral-300">
                {indexLogs.length === 0 ? (
                  <div className="text-neutral-500">Waiting for activity…</div>
                ) : (
                  indexLogs.map((line, i) => (
                    <div key={i} className="whitespace-pre-wrap">{line}</div>
                  ))
                )}
                <div ref={logsEndRef} />
              </div>
            </div>

            {/* Footer with overall hint */}
            <div className="border-t border-neutral-800 px-4 py-2 text-[11px] text-neutral-500">
              Logs auto-refresh every ~2.5s. Close this panel to keep indexing in background.
            </div>
          </div>
        </div>
      )}

      {/* Footer removed: DrillerV2 renders a fixed bottom-right footer */}
    </div>
  );
}

export default App;
