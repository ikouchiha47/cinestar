import { PluginRegistry } from './plugin-registry';

export type UICategory = {
  key: string;
  label: string;
};

// Base categories always available
const BASE_CATEGORIES: UICategory[] = [
  { key: 'image', label: 'Images' },
  { key: 'video', label: 'Videos' },
  { key: 'audio', label: 'Audio' },
  { key: 'document', label: 'Documents' },
];

export const getUICategories = (): UICategory[] => {
  const pluginCats = PluginRegistry.getCategories();
  const keys = new Set<string>();
  const merged: UICategory[] = [];
  for (const c of BASE_CATEGORIES) {
    if (!keys.has(c.key)) { merged.push(c); keys.add(c.key); }
  }
  for (const c of pluginCats) {
    if (!keys.has(c.key)) { merged.push(c); keys.add(c.key); }
  }
  return merged;
};
