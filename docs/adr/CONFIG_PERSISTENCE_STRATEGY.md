# Configuration Persistence Strategy

## Problem: ASAR in Production

In production Electron builds, the app is packaged in an ASAR archive which is **read-only**. We cannot modify JSON files inside the ASAR at runtime.

## Solution: Two-Tier Configuration System

### Tier 1: Built-in Defaults (Read-Only, in ASAR)
- `src/core/llm/*-models-config.json` - Bundled with app
- Loaded at startup via imports
- Never modified at runtime
- Provides model listings and metadata

### Tier 2: User Configuration (Read-Write, User Data)
- Stored in Electron's `userData` directory
- Contains user's active selections and API keys
- Persisted across app restarts
- Can be modified at runtime

## Implementation

### 1. Configuration File Locations

```typescript
// In main process
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

const USER_DATA_PATH = app.getPath('userData');
const CONFIG_FILE = path.join(USER_DATA_PATH, 'llm-config.json');

// User config structure
interface UserLLMConfig {
  activeProvider: string;
  providers: {
    [providerId: string]: {
      apiKey?: string;
      selectedModels: {
        vision?: string;
        text?: string;
        embedding?: string;
        transcription?: string;
      };
      enabled: boolean;
    };
  };
}
```

### 2. Config Manager Updates

Update `provider-config-manager.ts` to handle user preferences:

```typescript
export class ProviderConfigManager {
  private configs: Map<string, ProviderConfig>; // Built-in (read-only)
  private userConfig: UserLLMConfig; // User settings (read-write)
  
  constructor() {
    this.configs = new Map();
    this.loadBuiltInConfigs(); // From ASAR
    this.loadUserConfig(); // From userData
  }
  
  private loadUserConfig(): void {
    try {
      const configPath = this.getUserConfigPath();
      if (fs.existsSync(configPath)) {
        const data = fs.readFileSync(configPath, 'utf-8');
        this.userConfig = JSON.parse(data);
      } else {
        this.userConfig = this.getDefaultUserConfig();
      }
    } catch (error) {
      console.error('Failed to load user config:', error);
      this.userConfig = this.getDefaultUserConfig();
    }
  }
  
  saveUserConfig(): void {
    try {
      const configPath = this.getUserConfigPath();
      fs.writeFileSync(
        configPath,
        JSON.stringify(this.userConfig, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.error('Failed to save user config:', error);
    }
  }
  
  private getUserConfigPath(): string {
    // This should be called from main process or via IPC
    return path.join(app.getPath('userData'), 'llm-config.json');
  }
  
  private getDefaultUserConfig(): UserLLMConfig {
    return {
      activeProvider: 'ollama', // Privacy-first default
      providers: {
        ollama: {
          enabled: true,
          selectedModels: {
            vision: 'moondream:v2',
            text: 'qwen3:4b',
            embedding: 'qllama/bge-large-en-v1.5:latest',
            transcription: 'whisper:latest'
          }
        },
        openai: {
          enabled: false,
          selectedModels: {
            vision: 'gpt-4.1-mini',
            text: 'gpt-4.1',
            embedding: 'text-embedding-3-large',
            transcription: 'gpt-4o-transcribe'
          }
        },
        litellm: {
          enabled: false,
          selectedModels: {
            vision: 'gemini/gemini-2.0-flash-exp',
            text: 'gemini/gemini-2.0-flash-exp',
            embedding: 'text-embedding-3-large'
          }
        }
      }
    };
  }
  
  // Get user's selected model for a task
  getUserSelectedModel(providerId: string, task: string): string | undefined {
    return this.userConfig.providers[providerId]?.selectedModels[task];
  }
  
  // Set user's selected model for a task
  setUserSelectedModel(providerId: string, task: string, modelId: string): void {
    if (!this.userConfig.providers[providerId]) {
      this.userConfig.providers[providerId] = {
        enabled: true,
        selectedModels: {}
      };
    }
    this.userConfig.providers[providerId].selectedModels[task] = modelId;
    this.saveUserConfig();
  }
  
  // Get/Set API key
  getApiKey(providerId: string): string | undefined {
    return this.userConfig.providers[providerId]?.apiKey;
  }
  
  setApiKey(providerId: string, apiKey: string): void {
    if (!this.userConfig.providers[providerId]) {
      this.userConfig.providers[providerId] = {
        enabled: true,
        selectedModels: {}
      };
    }
    this.userConfig.providers[providerId].apiKey = apiKey;
    this.saveUserConfig();
  }
  
  // Get active provider
  getActiveProvider(): string {
    return this.userConfig.activeProvider;
  }
  
  // Set active provider
  setActiveProvider(providerId: string): void {
    this.userConfig.activeProvider = providerId;
    this.saveUserConfig();
  }
}
```

### 3. IPC Bridge (Main ↔ Renderer)

Since file system access is in main process, create IPC handlers:

```typescript
// In main process (main.ts or preload.ts)
import { ipcMain } from 'electron';

// Get user config
ipcMain.handle('llm:getUserConfig', async () => {
  return providerConfigManager.getUserConfig();
});

// Save user config
ipcMain.handle('llm:saveUserConfig', async (event, config: UserLLMConfig) => {
  providerConfigManager.setUserConfig(config);
  return { success: true };
});

// Get API key
ipcMain.handle('llm:getApiKey', async (event, providerId: string) => {
  return providerConfigManager.getApiKey(providerId);
});

// Set API key
ipcMain.handle('llm:setApiKey', async (event, providerId: string, apiKey: string) => {
  providerConfigManager.setApiKey(providerId, apiKey);
  return { success: true };
});

// Set selected model
ipcMain.handle('llm:setSelectedModel', async (event, providerId: string, task: string, modelId: string) => {
  providerConfigManager.setUserSelectedModel(providerId, task, modelId);
  return { success: true };
});

// Set active provider
ipcMain.handle('llm:setActiveProvider', async (event, providerId: string) => {
  providerConfigManager.setActiveProvider(providerId);
  return { success: true };
});
```

