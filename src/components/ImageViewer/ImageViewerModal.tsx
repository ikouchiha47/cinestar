import { useEffect, useState } from 'react';

export function ImageViewerModal(props: {
  isOpen: boolean;
  imagePath?: string;
  imageName?: string;
  caption?: string;
  thumbDataUrl?: string | null;
  onClose: () => void;
}) {
  const { isOpen, imagePath, imageName, caption, thumbDataUrl, onClose } = props;
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (isOpen) {
      window.addEventListener('keydown', onKey);
      // Trigger animation after mount
      requestAnimationFrame(() => setIsAnimating(true));
    } else {
      setIsAnimating(false);
    }
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Use custom protocol for local files, fallback to dataURL
  const imageSrc = imagePath ? `media-file://${imagePath}` : thumbDataUrl;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop with fade-in */}
      <div 
        className={`absolute inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-200 ${
          isAnimating ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose} 
      />

      {/* Modal - Fixed responsive sizes with scale animation */}
      <div 
        className={`relative z-10 w-[95vw] h-[90vh] sm:w-[90vw] sm:h-[85vh] md:w-[85vw] md:h-[80vh] lg:w-[80vw] lg:h-[75vh] xl:max-w-6xl xl:h-[70vh] rounded-2xl border border-neutral-800 bg-neutral-900/80 backdrop-blur-xl shadow-2xl overflow-hidden flex flex-col transition-all duration-200 ease-out ${
          isAnimating ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
        }`}
      >
        {/* Header - Fixed height */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800 flex-shrink-0">
          <div className="text-sm text-neutral-300 truncate pr-4">{imageName || (imagePath ? imagePath.split('/').pop() : 'Image')}</div>
          <button onClick={onClose} className="rounded-lg border border-neutral-700 px-2 py-1 text-sm text-neutral-300 hover:bg-neutral-800">Close</button>
        </div>

        {/* Content - Flex grow to fill remaining space */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-0 flex-1 min-h-0 overflow-hidden">
          <div className="bg-black flex items-center justify-center p-2 md:p-3 overflow-hidden">
            {imageSrc ? (
              <img src={imageSrc} alt={imageName || 'image'} className="w-full h-full object-contain rounded-lg" />
            ) : (
              <div className="text-neutral-500 text-sm">Loading...</div>
            )}
          </div>
          <div className="p-4 md:p-5 border-t md:border-t-0 md:border-l border-neutral-800 overflow-y-auto">
            <div className="text-sm text-neutral-400 mb-2">Caption</div>
            <div className="text-neutral-200 text-sm whitespace-pre-wrap leading-relaxed">
              {caption || '—'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
