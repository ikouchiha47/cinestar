import { useState } from 'react';

type ImageState = {
  isOpen: boolean;
  imagePath?: string;
  imageName?: string;
  caption?: string;
  thumbDataUrl?: string | null;
  loading: boolean;
  error?: string;
};

export function useImageViewer() {
  const [state, setState] = useState<ImageState>({ isOpen: false, loading: false, thumbDataUrl: null });

  const open = async (opts: { imagePath: string; imageName?: string }) => {
    setState((s) => ({ ...s, isOpen: true, loading: true, imagePath: opts.imagePath, imageName: opts.imageName, error: undefined }));
    try {
      const [meta, thumb] = await Promise.all([
        (window.mediaAPI as any).getImageMetadata?.(opts.imagePath).catch(() => null),
        window.mediaAPI.getImageThumbnail(opts.imagePath).catch(() => ({ success: false }))
      ]);
      const caption = meta?.success ? meta.metadata?.caption : undefined;
      const thumbDataUrl = (thumb && (thumb as any).success && typeof (thumb as any).dataUrl === 'string') ? (thumb as any).dataUrl as string : null;
      setState((s) => ({ ...s, caption, thumbDataUrl, loading: false }));
    } catch (e: any) {
      setState((s) => ({ ...s, loading: false, error: e?.message || 'Failed to load image' }));
    }
  };

  const close = () => setState({ isOpen: false, loading: false, thumbDataUrl: null });

  return { imageState: state, openImageViewer: open, closeImageViewer: close };
}
