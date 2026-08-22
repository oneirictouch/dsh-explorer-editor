/**
 * Module-level clipboard for cut/copy + paste in the file tree.
 *
 * Lives outside React state so it survives tree remounts (the sidebar panel
 * closes when the center view switches away, but the pending cut/copy should
 * remain until pasted, cleared, or the page reloads).
 */
import { useSyncExternalStore } from 'react';

export interface PendingClipboard {
  kind: 'cut' | 'copy';
  path: string;
}

let pending: PendingClipboard | null = null;
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

function snapshot(): PendingClipboard | null {
  return pending;
}

/** React hook: the current pending cut/copy (null when none). */
export function useClipboard(): PendingClipboard | null {
  return useSyncExternalStore(subscribe, snapshot);
}

export function setClipboard(value: PendingClipboard | null): void {
  pending = value;
  emit();
}

export function clearClipboard(): void {
  if (pending !== null) {
    pending = null;
    emit();
  }
}
