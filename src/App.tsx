import { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { motion } from 'framer-motion';
import { SimplifiedOnboarding } from './components/SimplifiedOnboarding';
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
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);
  const [indexDrawerOpen, setIndexDrawerOpen] = useState(false);
  const [activeJobs, setActiveJobs] = useState<string[]>([]);
  const [indexLogs, setIndexLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  // Track whether the indexing drawer is open to avoid log spam when closed
  const indexOpenRef = useRef<boolean>(false);
  useEffect(() => { indexOpenRef.current = indexDrawerOpen; }, [indexDrawerOpen]);

  // Log viewport dimensions on mount and resize
  // useEffect(() => {
  //   const logViewportDimensions = () => {
  //     console.log('[REACT-VIEWPORT] window.innerWidth:', window.innerWidth);
  //     console.log('[REACT-VIEWPORT] window.innerHeight:', window.innerHeight);
  //     console.log('[REACT-VIEWPORT] document.documentElement.clientWidth:', document.documentElement.clientWidth);
  //     console.log('[REACT-VIEWPORT] document.documentElement.clientHeight:', document.documentElement.clientHeight);
  //     console.log('[REACT-VIEWPORT] window.outerWidth:', window.outerWidth);
  //     console.log('[REACT-VIEWPORT] window.outerHeight:', window.outerHeight);
  //     console.log('[REACT-VIEWPORT] window.devicePixelRatio:', window.devicePixelRatio);
  //     console.log('[REACT-VIEWPORT] screen.width:', window.screen.width);
  //     console.log('[REACT-VIEWPORT] screen.height:', window.screen.height);
  //   };

  //   // Log on mount
  //   logViewportDimensions();

  //   // Log on resize
  //   window.addEventListener('resize', logViewportDimensions);
  //   return () => window.removeEventListener('resize', logViewportDimensions);
  // }, []);
  
  // Check onboarding status - moved to simplified onboarding component
  // Returns TRUE if onboarding is needed, FALSE if already complete
  const checkOnboardingStatus = async (): Promise<boolean> => {
    // Check for ENV variable to force show onboarding (for development)
    const forceOnboarding = import.meta.env.VITE_FORCE_ONBOARDING === 'true';
    
    if (forceOnboarding) {
      console.log('[APP] VITE_FORCE_ONBOARDING=true - Showing onboarding flow');
      return true; // Needs onboarding
    }
    
    try {
      // Check onboarding status from config.json
      const config = await window.ipcRenderer.invoke('config:get');
      if (config && config.onboarding) {
        return !config.onboarding.complete; // Return TRUE if NOT complete (needs onboarding)
      } else {
        // If config doesn't exist, show onboarding
        return true; // Needs onboarding
      }
    } catch (error) {
      console.error('[APP] Failed to check onboarding status:', error);
      // Default to showing onboarding on error
      return true; // Needs onboarding
    }
  };
  type JobInfo = { 
  id: string; 
  sourceId: string; 
  status: string; 
  progress: number; 
  totalItems?: number; 
  processedItems?: number; 
  startedAt?: string | Date; 
  completedAt?: string | Date;
  // New fields for enhanced job descriptions
  title?: string;
  description?: string;
  operationType?: string;
  targetFile?: string;
  type?: string;
  refinementPass?: number;
  threshold?: string;
};
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
          // Dedupe active jobs by id
          const uniqueActiveJobs: string[] = Array.from(new Set(res.activeJobs));
          // Diff jobs to emit start/stop events and avoid redundant state updates
          const started: string[] = uniqueActiveJobs.filter((j: string) => !prevJobs.includes(j));
          const finished: string[] = prevJobs.filter((j: string) => !uniqueActiveJobs.includes(j));

          if (started.length > 0 || finished.length > 0) {
            setActiveJobs(uniqueActiveJobs);
            // Removed noisy lifecycle logs from Indexing Center UI
            prevJobs = uniqueActiveJobs;
          }

          // Update job details if changed
          if (Array.isArray(res.jobs)) {
            // Dedupe jobs by id and include enhanced fields from backend
            const byId = new Map<string, any>();
            for (const j of res.jobs) {
              if (!byId.has(j.id)) byId.set(j.id, j);
            }
            const dedupJobs = Array.from(byId.values());
            const nextJobs: JobInfo[] = dedupJobs.map((j: any) => ({
              id: j.id,
              sourceId: j.sourceId,
              status: j.status,
              progress: j.progress,
              totalItems: j.totalItems,
              processedItems: j.processedItems,
              startedAt: j.startedAt,
              completedAt: j.completedAt,
              // Enhanced fields
              title: j.title,
              description: j.description,
              operationType: j.operationType,
              targetFile: j.targetFile,
              type: j.type,
              refinementPass: j.refinementPass,
              threshold: j.threshold,
            }));
            const changed = (
              nextJobs.length !== jobDetails.length ||
              nextJobs.some((nj, i) => {
                const pj = jobDetails[i];
                if (!pj) return true;
                return nj.id !== pj.id || nj.progress !== pj.progress || nj.status !== pj.status || (nj.processedItems||0) !== (pj.processedItems||0) || (nj.totalItems||0)!==(pj.totalItems||0) || nj.title !== pj.title || nj.type !== pj.type;
              })
            );
            if (changed) setJobDetails(nextJobs);
          }

          // If there are no active jobs, clear any stale job details so UI doesn't show stuck progress bars
          if (uniqueActiveJobs.length === 0) {
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

  // Compute overall progress across in-progress jobs (running/processing only)
  useEffect(() => {
    const inProgress = jobDetails.filter(j => j.status === 'running' || (j as any).status === 'processing');
    if (inProgress.length > 0) {
      const pct = (j: typeof jobDetails[number]) => {
        if (j.status === 'completed') return 100;
        if (typeof j.totalItems === 'number' && typeof j.processedItems === 'number' && j.totalItems > 0) {
          return Math.min(100, Math.round((j.processedItems / j.totalItems) * 100));
        }
        return Math.round(j.progress || 0);
      };
      const avg = inProgress.reduce((sum, j) => sum + pct(j), 0) / inProgress.length;
      setOverallProgress(Math.max(0, Math.min(100, Math.round(avg))));
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
  }, [jobDetails.length, jobDetails.map(j => `${j.id}:${j.status}:${j.progress}`).join(',')]);

  // removed old browse/search handlers; DrillerV2 owns main UI now

  console.log('[APP] Rendering main UI at:', new Date().toISOString());
  // Overlay approach (PortalSplash controls timing). We'll trigger
  // landing reveal when the splash fires onReveal, and signal main
  // process onComplete.

  // Preload the main component
  useEffect(() => {
    const preloadComponent = async () => {
      try {
        await import('./components/v2/DrillerV2');
      } catch (error) {
        console.warn('Failed to preload component:', error);
      }
    };
    
    preloadComponent();
  }, []);

  // Show onboarding if not complete
  console.log('[APP] onboardingComplete state:', onboardingComplete);
  if (!onboardingComplete) {
    console.log('[APP] Rendering SimplifiedOnboarding component');
    return (
      <SimplifiedOnboarding 
        onComplete={() => {
          console.log('[APP] onboardingComplete set to true');
          setOnboardingComplete(true);
        }} 
        onCheckOnboarding={checkOnboardingStatus} 
      />
    );
  }
  
  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="min-h-screen"
      style={{
        background: 'linear-gradient(135deg, #000000 0%, #0a0a0a 25%, #111111 50%, #0a0a0a 75%, #000000 100%)'
      }}
    >
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

      {/* V2 Main UI with Suspense and improved loading */}
      <Suspense fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="rounded-2xl border border-neutral-700/50 bg-neutral-800/50 backdrop-blur-sm p-8 text-center text-neutral-300">
            <Icon.Spinner className="w-8 h-8 animate-spin mx-auto mb-4 text-blue-400" />
            <div className="text-lg font-medium mb-2">Loading Cinestar</div>
            <div className="text-sm text-neutral-400">Preparing your media library…</div>
          </div>
        </div>
      }>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <DrillerV2
            overallProgress={overallProgress}
            onOpenIndexing={() => setIndexDrawerOpen(true)}
          />
        </motion.div>
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
                  {(() => {
                    const visibleJobs = jobDetails.filter(job => 
                      activeJobs.includes(job.id) || job.status === 'running' || (job as any).status === 'processing' || job.status === 'scheduled'
                    );
                    const activeCount = visibleJobs.filter(job => job.status === 'running' || (job as any).status === 'processing').length;
                    const scheduledCount = visibleJobs.filter(job => job.status === 'scheduled').length;
                    
                    if (visibleJobs.length === 0) {
                      return <span>No jobs</span>;
                    }
                    
                    const parts = [];
                    if (activeCount > 0) parts.push(`${activeCount} active`);
                    if (scheduledCount > 0) parts.push(`${scheduledCount} queued`);
                    
                    return <span>{parts.join(', ')}</span>;
                  })()}
                </div>
              </div>

              {/* Active jobs list with progress */}
              {jobDetails.length > 0 && (
                <div className="px-4 py-3 border-b border-neutral-800 space-y-2">
                  {jobDetails
                    .filter(job => activeJobs.includes(job.id) || job.status === 'running' || (job as any).status === 'processing' || job.status === 'scheduled')
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
                      if (job.status === 'pending') return 'Queued for processing';
                      if (job.status === 'completed') return 'Processing completed';
                      if (isVideo) {
                        if (refinementPass === 1) return 'Extracting video segments';
                        if (refinementPass === 2) return `Generating transcriptions (${threshold})`;
                        if (refinementPass === 3) return `Creating keyframes (${threshold})`;
                        return `Processing video (Pass ${refinementPass})`;
                      }
                      // Media/image processing phases
                      if (percent < 30) return 'Scanning media files';
                      if (percent < 70) return 'Generating captions';
                      return 'Creating embeddings';
                    };
                    
                    const phase = getPhase();
                    const barColor = isVideo ? 'bg-purple-500' : 'bg-blue-500';
                    
                    // Extract filename from job data
                    const getFileName = () => {
                      // Use targetFile from job if available
                      if ((job as any).targetFile) {
                        const path = (job as any).targetFile;
                        return path.split('/').pop() || path;
                      }
                      // Fallback to metadata for video jobs
                      const metadata = (job as any).metadata;
                      if (metadata?.fileName) return metadata.fileName;
                      if (metadata?.videoPath) {
                        const path = metadata.videoPath;
                        return path.split('/').pop() || path;
                      }
                      return null;
                    };
                    
                    const fileName = getFileName();
                    const jobTitle = (job as any).title || phase;
                    
                    // [DEBUG] Log actual job data structure
                    console.log(`[INDEXING-UI-DEBUG] Job data for ${job.id}:`, {
                      id: job.id,
                      status: job.status,
                      progress: job.progress,
                      title: (job as any).title,
                      description: (job as any).description,
                      operationType: (job as any).operationType,
                      targetFile: (job as any).targetFile,
                      type: (job as any).type,
                      isVideo: isVideo,
                      phase: phase,
                      jobTitle: jobTitle,
                      fileName: fileName
                    });
                    
                    return (
                      <div key={job.id} className="text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <div className="font-medium text-neutral-200">{jobTitle}</div>
                            {isVideo && (
                              <div className="px-1.5 py-0.5 bg-purple-900/50 text-purple-300 rounded text-[10px]">
                                VIDEO
                              </div>
                            )}
                          </div>
                          <div className="text-neutral-400">{percent}%</div>
                        </div>
                        <div className="text-[10px] text-neutral-500 mb-1 flex items-center gap-2">
                          {fileName && (
                            <span className="truncate flex-1" title={fileName}>
                              📄 {fileName}
                            </span>
                          )}
                          <span className="font-mono text-neutral-600 shrink-0">
                            {job.id.slice(0,8)}…
                          </span>
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
    </motion.div>
  );
}

export default App;
