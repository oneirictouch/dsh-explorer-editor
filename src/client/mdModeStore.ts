/**
 * Markdown view-mode preference for the dsh-explorer-editor editor view.
 *
 * Holds whether Markdown files open in rendered preview or raw source,
 * persisted to localStorage (global preference — not per file). Follows the
 * same useSyncExternalStore pattern as themeStore.ts.
 */
import { useSyncExternalStore } from 'react';

/** The two Markdown view modes. */
export type MdViewMode = 'preview' | 'source';

/** Default mode: raw source (editable) — Markdown opens in the editor. */
export const DEFAULT_MD_MODE: MdViewMode = 'source';

/** localStorage key (versioned to allow future migrations). */
export const MD_MODE_STORAGE_KEY = 'dsh-file:md-mode:v2';

const VALID: ReadonlySet<string> = new Set(['preview', 'source']);

/** Read the persisted mode; falls back to DEFAULT_MD_MODE. */
export function loadMdMode(storage: Pick<Storage, 'getItem'> | undefined): MdViewMode {
  try {
    const raw = storage?.getItem(MD_MODE_STORAGE_KEY);
    return raw !== null && raw !== undefined && VALID.has(raw) ? (raw as MdViewMode) : DEFAULT_MD_MODE;
  } catch {
    return DEFAULT_MD_MODE;
  }
}

/** Persist the mode (best-effort; storage failures are ignored). */
export function persistMdMode(mode: MdViewMode, storage: Pick<Storage, 'setItem'> | undefined): void {
  try {
    storage?.setItem(MD_MODE_STORAGE_KEY, mode);
  } catch { /* quota / privacy mode: keep in-memory */ }
}

let current: MdViewMode = loadMdMode(safeStorage());
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** localStorage guarded for SSR / Node (tests, no window). */
function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): MdViewMode {
  return current;
}

/** React hook: the current Markdown view mode. */
export function useMdMode(): MdViewMode {
  return useSyncExternalStore(subscribe, snapshot);
}

/** Switch the Markdown view mode (persisted, live). */
export function setMdMode(mode: MdViewMode): void {
  current = mode;
  const storage = safeStorage();
  if (storage !== undefined) persistMdMode(mode, storage);
  emit();
}
