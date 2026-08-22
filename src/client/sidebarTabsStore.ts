/**
 * Sidebar view-tab state for the dsh-explorer-editor plugin.
 *
 * The sidebar region shows either the workspace/session browser ("工作区") or
 * the file-manager tree ("文件"). This tiny store holds which of the two is
 * selected so both the `sidebar.workspaces.tabs` strip (rendered inside the
 * workspace browser's section header) and the file-manager panel wrapper
 * (rendered while the file manager is open) share one source of truth.
 *
 * In-memory only, defaulting to the workspace browser — the same default the
 * plugin had before tabs existed. Follows the useSyncExternalStore pattern of
 * themeStore.ts / mdModeStore.ts.
 */
import { useSyncExternalStore } from 'react';

/** The two sidebar view tabs. */
export type SidebarTab = 'workspace' | 'files';

/** Default view: the workspace/session browser. */
export const DEFAULT_SIDEBAR_TAB: SidebarTab = 'workspace';

let current: SidebarTab = DEFAULT_SIDEBAR_TAB;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): SidebarTab {
  return current;
}

/** React hook: the currently selected sidebar view tab. */
export function useSidebarTab(): SidebarTab {
  return useSyncExternalStore(subscribe, snapshot);
}

/** Switch the sidebar view tab (no-op when already on that tab). */
export function setSidebarTab(tab: SidebarTab): void {
  if (current === tab) return;
  current = tab;
  emit();
}
