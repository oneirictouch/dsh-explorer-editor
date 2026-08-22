/**
 * Module-level shared state for the dsh-explorer-editor UI.
 *
 * The file TREE lives in the sidebar (`sidebar.workspaces` shadow) while the
 * EDITOR renders as the center-column "文件" view (`conversation.view`, inside
 * the session scroll body). Both halves need the same "open tabs / active
 * file" facts, so this tiny external store (React 18 `useSyncExternalStore`)
 * owns that state instead of duplicating it in two component trees.
 */
import { useSyncExternalStore } from 'react';
import { saveSnapshot, clearSnapshot, shouldPersistContent } from './editorPersist.ts';

/** One open editor tab. */
export interface OpenTab {
  path: string;
  content: string;
  savedContent: string;
  mtimeMs: number;
  dirty: boolean;
  error?: string;
}

let tabs: OpenTab[] = [];
let activePath: string | null = null;
let currentRoot: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Remember the workspace root the open tabs belong to (set by the panel). */
export function setWorkspaceRoot(root: string): void {
  currentRoot = root;
}

/** Debounced snapshot of the open editor session (survives page reloads). */
function persistNow(): void {
  if (currentRoot === null) return;
  saveSnapshot({
    root: currentRoot,
    activePath,
    tabs: tabs.map((t) => ({
      path: t.path,
      mtimeMs: t.mtimeMs,
      dirty: t.dirty,
      error: t.error,
      content: shouldPersistContent(t) ? t.content : undefined,
      savedContent: shouldPersistContent(t) ? t.savedContent : undefined,
    })),
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): OpenTab[] {
  return tabs;
}

function snapshotActive(): string | null {
  return activePath;
}

/** Subscribe the sidebar tree / editor overlay to the open-tab state. */
export function useTabs(): OpenTab[] {
  return useSyncExternalStore(subscribe, snapshot);
}

/** Subscribe to the active file path (null while the editor dialog is closed). */
export function useActivePath(): string | null {
  return useSyncExternalStore(subscribe, snapshotActive);
}

/** Open (or focus) one file tab. */
export function openTab(tab: OpenTab): void {
  const existing = tabs.find((t) => t.path === tab.path);
  if (existing) {
    activePath = tab.path;
  } else {
    tabs = [...tabs, tab];
    activePath = tab.path;
  }
  emit();
  persistNow();
}

/** Focus an already-open tab. */
export function focusTab(path: string): void {
  if (tabs.some((t) => t.path === path)) {
    activePath = path;
    emit();
    persistNow();
  }
}

/** Whether a file path already has an open tab. */
export function isTabOpen(path: string): boolean {
  return tabs.some((t) => t.path === path);
}

/** Replace the active tab's content (editor keystrokes). */
export function updateActiveContent(content: string): void {
  if (activePath === null) return;
  tabs = tabs.map((t) => (t.path === activePath ? { ...t, content, dirty: content !== t.savedContent } : t));
  emit();
  persistNow();
}

/** Mark the active (or named) tab as saved after a successful write. */
export function markSaved(path: string): void {
  tabs = tabs.map((t) => (t.path === path ? { ...t, savedContent: t.content, dirty: false } : t));
  emit();
  persistNow();
}

/** Close one tab; the next-most-recent tab becomes active (if any). */
export function closeTab(path: string): void {
  tabs = tabs.filter((t) => t.path !== path);
  if (activePath === path) {
    activePath = tabs.length > 0 ? tabs[tabs.length - 1].path : null;
  }
  emit();
  persistNow();
}

/** Update tab paths after a rename. */
export function renameTab(from: string, to: string): void {
  tabs = tabs.map((t) => (t.path === from ? { ...t, path: to } : t));
  if (activePath === from) activePath = to;
  emit();
  persistNow();
}

/** Drop every tab whose path is being deleted (or was deleted). */
export function removeTabs(paths: readonly string[]): void {
  const gone = new Set(paths);
  tabs = tabs.filter((t) => !gone.has(t.path));
  if (activePath !== null && gone.has(activePath)) {
    activePath = tabs.length > 0 ? tabs[tabs.length - 1].path : null;
  }
  emit();
  persistNow();
}

/** Reset all editor state (panel closed / workspace switched). */
export function resetAll(): void {
  tabs = [];
  activePath = null;
  emit();
  clearSnapshot();
}

/** Replace the whole tab set (session restore after a page reload). */
export function restoreTabs(nextTabs: OpenTab[], active: string | null): void {
  tabs = nextTabs;
  activePath = active;
  emit();
}

// ── sidebar visibility sync ────────────────────────────────────────────────
// The center "文件" view (FileEditorView) is mounted only while it is the
// ACTIVE conversation view. It reports that fact here so the sidebar tree
// panel can follow: "文件" tab active → sidebar shows the workspace tree;
// switching back to "对话" (or any other view) → sidebar returns to the
// workspace/session browser.

let editorViewActive = false;
const viewListeners = new Set<() => void>();

function emitView(): void {
  for (const listener of viewListeners) listener();
}

/** Called by the editor view on mount (true) / unmount (false). */
export function setEditorViewActive(active: boolean): void {
  if (editorViewActive === active) return;
  editorViewActive = active;
  emitView();
}

/** Whether the "文件" conversation view is currently the active view. */
export function isEditorViewActive(): boolean {
  return editorViewActive;
}

/** Subscribe to editor-view activation changes (returns the disposer). */
export function subscribeEditorViewActive(listener: () => void): () => void {
  viewListeners.add(listener);
  return () => {
    viewListeners.delete(listener);
  };
}
