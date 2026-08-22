/**
 * Pure path helpers for the dsh-explorer-editor client. Kept dependency-free so the
 * relative-path logic is unit-testable under node:test.
 */

/**
 * Normalize a path to POSIX separators without a trailing slash. All client
 * path helpers funnel through this so the root-prefix logic lives in one place.
 */
export function normalizePosix(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Whether `path` is `root` itself or lives strictly under it. An empty root
 * means "no boundary" (everything is inside).
 */
export function isInsideRoot(root: string, path: string): boolean {
  const r = normalizePosix(root);
  const p = normalizePosix(path);
  if (r === '') return true;
  return p === r || p.startsWith(`${r}/`);
}

/**
 * Compute the workspace-relative path of `full` against the workspace `root`.
 *
 * Both inputs are treated as POSIX-style paths (the client builds node paths
 * with "/" separators). Returns:
 *   - `""` when `full` is the root itself (or only differs by a trailing "/")
 *   - the relative path without a leading "/"
 *   - the input unchanged when `full` does not live under `root` (defensive)
 */
export function relativePath(root: string, full: string): string {
  const r = normalizePosix(root);
  const f = normalizePosix(full);
  if (f === r) return '';
  if (!isInsideRoot(r, f)) return full;
  return f.slice(r === '' ? 0 : r.length + 1);
}

/** Basename of a POSIX-style path (trailing slash stripped first). */
export function baseName(path: string): string {
  const p = normalizePosix(path);
  const i = p.lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}
