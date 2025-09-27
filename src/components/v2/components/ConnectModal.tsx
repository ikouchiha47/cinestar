/**
 * ConnectModal - Modal for connecting new sources (local folders, S3, etc.)
 */

import React from 'react';
import { Icon } from './Icons';

interface ConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPick: (kind: 'local' | 's3' | 'gdrive' | 'nas') => void;
}

export function ConnectModal({ isOpen, onClose, onPick }: ConnectModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full sm:w-[520px] bg-neutral-900 border-l border-neutral-800 shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <div className="font-semibold">Connect a place</div>
          <button onClick={onClose} className="rounded-lg border border-neutral-700 p-2 hover:bg-neutral-800">
            <Icon.Close />
          </button>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <button 
            onClick={() => onPick('local')} 
            className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-left hover:border-neutral-700"
          >
            <div className="flex items-center gap-2">
              <Icon.Folder /> Local folder
            </div>
            <div className="text-xs text-neutral-500 mt-1">Pick a folder</div>
          </button>
          <button 
            onClick={() => onPick('s3')} 
            className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-left hover:border-neutral-700"
          >
            <div className="flex items-center gap-2">
              <Icon.Server /> AWS S3
            </div>
            <div className="text-xs text-neutral-500 mt-1">Bucket or prefix</div>
          </button>
          <button 
            onClick={() => onPick('gdrive')} 
            className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-left hover:border-neutral-700"
          >
            <div className="flex items-center gap-2">
              <Icon.Cloud /> Google Drive
            </div>
            <div className="text-xs text-neutral-500 mt-1">Authorize Drive</div>
          </button>
          <button 
            onClick={() => onPick('nas')} 
            className="rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-left hover:border-neutral-700"
          >
            <div className="flex items-center gap-2">
              <Icon.Server /> Network Share
            </div>
            <div className="text-xs text-neutral-500 mt-1">SMB/NAS mount</div>
          </button>
        </div>
      </div>
    </div>
  );
}
