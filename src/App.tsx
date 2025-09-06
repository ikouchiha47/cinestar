import { useState, useEffect, useRef } from 'react';
import { AddSourceForm } from './components/AddSourceForm';
import { SourceList } from './components/SourceList';
import { SearchBar } from './components/SearchBar';
import { SearchResults } from './components/SearchResults';
import { MediaItem } from './core/types';
import { getUICategories, UICategory } from './core/ui-config';
import { PluginRegistry } from './core/plugin-registry';

// Icon components
const Icon = {
  Search: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
  Plus: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  ),
  Folder: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-5l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  ),
  Image: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  ),
  Video: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  ),
  Audio: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
    </svg>
  ),
  Grid: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  ),
  List: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
  ),
  Settings: ({ className }: { className?: string }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
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
  const [showAddForm, setShowAddForm] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [initialized, setInitialized] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<boolean | null>(null);
  const [searchResults, setSearchResults] = useState<MediaItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [indexDrawerOpen, setIndexDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('all');
  const [activeJobs, setActiveJobs] = useState<string[]>([]);
  const [indexLogs, setIndexLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement | null>(null);
  // Track whether the indexing drawer is open to avoid log spam when closed
  const indexOpenRef = useRef<boolean>(false);
  useEffect(() => { indexOpenRef.current = indexDrawerOpen; }, [indexDrawerOpen]);
  type JobInfo = { id: string; sourceId: string; status: string; progress: number; totalItems?: number; processedItems?: number; startedAt?: string | Date; completedAt?: string | Date };
  const [jobDetails, setJobDetails] = useState<JobInfo[]>([]);
  const [categories, setCategories] = useState<UICategory[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [browsedItems, setBrowsedItems] = useState<MediaItem[]>([]);
  const [overallProgress, setOverallProgress] = useState<number>(-1); // percent 0-100, -1 hidden

  useEffect(() => {
    const initializeApp = async () => {
      try {
        // Check if mediaAPI is available (wait for preload)
        let attempts = 0;
        while (!window.mediaAPI && attempts < 50) {
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        }
        
        if (window.mediaAPI) {
          const result = await window.mediaAPI.isOllamaAvailable();
          if (result.success) {
            setOllamaStatus(result.available || false);
          }
        }
        // Load plugins (categories, icons) then compute categories
        await PluginRegistry.loadPlugins();
        setCategories(getUICategories());
        setInitialized(true);
      } catch (error) {
        console.error('Failed to initialize app:', error);
        setInitialized(true);
      }
    };

    initializeApp();
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
      const activeOnly = jobDetails.filter(j => activeSet.has(j.id));
      const avg = activeOnly.length > 0
        ? activeOnly.reduce((sum, j) => sum + (j.progress || 0), 0) / activeOnly.length
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

  const handleSourceAdded = () => {
    setShowAddForm(false);
    setRefreshTrigger(prev => prev + 1);
  };

  const handleSelectSource = async (sourceId: string) => {
    try {
      setSelectedSourceId(sourceId);
      const res = await window.mediaAPI.getItems(sourceId);
      if (res?.success && Array.isArray(res.items)) {
        setBrowsedItems(res.items);
      } else {
        setBrowsedItems([]);
      }
    } catch (e) {
      console.warn('Failed to load items for source', sourceId, e);
      setBrowsedItems([]);
    }
  };

  const handleAddSource = () => {
    setShowAddForm(true);
  };

  const handleCancelAdd = () => {
    setShowAddForm(false);
  };

  const handleSearchResults = (results: MediaItem[], query: string) => {
    setSearchResults(results);
    setSearchQuery(query);
  };

  if (!initialized) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-200 flex items-center justify-center">
        <div className="text-center">
          <Icon.Spinner className="w-8 h-8 animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Initializing Driller...</h2>
          <p className="text-neutral-400">Setting up your media search engine</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200">
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
      {/* Header */}
      <header className="border-b border-neutral-800 bg-neutral-900">
        <div className="mx-auto w-full max-w-7xl min-w-[320px] px-4 sm:px-6 lg:px-8 flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Icon.Search className="w-6 h-6 text-neutral-400" />
              <h1 className="text-xl font-bold">Driller</h1>
            </div>
            <div className="text-sm text-neutral-400">Media Search</div>
          </div>
          
          <div className="flex items-center gap-3">
            {ollamaStatus !== null && (
              <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                ollamaStatus 
                  ? 'bg-green-900/50 text-green-400 border border-green-800' 
                  : 'bg-red-900/50 text-red-400 border border-red-800'
              }`}>
                {ollamaStatus ? '✅ Ollama Ready' : '⚠️ Ollama Offline'}
              </div>
            )}
            
            <button 
              onClick={() => setIndexDrawerOpen(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-neutral-700 hover:bg-neutral-800 text-sm"
            >
              <Icon.Spinner className="w-4 h-4" />
              Indexing
            </button>
            
            <button 
              onClick={handleAddSource}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-200 text-neutral-900 hover:bg-neutral-300 text-sm font-medium"
            >
              <Icon.Plus className="w-4 h-4" />
              Add Source
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1">
        {/* Search Bar */}
        <div className="border-b border-neutral-800 bg-neutral-900/50">
          <div className="mx-auto w-full max-w-7xl min-w-[320px] px-4 sm:px-6 lg:px-8 flex items-center gap-3 py-4">
            <div className="flex-1">
              <SearchBar onResults={handleSearchResults} />
            </div>
            <button
              onClick={() => setIndexDrawerOpen(true)}
              className="hidden sm:inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-neutral-700 hover:bg-neutral-800 text-sm"
            >
              Open Indexing Center
            </button>
          </div>

          {/* Tabs row */}
          <div className="mx-auto w-full max-w-7xl min-w-[320px] px-4 sm:px-6 lg:px-8 mt-3 flex items-center gap-2 overflow-x-auto pb-2">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1.5 rounded-full text-sm border ${activeTab==='all' ? 'bg-neutral-200 text-neutral-900 border-neutral-200' : 'border-neutral-700 hover:bg-neutral-800'}`}
            >
              All
            </button>
            {categories.map((cat: UICategory) => (
              <button
                key={cat.key}
                onClick={() => setActiveTab(cat.key)}
                className={`px-3 py-1.5 rounded-full text-sm border ${activeTab===cat.key ? 'bg-neutral-200 text-neutral-900 border-neutral-200' : 'border-neutral-700 hover:bg-neutral-800'}`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content Area */}
        <div className="mx-auto w-full max-w-7xl min-w-[320px] px-4 sm:px-6 lg:px-8 py-6">
          {searchQuery && searchResults.length > 0 ? (
            <div className="grid grid-cols-12 gap-6">
              {/* Sidebar (non-expanding) */}
              <aside className="col-span-12 md:col-span-3 hidden md:block">
                <div className="space-y-4">
                  <section className="rounded-2xl border border-neutral-800 bg-neutral-900">
                    <div className="px-4 py-3 border-b border-neutral-800 text-sm font-medium">Media Type</div>
                    <div className="p-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => setActiveTab('all')}
                        className={`px-3 py-1.5 rounded-full text-sm border ${activeTab==='all' ? 'bg-neutral-200 text-neutral-900 border-neutral-200' : 'border-neutral-700 hover:bg-neutral-800'}`}
                      >All</button>
                      {categories.map((cat: UICategory) => (
                        <button
                          key={cat.key}
                          onClick={() => setActiveTab(cat.key)}
                          className={`px-3 py-1.5 rounded-full text-sm border ${activeTab===cat.key ? 'bg-neutral-200 text-neutral-900 border-neutral-200' : 'border-neutral-700 hover:bg-neutral-800'}`}
                        >{cat.label}</button>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-2xl border border-neutral-800 bg-neutral-900">
                    <div className="px-4 py-3 border-b border-neutral-800 text-sm font-medium">Sources</div>
                    <div className="p-3 space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-neutral-300">Local Disk</span>
                        <span className="text-neutral-500">Enabled</span>
                      </div>
                      <div className="flex items-center justify-between opacity-50">
                        <span className="text-neutral-300">S3 Bucket</span>
                        <span className="text-neutral-500">Coming soon</span>
                      </div>
                      <div className="flex items-center justify-between opacity-50">
                        <span className="text-neutral-300">GDrive</span>
                        <span className="text-neutral-500">Coming soon</span>
                      </div>
                    </div>
                  </section>
                </div>
              </aside>

              {/* Main results */}
              <section className="col-span-12 md:col-span-9">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-lg font-semibold">Search Results</h2>
                    <p className="text-sm text-neutral-400">
                      Found {searchResults.length} results for "{searchQuery}"
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setViewMode('grid')}
                      className={`p-2 rounded-lg border ${
                        viewMode === 'grid'
                          ? 'bg-neutral-200 text-neutral-900 border-neutral-200'
                          : 'border-neutral-700 hover:bg-neutral-800'
                      }`}
                    >
                      <Icon.Grid className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={`p-2 rounded-lg border ${
                        viewMode === 'list'
                          ? 'bg-neutral-200 text-neutral-900 border-neutral-200'
                          : 'border-neutral-700 hover:bg-neutral-800'
                      }`}
                    >
                      <Icon.List className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {/* Filter results by activeTab category */}
                <SearchResults 
                  results={(activeTab==='all') ? searchResults : searchResults.filter((it: MediaItem) => it.type === activeTab)} 
                  query={searchQuery} 
                  viewMode={viewMode} 
                  mode="search"
                />
              </section>
            </div>
          ) : (
            <div className="grid grid-cols-12 gap-6">
              {/* Sidebar */}
              <aside className="col-span-12 md:col-span-3 hidden md:block">
                <div className="space-y-4">
                  <section className="rounded-2xl border border-neutral-800 bg-neutral-900">
                    <div className="px-4 py-3 border-b border-neutral-800 text-sm font-medium">Media Type</div>
                    <div className="p-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => setActiveTab('all')}
                        className={`px-3 py-1.5 rounded-full text-sm border ${activeTab==='all' ? 'bg-neutral-200 text-neutral-900 border-neutral-200' : 'border-neutral-700 hover:bg-neutral-800'}`}
                      >All</button>
                      {categories.map((cat: UICategory) => (
                        <button
                          key={cat.key}
                          onClick={() => setActiveTab(cat.key)}
                          className={`px-3 py-1.5 rounded-full text-sm border ${activeTab===cat.key ? 'bg-neutral-200 text-neutral-900 border-neutral-200' : 'border-neutral-700 hover:bg-neutral-800'}`}
                        >{cat.label}</button>
                      ))}
                    </div>
                  </section>
                  <section className="rounded-2xl border border-neutral-800 bg-neutral-900">
                    <div className="px-4 py-3 border-b border-neutral-800 text-sm font-medium">Sources</div>
                    <div className="p-3 space-y-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-neutral-300">Local Disk</span>
                        <span className="text-neutral-500">Enabled</span>
                      </div>
                      <div className="flex items-center justify-between opacity-50">
                        <span className="text-neutral-300">S3 Bucket</span>
                        <span className="text-neutral-500">Coming soon</span>
                      </div>
                      <div className="flex items-center justify-between opacity-50">
                        <span className="text-neutral-300">GDrive</span>
                        <span className="text-neutral-500">Coming soon</span>
                      </div>
                    </div>
                  </section>
                </div>
              </aside>

              {/* Main: Browse layout */}
              <section className="col-span-12 md:col-span-9">
                <div className="grid grid-cols-12 gap-6">
                  <div className="col-span-12 lg:col-span-5">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="text-lg font-semibold">Media Sources</h2>
                        <p className="text-sm text-neutral-400">Select a source to browse</p>
                      </div>
                    </div>
                    <div className="max-h-[70vh] overflow-y-auto pr-1">
                      <SourceList
                        onAddSource={handleAddSource}
                        refreshTrigger={refreshTrigger}
                        onSelectSource={handleSelectSource}
                        compact
                        showFilter
                      />
                    </div>
                  </div>
                  <div className="col-span-12 lg:col-span-7">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="text-lg font-semibold">{selectedSourceId ? 'Browsing' : 'Preview'}</h2>
                        <p className="text-sm text-neutral-400">{selectedSourceId ? 'Items from selected source' : 'Select a source to view its media'}</p>
                      </div>
                    </div>
                    {selectedSourceId ? (
                      <SearchResults
                        results={(activeTab==='all') ? browsedItems : browsedItems.filter((it: MediaItem) => it.type === activeTab)}
                        query={''}
                        viewMode={viewMode}
                        mode="browse"
                      />
                    ) : (
                      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6 text-sm text-neutral-400">
                        Choose a source on the left to start browsing.
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
      </main>

      {/* Add Source Modal */}
      {showAddForm && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={handleCancelAdd} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-xl max-w-md w-full">
              <AddSourceForm
                onSourceAdded={handleSourceAdded}
                onCancel={handleCancelAdd}
              />
            </div>
          </div>
        </div>
      )}

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
                  {jobDetails.map(job => {
                    const phase = job.status === 'pending' ? 'Queued' : (job.progress < 50 ? 'Scanning' : 'Processing');
                    return (
                      <div key={job.id} className="text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <div className="font-mono">{job.id.slice(0,8)}…</div>
                          <div className="text-neutral-400">{phase} • {Math.max(0, Math.min(100, Math.round(job.progress || 0)))}%</div>
                        </div>
                        <div className="h-2 w-full bg-neutral-800 rounded">
                          <div className="h-2 rounded bg-blue-500" style={{ width: `${Math.max(0, Math.min(100, Math.round(job.progress || 0)))}%` }} />
                        </div>
                        {(job.totalItems || job.processedItems) && (
                          <div className="mt-1 text-[10px] text-neutral-500">
                            {job.processedItems ?? 0}/{job.totalItems ?? '?'} items
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

      {/* Footer */}
      <footer className="border-t border-neutral-800 py-6 text-center text-xs text-neutral-500">
        © Driller - Media Search Engine
      </footer>
    </div>
  );
}

export default App;
