/**
 * Editor session persistence: keeps open tabs and unsaved edits across page
 * reloads via localStorage.
 *
 * Pure helpers (`shouldPersistContent`, `filterByRoot`, `serialize`,
 * `deserialize`) are exported for unit tests; the localStorage wrapper
 * debounces writes so per-keystroke content updates don't hammer storage, and
 * degrades gracefully on quota exhaustion.
 */
import { isInsideRoot } from './paths.ts';

export const SNAPSHOT_KEY = 'dsh-file-editor-session';
/** Content budget per tab: larger files persist their path only (re-read on restore). */
export const MAX_PERSIST_CONTENT = 262144; // 256 KiB

export interface PersistTab {
  path: string;
  mtimeMs: number;
  dirty: boolean;
  error?: string;
  /** Present only when the content fits within the persistence budget. */
  content?: string;
  savedContent?: string;
}

export interface PersistSnapshot {
  root: string;
  activePath: string | null;
  tabs: PersistTab[];
}

/** Whether a tab's content is small enough to persist verbatim. */
export function shouldPersistContent(tab: { content: string }): boolean {
  return tab.content.length <= MAX_PERSIST_CONTENT;
}

/** Keep only tabs whose path still lives under the workspace root. */
export function filterByRoot(tabs: readonly { path: string }[], root: string): { path: string }[] {
  return tabs.filter((t) => isInsideRoot(root, t.path));
}

export function serialize(snapshot: PersistSnapshot): string {
  return JSON.stringify(snapshot);
}

/** Parse a snapshot; returns null on any malformed input (never throws). */
export function deserialize(raw: string): PersistSnapshot | null {
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return null;
    const obj = data as Record<string, unknown>;
    if (typeof obj.root !== 'string' || !Array.isArray(obj.tabs)) return null;
    const tabs: PersistTab[] = [];
    for (const entry of obj.tabs) {
      if (typeof entry !== 'object' || entry === null) continue;
      const t = entry as Record<string, unknown>;
      if (typeof t.path !== 'string') continue;
      tabs.push({
        path: t.path,
        mtimeMs: typeof t.mtimeMs === 'number' ? t.mtimeMs : 0,
        dirty: t.dirty === true,
        error: typeof t.error === 'string' ? t.error : undefined,
        content: typeof t.content === 'string' ? t.content : undefined,
        savedContent: typeof t.savedContent === 'string' ? t.savedContent : undefined,
      });
    }
    return {
      root: obj.root,
      activePath: typeof obj.activePath === 'string' ? obj.activePath : null,
      tabs,
    };
  } catch {
    return null;
  }
}

// ── localStorage wrapper (debounced, best-effort) ─────────────────────────

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: PersistSnapshot | null = null;

function writeSnapshot(snapshot: PersistSnapshot): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(SNAPSHOT_KEY, serialize(snapshot));
  } catch {
    // Quota exceeded: retry once with paths only (drop all content).
    try {
      const slim: PersistSnapshot = {
        root: snapshot.root,
        activePath: snapshot.activePath,
        tabs: snapshot.tabs.map((t) => ({ path: t.path, mtimeMs: t.mtimeMs, dirty: t.dirty, error: t.error })),
      };
      localStorage.setItem(SNAPSHOT_KEY, serialize(slim));
    } catch {
      // Give up silently; persistence is best-effort.
    }
  }
}

/** Debounced snapshot save (≈400ms after the last mutation). */
export function saveSnapshot(snapshot: PersistSnapshot): void {
  pending = snapshot;
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    if (pending !== null) {
      writeSnapshot(pending);
      pending = null;
    }
  }, 400);
}

export function loadSnapshot(): PersistSnapshot | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw === null ? null : deserialize(raw);
  } catch {
    return null;
  }
}

export function clearSnapshot(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
    pending = null;
  }
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch {
    // best-effort
  }
}
