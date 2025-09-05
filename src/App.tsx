import { useState, useEffect } from 'react';
import { AddSourceForm } from './components/AddSourceForm';
// Import directly from the file
import { SourceList } from './components/SourceList';
import { SearchBar } from './components/SearchBar';
import { SearchResults } from './components/SearchResults';
import { MediaItem } from './core/types';
import './App.css';

function App() {
  const [showAddForm, setShowAddForm] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [initialized, setInitialized] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<boolean | null>(null);
  const [searchResults, setSearchResults] = useState<MediaItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

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
        setInitialized(true);
      } catch (error) {
        console.error('Failed to initialize app:', error);
        setInitialized(true);
      }
    };

    initializeApp();
  }, []);

  const handleSourceAdded = () => {
    setShowAddForm(false);
    setRefreshTrigger(prev => prev + 1);
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
      <div className="app loading">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <h2>Initializing Driller...</h2>
          <p>Setting up your media search engine</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <div className="logo-section">
            <h1>🔍 Driller</h1>
            <p>LLM-Based Media Search Engine</p>
          </div>
          <div className="status-section">
            {ollamaStatus !== null && (
              <div className={`ollama-status ${ollamaStatus ? 'available' : 'unavailable'}`}>
                {ollamaStatus ? '✅ Ollama Available' : '⚠️ Ollama Unavailable'}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="app-main">
        {showAddForm && (
          <div className="modal-overlay">
            <div className="modal-content">
              <AddSourceForm
                onSourceAdded={handleSourceAdded}
                onCancel={handleCancelAdd}
              />
            </div>
          </div>
        )}

        <div className="main-content">
          <div className="search-section">
            <SearchBar onResults={handleSearchResults} />
            <SearchResults results={searchResults} query={searchQuery} />
          </div>
          
          <div className="sources-section">
            <SourceList
              onAddSource={handleAddSource}
              refreshTrigger={refreshTrigger}
            />
          </div>
        </div>
      </main>

      <footer className="app-footer">
        <p>
          Add media sources like <code>add-source local "My Photos" /Users/john/Pictures</code> 
          to start indexing and searching your files.
        </p>
      </footer>
    </div>
  );
}

export default App;
