/**
 * MIME inference for files served by the dsh-explorer-editor host gateway,
 * plus the single source of truth for "binary" file extensions.
 *
 * Kept dependency-free and importable in Node tests (no decorators, no
 * cordis) so the mapping can be unit-tested directly.
 */

/**
 * Extensions always treated as binary (never opened in the text editor).
 * `FileManagerGateway.isTextName` consults this set (case-insensitively), and
 * `mimeOf` maps a subset of these to concrete MIME types — keep the two in
 * agreement so a file never gets both "binary" and "text" classification.
 */
export const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  // images
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'avif', 'tif', 'tiff', 'psd', 'ai',
  // documents / archives
  'pdf', 'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'zst', 'br',
  // audio / video
  'mp3', 'wav', 'flac', 'ogg', 'mp4', 'webm', 'mov', 'avi', 'mkv',
  // fonts
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  // compiled / binary payloads
  'wasm', 'exe', 'dll', 'so', 'dylib', 'bin', 'class', 'jar', 'war', 'o', 'a', 'lib',
  'pyc', 'pyo', 'db', 'sqlite', 'iso', 'dmg', 'apk',
  // office documents
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
]);

/** Infer a browser MIME type from a file extension (small common subset). */
export function mimeOf(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'svg': return 'image/svg+xml';
    case 'png': return 'image/png';
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'ico': return 'image/x-icon';
    case 'bmp': return 'image/bmp';
    case 'avif': return 'image/avif';
    case 'pdf': return 'application/pdf';
    case 'woff': return 'font/woff';
    case 'woff2': return 'font/woff2';
    case 'ttf': return 'font/ttf';
    case 'otf': return 'font/otf';
    case 'mp3': return 'audio/mpeg';
    case 'wav': return 'audio/wav';
    case 'mp4': return 'video/mp4';
    case 'webm': return 'video/webm';
    default: return 'application/octet-stream';
  }
}
