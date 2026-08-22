/**
 * Pure helper for mapping a filesystem watch event to the directory that
 * should be re-listed. `fs.watch(..., { recursive: true })` reports filenames
 * relative to the watched root (POSIX or Windows separators).
 */

/** Normalize a path to forward slashes without a trailing slash. */
export function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Parent directory of a changed path, as an absolute `/`-separated path under
 * the workspace root. A change to a root-level file maps to the root itself.
 */
export function parentDirOf(root: string, filename: string): string {
  const r = normPath(root);
  const f = normPath(filename).replace(/^\/+/, '');
  if (f === '') return r;
  const i = f.lastIndexOf('/');
  return i < 0 ? r : `${r}/${f.slice(0, i)}`;
}
