// Simple plugin registry with dynamic ES module loading (Vite import.meta.glob)
// Plugins can contribute UI categories and icon providers.

export type Category = { key: string; label: string };
export type IconProvider = {
  name: string;
  // Return an icon string for a file by extension or mime.
  getIcon: (info: { name?: string; path?: string; mimeType?: string; type?: string }) => string | undefined;
};

class PluginRegistryImpl {
  private categories: Category[] = [];
  private iconProviders: IconProvider[] = [];
  private loaded = false;

  registerCategory(cat: Category) {
    if (!this.categories.find(c => c.key === cat.key)) this.categories.push(cat);
  }

  registerIconProvider(provider: IconProvider) {
    if (!this.iconProviders.find(p => p.name === provider.name)) this.iconProviders.push(provider);
  }

  getCategories(): Category[] {
    return this.categories.slice();
  }

  getIconProviders(): IconProvider[] {
    return this.iconProviders.slice();
  }

  async loadPlugins(): Promise<void> {
    if (this.loaded) return;
    // Discover plugin modules under src/plugins and dynamically import them.
    // Each plugin module should default-export a function: (registry) => void
    const modules = import.meta.glob('../plugins/**/*.ts');
    for (const loader of Object.values(modules)) {
      try {
        // Vite returns a function that dynamically imports the module
        // Cast to any to allow accessing default safely
        const modAny: any = await (loader as any)();
        if (modAny && typeof modAny.default === 'function') {
          modAny.default(this);
        }
      } catch (e) {
        console.warn('Plugin load failed:', e);
      }
    }
    this.loaded = true;
  }
}

export const PluginRegistry = new PluginRegistryImpl();