### 4. Renderer Process Usage

In your React components:

```typescript
// Create a service wrapper
class LLMConfigService {
  async getUserConfig(): Promise<UserLLMConfig> {
    return window.electron.invoke('llm:getUserConfig');
  }
  
  async setApiKey(providerId: string, apiKey: string): Promise<void> {
    await window.electron.invoke('llm:setApiKey', providerId, apiKey);
  }
  
  async setSelectedModel(providerId: string, task: string, modelId: string): Promise<void> {
    await window.electron.invoke('llm:setSelectedModel', providerId, task, modelId);
  }
  
  async setActiveProvider(providerId: string): Promise<void> {
    await window.electron.invoke('llm:setActiveProvider', providerId);
  }
}

export const llmConfigService = new LLMConfigService();
```

### 5. Update ProviderSettings Component

```typescript
import { llmConfigService } from '../services/llm-config-service';

export const ProviderSettings: React.FC<ProviderSettingsProps> = () => {
  const [userConfig, setUserConfig] = useState<UserLLMConfig | null>(null);
  
  useEffect(() => {
    // Load user config on mount
    llmConfigService.getUserConfig().then(setUserConfig);
  }, []);
  
  const handleApiKeyChange = async (providerId: string, apiKey: string) => {
    await llmConfigService.setApiKey(providerId, apiKey);
    // Update local state
    setUserConfig(prev => ({
      ...prev!,
      providers: {
        ...prev!.providers,
        [providerId]: {
          ...prev!.providers[providerId],
          apiKey
        }
      }
    }));
  };
  
  const handleModelSelect = async (providerId: string, task: string, modelId: string) => {
    await llmConfigService.setSelectedModel(providerId, task, modelId);
    // Update local state
    setUserConfig(prev => ({
      ...prev!,
      providers: {
        ...prev!.providers,
        [providerId]: {
          ...prev!.providers[providerId],
          selectedModels: {
            ...prev!.providers[providerId].selectedModels,
            [task]: modelId
          }
        }
      }
    }));
  };
  
  // ... rest of component
};
```

## File Structure

```
Production Build (ASAR - Read Only):
app.asar/
└── resources/
    └── app/
        └── src/
            └── core/
                └── llm/
                    ├── openai-models-config.json    ← Built-in (read-only)
                    ├── ollama-models-config.json    ← Built-in (read-only)
                    └── litellm-models-config.json   ← Built-in (read-only)

User Data Directory (Read-Write):
~/Library/Application Support/Drillbit/  (macOS)
%APPDATA%/Drillbit/                      (Windows)
~/.config/Drillbit/                      (Linux)
└── llm-config.json                      ← User settings (read-write)
```

## Security Considerations

### API Key Storage

**Option 1: Plain JSON (Simple, Less Secure)**
```json
{
  "providers": {
    "openai": {
      "apiKey": "sk-..."
    }
  }
}
```

**Option 2: Encrypted (More Secure)**
```typescript
import { safeStorage } from 'electron';

// Encrypt before saving
const encryptApiKey = (apiKey: string): string => {
  if (safeStorage.isEncryptionAvailable()) {
    const buffer = safeStorage.encryptString(apiKey);
    return buffer.toString('base64');
  }
  return apiKey; // Fallback to plain text
};

// Decrypt when loading
const decryptApiKey = (encrypted: string): string => {
  if (safeStorage.isEncryptionAvailable()) {
    const buffer = Buffer.from(encrypted, 'base64');
    return safeStorage.decryptString(buffer);
  }
  return encrypted; // Fallback
};
```

## Migration Strategy

### First Run Detection

```typescript
const isFirstRun = (): boolean => {
  const configPath = path.join(app.getPath('userData'), 'llm-config.json');
  return !fs.existsSync(configPath);
};

if (isFirstRun()) {
  // Show onboarding/setup wizard
  // Create default config
  providerConfigManager.saveUserConfig();
}
```

### Config Version Management

```json
{
  "version": "1.0.0",
  "activeProvider": "ollama",
  "providers": { ... }
}
```

```typescript
const migrateConfig = (config: any): UserLLMConfig => {
  if (!config.version || config.version === '1.0.0') {
    // No migration needed
    return config;
  }
  
  // Handle future migrations
  return config;
};
```

## Summary

### ✅ What Works in ASAR
- Reading built-in model configs (JSON imports)
- Loading provider metadata
- Displaying model options to users

### ✅ What Needs userData
- User's selected models per task
- API keys (encrypted)
- Active provider selection
- Provider enable/disable state

### 🔧 Integration Steps

1. **Create IPC handlers** in main process
2. **Create service wrapper** in renderer
3. **Update ProviderSettings** to use IPC
4. **Add to app settings** screen
5. **Test with production build** (ASAR)

### 📁 Files to Create

1. `src/main/llm-config-handler.ts` - IPC handlers
2. `src/services/llm-config-service.ts` - Renderer service
3. `src/core/llm/user-config.types.ts` - User config types
4. Update `src/core/llm/provider-config-manager.ts` - Add user config methods

Would you like me to create these integration files?
