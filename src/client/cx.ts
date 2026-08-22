/**
 * Tiny classnames helper shared by all dsh-explorer-editor components
 * (dependency-free). Kept in one place so the same 3-line helper is not
 * duplicated across files.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
