/**
 * Live status of the `sidebar.workspaces.tabs` slot.
 *
 * The view-tab strip requires the workspace browser bundle to host the slot
 * (a small patch to `@deepseek-ai/dsh-client-ui-workspace`). On DSH builds
 * where that patch is absent the slot never exists, so the plugin falls back
 * to the legacy sidebar-footer toggle. This store wires the slot's entry
 * count to a useSyncExternalStore so the fallback button can hide itself the
 * moment the strip is live.
 *
 * The slot core allows subscribing ahead of declaration (the declaration
 * notifies) and returns an empty list for undeclared keys, so the watch works
 * whether the patch is present or not.
 */
import type { Context } from '@deepseek-ai/cordis';
import { useSyncExternalStore } from 'react';

let liveCount = 0;
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

function snapshot(): number {
  return liveCount;
}

/** React hook: whether the tabs slot currently has a live entry. */
export function useTabsSlotLive(): boolean {
  return useSyncExternalStore(subscribe, snapshot) > 0;
}

/**
 * Wire ctx.slots to the store. Returns the unsubscribe so the caller can wire
 * it through ctx.effect for fiber-lifetime cleanup.
 */
export function installTabsSlotWatch(ctx: Context): () => void {
  const sync = () => {
    const count = ctx.slots.entries('sidebar.workspaces.tabs').length;
    if (count !== liveCount) {
      liveCount = count;
      emit();
    }
  };
  const dispose = ctx.slots.subscribe('sidebar.workspaces.tabs', sync);
  sync();
  return dispose;
}
