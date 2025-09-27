export type Scope = 'all' | 's3' | 'drive' | 'folders';

export type Place = {
  id: string;
  kind: 'local' | 's3' | 'gdrive';
  label: string;
  path: string;
  count?: number;
  pinned?: boolean;
};

export type MediaT = {
  id: string;
  placeId: string;
  type: 'image' | 'video' | 'audio';
  name: string;
  path: string;
  thumb?: string;
};
