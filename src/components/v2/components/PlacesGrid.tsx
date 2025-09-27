/**
 * PlacesGrid - Displays folders and sources in a grid layout
 */

import React from 'react';
import { Place } from '../types';
import { Icon } from './Icons';

interface PlacesGridProps {
  places: Place[];
  onBrowse: (placeId: string) => void;
  onIndex?: (placeId: string, forceReindex?: boolean) => void;
}

export function PlacesGrid({ places, onBrowse, onIndex }: PlacesGridProps) {
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm text-neutral-300">
          <b>Folders & places</b> <span className="text-neutral-500">{places.length}</span>
        </div>
        <div className="text-xs text-neutral-500">Sorted by recent use</div>
      </div>
      {places.length === 0 ? (
        <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6 text-center text-neutral-500">
          No folders match the current filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {places.map((p) => (
            <div key={p.id} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-3 hover:border-neutral-700">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {p.kind === 'local' ? <Icon.Folder /> : p.kind === 's3' ? <Icon.Server /> : <Icon.Cloud />}
                  <div className="text-sm font-medium">{p.label}</div>
                </div>
                {p.pinned && <span className="text-[10px] rounded-md bg-neutral-800 px-2 py-0.5">Pinned</span>}
              </div>
              <div className="mt-1 text-xs text-neutral-500 truncate">{p.path}</div>
              <div className="mt-3 flex items-center justify-between text-xs text-neutral-400">
                <span>{p.count ? p.count.toLocaleString() : '—'} items</span>
                <div className="flex gap-1">
                  <button className="rounded-md border border-neutral-700 p-1.5 hover:bg-neutral-800" onClick={() => onBrowse(p.id)} title="Browse">
                    <Icon.Browse />
                  </button>
                  {onIndex && (
                    <button className="rounded-md border border-neutral-700 p-1.5 hover:bg-neutral-800" onClick={() => onIndex(p.id)} title="Index">
                      <Icon.Index />
                    </button>
                  )}
                  {onIndex && (
                    <button className="rounded-md border border-orange-700 p-1.5 hover:bg-orange-900/50 text-orange-400 hover:text-orange-300" onClick={() => onIndex(p.id, true)} title="Force Re-index">
                      <Icon.Refresh />
                    </button>
                  )}
                  <button className="rounded-md border border-neutral-700 p-1.5 hover:bg-neutral-800" title="Pin">
                    <Icon.Pin />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
