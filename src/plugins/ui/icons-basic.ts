// Default export a registration function to avoid importing the registry here
export default function register(registry: any) {
  registry.registerIconProvider({
    name: 'basic-file-icons',
    getIcon: ({ name, path, mimeType, type }: { name?: string; path?: string; mimeType?: string; type?: string }) => {
      const p = (path || name || '').toLowerCase();
      const ext = p.slice(p.lastIndexOf('.') + 1);
      const mime = (mimeType || '').toLowerCase();

      // Specific extensions
      if (['pdf'].includes(ext) || mime === 'application/pdf') return '📕';
      if (['doc', 'docx', 'rtf', 'odt'].includes(ext) || mime.includes('msword') || mime.includes('wordprocessingml')) return '📄';
      if (['txt', 'log'].includes(ext) || mime.startsWith('text/')) return '📝';
      if (['md', 'markdown'].includes(ext)) return '📝';
      if (['json'].includes(ext)) return '🧾';
      if (['csv', 'tsv'].includes(ext)) return '📊';
      if (['zip', 'gz', 'rar', '7z', 'tar', 'bz2'].includes(ext) || mime.includes('zip') || mime.includes('gzip')) return '🗜️';
      if (['ppt', 'pptx', 'odp'].includes(ext)) return '📽️';
      if (['xls', 'xlsx', 'ods'].includes(ext)) return '📈';

      // Fallback by media type
      switch (type) {
        case 'image': return '🖼️';
        case 'video': return '🎥';
        case 'audio': return '🎵';
        case 'document': return '📄';
        default: break;
      }

      // Fallback by mime group
      if (mime.startsWith('image/')) return '🖼️';
      if (mime.startsWith('video/')) return '🎥';
      if (mime.startsWith('audio/')) return '🎵';

      return undefined;
    }
  });
}
