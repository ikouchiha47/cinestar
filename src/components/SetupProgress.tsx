import { motion } from 'framer-motion';

interface SetupTask {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  progress?: number;
  message?: string;
  size?: string;
}

interface SetupProgressProps {
  tasks: SetupTask[];
  overallProgress: number;
}

export function SetupProgress({ tasks, overallProgress }: SetupProgressProps) {
  const getStatusIcon = (status: SetupTask['status']) => {
    switch (status) {
      case 'completed':
        return (
          <div className="w-8 h-8 rounded-full bg-green-500/20 border-2 border-green-500 flex items-center justify-center">
            <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        );
      case 'running':
        return (
          <div className="w-8 h-8 rounded-full bg-blue-500/20 border-2 border-blue-500 flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
        );
      case 'error':
        return (
          <div className="w-8 h-8 rounded-full bg-red-500/20 border-2 border-red-500 flex items-center justify-center">
            <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
        );
      default:
        return (
          <div className="w-8 h-8 rounded-full bg-neutral-700 border-2 border-neutral-600 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-neutral-500"></div>
          </div>
        );
    }
  };

  const getStatusColor = (status: SetupTask['status']) => {
    switch (status) {
      case 'completed': return 'text-green-400';
      case 'running': return 'text-blue-400';
      case 'error': return 'text-red-400';
      default: return 'text-neutral-500';
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto">
      {/* Overall Progress */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-2xl font-bold text-white">Setting up Drillbit</h2>
          <span className="text-lg font-semibold text-blue-400">{Math.round(overallProgress)}%</span>
        </div>
        
        <div className="h-3 bg-neutral-800 rounded-full overflow-hidden border border-neutral-700">
          <motion.div
            className="h-full bg-gradient-to-r from-blue-500 to-purple-500"
            initial={{ width: 0 }}
            animate={{ width: `${overallProgress}%` }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          />
        </div>
        
        <p className="text-sm text-neutral-400 mt-2">
          This may take a few minutes. Downloading AI models for offline processing...
        </p>
      </div>

      {/* Task List */}
      <div className="space-y-4">
        {tasks.map((task, index) => (
          <motion.div
            key={task.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            className={`bg-neutral-900/50 border rounded-xl p-4 transition-all ${
              task.status === 'running' 
                ? 'border-blue-500/50 shadow-lg shadow-blue-500/10' 
                : task.status === 'completed'
                ? 'border-green-500/30'
                : task.status === 'error'
                ? 'border-red-500/50'
                : 'border-neutral-800'
            }`}
          >
            <div className="flex items-start gap-4">
              {/* Status Icon */}
              {getStatusIcon(task.status)}

              {/* Task Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h3 className={`font-semibold ${getStatusColor(task.status)}`}>
                    {task.name}
                  </h3>
                  {task.size && (
                    <span className="text-xs text-neutral-500 font-mono">{task.size}</span>
                  )}
                </div>

                {/* Progress Bar (for running tasks) */}
                {task.status === 'running' && task.progress !== undefined && (
                  <div className="mb-2">
                    <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-blue-500"
                        initial={{ width: 0 }}
                        animate={{ width: `${task.progress}%` }}
                        transition={{ duration: 0.2 }}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-neutral-400">{task.message || 'Downloading...'}</span>
                      <span className="text-xs text-blue-400 font-mono">{task.progress}%</span>
                    </div>
                  </div>
                )}

                {/* Status Message */}
                {task.message && task.status !== 'running' && (
                  <p className="text-sm text-neutral-400">{task.message}</p>
                )}

                {/* Completed Message */}
                {task.status === 'completed' && !task.message && (
                  <p className="text-sm text-green-400">✓ Ready</p>
                )}

                {/* Pending Message */}
                {task.status === 'pending' && (
                  <p className="text-sm text-neutral-500">Waiting...</p>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Fun Loading Messages */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
        className="mt-8 text-center"
      >
        <p className="text-sm text-neutral-500 italic">
          {overallProgress < 25 && "🚀 Preparing your AI-powered search engine..."}
          {overallProgress >= 25 && overallProgress < 50 && "🧠 Teaching the AI to understand your media..."}
          {overallProgress >= 50 && overallProgress < 75 && "🎨 Setting up vision models..."}
          {overallProgress >= 75 && overallProgress < 100 && "✨ Almost there..."}
          {overallProgress >= 100 && "🎉 Setup complete!"}
        </p>
      </motion.div>
    </div>
  );
}
