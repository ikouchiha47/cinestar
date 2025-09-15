import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'

console.log('[MAIN] Starting React app render at:', new Date().toISOString());

ReactDOM.createRoot(document.getElementById('root')!).render(
  // Removed StrictMode to avoid dev double-invocation overhead
  <App />,
)

console.log('[MAIN] React app render initiated at:', new Date().toISOString());

// Inform Electron main that the app has mounted (first render complete)
try {
  console.log('[MAIN] Sending renderer:app-mounted to main');
  (window as any).ipcRenderer?.send?.('renderer:app-mounted');
} catch {}

// Use contextBridge
window.ipcRenderer.on('main-process-message', (_event, message) => {
  console.log(message)
})
