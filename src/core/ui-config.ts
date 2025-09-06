export type UICategory = {
  key: string;
  label: string;
};

// Programmable UI categories. Add/remove items here and the tabs/filters will adapt.
export const UI_CATEGORIES: UICategory[] = [
  { key: 'image', label: 'Images' },
  { key: 'video', label: 'Videos' },
  { key: 'audio', label: 'Audio' },
];
